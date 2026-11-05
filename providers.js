// Stage 3 is the only step that talks to a network, so it is the only step
// that has to be swappable. Everything else is INSERT and SELECT.
//
// Two things fall out of making it an adapter.
//
// A company that will not let its code leave the building can point this at a
// model on its own machine and run the whole pipeline on-premise. Nothing else
// in the system needs the network at all.
//
// And comparing models on one fixed task is the experiment, not a convenience.
// The production answer is a small fine-tuned model, because at the price of a
// frontier model per thread per repository there is no product. This layer is
// the bench that number gets measured on.
window.PriorProviders = (function(){

  // A small model will return prose, or JSON with a field missing, far more
  // often than a frontier one. Measuring how often is the point, so the failure
  // is counted rather than hidden, and retried exactly once.
  function validate(parsed, schema){
    if(!parsed || typeof parsed !== "object") return "not an object";
    if(!Array.isArray(parsed.decisions))      return "no decisions array";
    const req = schema.properties.decisions.items.required;
    for(const d of parsed.decisions){
      const missing = req.filter(k => !(k in d));
      if(missing.length) return `a decision is missing ${missing.join(", ")}`;
    }
    return null;
  }

  // Models that cannot be held to a schema wrap JSON in prose or a fence.
  function loosen(text){
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if(fence) return fence[1];
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    return (a !== -1 && b > a) ? text.slice(a, b + 1) : text;
  }

  function httpError(status, detail, where){
    if(status === 401 || status === 403)
      return new Error(`${where} rejected that key.`);
    if(status === 429)
      return new Error(`${where} rate limited this key. Wait and run it again.`);
    if(status === 400 && /credit|balance|quota/i.test(detail))
      return new Error(`The account behind that key has no credit.`);
    if(status === 404)
      return new Error(`${where} has no such model. Check the model name.`);
    return new Error(`${where} returned ${status}. ${detail}`.trim());
  }

  // ---------------------------------------------------------------- anthropic
  async function anthropic(cfg, system, schema, user){
    const res = await fetch(`${cfg.baseUrl || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": (cfg.key || "").trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8000,
        system,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium",
                         format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: user }]
      })
    });
    if(!res.ok){
      let detail = ""; try{ detail = (await res.json())?.error?.message || ""; }catch(_){}
      throw httpError(res.status, detail, "Anthropic");
    }
    const msg = await res.json();
    if(msg.stop_reason === "refusal") throw new Error("The model declined this request.");
    return {
      text:  (msg.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
      usage: { in: msg.usage?.input_tokens, out: msg.usage?.output_tokens }
    };
  }

  // ----------------------------------------------------- openai compatible
  // One adapter covers OpenAI, Ollama, vLLM, LM Studio, llama.cpp, Together and
  // OpenRouter, because they all serve /v1/chat/completions. The only thing
  // that differs is the base URL, and a local server wants no key at all.
  async function openaiCompatible(cfg, system, schema, user){
    // Some servers are given out as .../v1 and some as the bare host. Accept
    // either rather than making the person know which one this field wants.
    const base = (cfg.baseUrl || "https://api.openai.com")
      .replace(/\/+$/, "").replace(/\/v1$/, "");
    const headers = { "content-type": "application/json" };
    if((cfg.key || "").trim()) headers.authorization = `Bearer ${cfg.key.trim()}`;

    const body = {
      model: cfg.model,
      max_tokens: 8000,
      messages: [{ role: "system", content: system },
                 { role: "user",   content: user }]
    };
    // Served as a strict schema where supported; the validator below is what
    // catches the servers that accept the field and ignore it.
    if(cfg.structured !== false){
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "decisions", strict: true, schema }
      };
    }

    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(body)
    });
    if(!res.ok){
      let detail = ""; try{ detail = (await res.json())?.error?.message || ""; }catch(_){}
      if(res.status === 0 || res.status >= 500)
        detail += " If this is a local server, it has to allow this page's origin.";
      throw httpError(res.status, detail, "The endpoint");
    }
    const msg = await res.json();
    const c = msg.choices?.[0];
    if(c?.finish_reason === "content_filter")
      throw new Error("The model declined this request.");
    return {
      text:  c?.message?.content || "",
      usage: { in: msg.usage?.prompt_tokens, out: msg.usage?.completion_tokens }
    };
  }

  const ADAPTERS = { anthropic, openai: openaiCompatible };

  // Presets, so a local run is a choice from a list rather than a URL to recall.
  const PRESETS = {
    anthropic: { label: "Anthropic",  adapter: "anthropic",
                 baseUrl: "https://api.anthropic.com", model: "claude-opus-5",
                 needsKey: true,  local: false },
    openai:    { label: "OpenAI",     adapter: "openai",
                 baseUrl: "https://api.openai.com",    model: "gpt-4.1",
                 needsKey: true,  local: false },
    ollama:    { label: "Ollama",     adapter: "openai",
                 baseUrl: "http://localhost:11434/v1", model: "llama3.1:8b",
                 needsKey: false, local: true },
    vllm:      { label: "vLLM",       adapter: "openai",
                 baseUrl: "http://localhost:8000/v1",  model: "",
                 needsKey: false, local: true },
    lmstudio:  { label: "LM Studio",  adapter: "openai",
                 baseUrl: "http://localhost:1234/v1",  model: "",
                 needsKey: false, local: true },
    custom:    { label: "Any OpenAI-compatible endpoint", adapter: "openai",
                 baseUrl: "", model: "", needsKey: false, local: false }
  };

  // Calls the chosen adapter, parses, validates, and retries once with the
  // failure quoted back. Reports which path it took, because a provider that
  // needs the repair pass is a measurement, not a detail.
  async function call(cfg, system, schema, user, log){
    const adapter = ADAPTERS[cfg.adapter];
    if(!adapter) throw new Error(`Unknown provider "${cfg.adapter}".`);
    if(!cfg.model) throw new Error("Pick a model name for this endpoint.");

    let out = await adapter(cfg, system, schema, user);
    let parsed = null, problem = null;
    try{ parsed = JSON.parse(loosen(out.text)); }
    catch(_){ problem = "it was not valid JSON"; }
    if(!problem) problem = validate(parsed, schema);

    if(problem){
      log && log("model", `schema miss: ${problem}. Asking once more.`, "warn");
      out = await adapter(cfg, system, schema,
        `${user}\n\nYour previous reply could not be used because ${problem}. ` +
        `Reply with JSON matching the schema and nothing else.`);
      parsed = null;
      try{ parsed = JSON.parse(loosen(out.text)); }
      catch(_){ throw new Error(
        "The model did not return usable JSON twice. Smaller models fail this more " +
        "often, which is exactly what the schema-validity metric measures."); }
      const again = validate(parsed, schema);
      if(again) throw new Error(`The model's JSON still does not match the schema: ${again}.`);
    }

    return { decisions: parsed.decisions, usage: out.usage, repaired: !!problem };
  }

  return { call, PRESETS };
})();
