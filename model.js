// Stage 3, for real: a model reads the thread and returns decisions.
//
// The rules in live.js can only point at where a decision probably is. This
// is the step that says what it was, and it is the step that costs money.
// The page calls the API straight from the browser, so the key never leaves
// the tab and there is no server to trust.
//
// In production this is a small fine-tuned model running on every thread of
// every repository, because the price per call is the entire budget. Here it
// is a frontier model running on one thread at a time, because quality
// matters more than cost when there is one of them.
window.PriorModel = (function(){

  const MODEL = "claude-opus-5";

  const SYSTEM = `You extract engineering decisions from pull request discussions.

A decision is a choice about how the software works or is built, where the
discussion shows what was chosen or ruled out.

Most review comments are NOT decisions. Renaming a class, a missing licence
header, a typo, a style preference, "can you move this" — none of these are
decisions, and returning them is worse than returning nothing.

Rules:
- Every decision needs at least one verbatim quote from the thread as evidence.
- Never state a rationale the thread does not contain. Use null.
- Do not infer scope. Use only the paths and lines given to you.
- If the thread contains no decision, return {"decisions": []}. This is the
  correct answer for the majority of pull requests.`;

  const SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["statement", "status", "rationale", "alternatives",
                     "revisit_if", "scope", "evidence", "confidence"],
          properties: {
            statement: { type: "string" },
            status: { type: "string", enum: ["adopted","rejected","deferred","temporary"] },
            rationale: { type: ["string","null"] },
            alternatives: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                required: ["option","outcome","reason"],
                properties: {
                  option:  { type: "string" },
                  outcome: { type: "string", enum: ["chosen","rejected","deferred"] },
                  reason:  { type: ["string","null"] }
                }
              }
            },
            revisit_if: { type: ["string","null"] },
            scope: { type: "array", items: { type: "string" } },
            evidence: {
              type: "array", minItems: 1,
              items: {
                type: "object", additionalProperties: false,
                required: ["author","quote","anchor"],
                properties: {
                  author: { type: "string" },
                  quote:  { type: "string" },
                  anchor: { type: ["string","null"] }
                }
              }
            },
            confidence: { type: "string", enum: ["high","medium","low"] }
          }
        }
      }
    }
  };

  function userMessage(doc){
    const scope = Object.entries(doc.scope)
      .filter(([,l]) => l.length)
      .map(([p,l]) => `  ${p}  lines ${l.slice(0,24).join(", ")}`)
      .join("\n") || "  (no line level changes)";

    const comments = doc.comments.map(c =>
      `[${c.author}] (${c.line ? c.path + ":" + c.line : "general"}) ` +
      c.body.replace(/\s+/g, " ").trim().slice(0, 1200)
    ).join("\n\n");

    return `REPOSITORY: ${doc.repo}
PULL REQUEST #${doc.number}: ${doc.title}
STATE: ${doc.merged ? "merged" : "closed without merging"}

DESCRIPTION:
${(doc.body || "").replace(/\s+/g," ").trim().slice(0, 1500) || "(none)"}

FILES AND LINES THIS PULL REQUEST TOUCHES:
${scope}

DISCUSSION (chronological):
${comments}

Return the decisions as JSON.`;
  }

  async function extract(doc, key, log){
    log("model", `${MODEL} reading ${doc.comments.length} comments`, "run");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: SCHEMA }
        },
        messages: [{ role: "user", content: userMessage(doc) }]
      })
    });

    if(!res.ok){
      let detail = "";
      try{ const e = await res.json(); detail = e?.error?.message || ""; }catch(_){}
      if(res.status === 401) throw new Error("That API key was rejected. Check it starts with sk-ant- and has not been revoked.");
      if(res.status === 429) throw new Error("Rate limited by the API. Wait a moment and run it again.");
      if(res.status === 400 && /credit|balance/i.test(detail)) throw new Error("The account behind that key has no credit.");
      throw new Error(`The API returned ${res.status}. ${detail}`.trim());
    }

    const msg = await res.json();
    if(msg.stop_reason === "refusal")
      throw new Error("The model declined this request.");

    const text = (msg.content || []).filter(b => b.type === "text")
                                    .map(b => b.text).join("");
    let parsed;
    try{ parsed = JSON.parse(text); }
    catch(_){ throw new Error("The model did not return valid JSON. This is exactly the failure the schema-validity metric measures."); }

    const u = msg.usage || {};
    log("model",
      `${parsed.decisions.length} decision${parsed.decisions.length===1?"":"s"} ` +
      `· ${u.input_tokens||"?"} in, ${u.output_tokens||"?"} out`,
      parsed.decisions.length ? "ok" : "warn");

    return parsed.decisions.map((d,i) => ({ ...d, id: `${doc.repo}#${doc.number}-${i+1}`,
                                            pr: doc.number, fromModel: true }));
  }

  return { extract, MODEL };
})();
