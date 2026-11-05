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
discussion shows what was chosen AND what was ruled out.

THE GATE. If the thread never weighs one option against another, it is not a
decision, it is just how things are. Renaming a class, a missing licence
header, a typo, a style preference, "can you move this" - none of these are
decisions, and returning them is worse than returning nothing.

CONTEXT IS NOT RATIONALE. They are different fields and they are easy to
confuse.
  rationale  why the choice was made, with the evidence or measurement
             "we tried 5 and got banned; 3 catches 94% of failures"
  context    what was true about the world at the time, the condition the
             decision depended on
             "the provider did not return Retry-After"
Context is historical. Never write a present-tense judgement into it. If the
thread states no such condition, use null rather than restating the rationale.

REVISIT_IF IS CONTEXT INVERTED. What was true then, and what would have to
stop being true. Only write it if the thread actually set that condition.

SCOPE. Every target must be prefixed with the system it belongs to:
  repo:<owner/name>/<path>   for a file
  db:<database>.<table>.<column>
  contract:<id>.<clause>
Use only the paths given to you. Never invent one, and never guess a line
number that was not in the input.

Rules:
- Every decision needs at least one verbatim quote from the thread as evidence.
- Never state a rationale the thread does not contain. Use null.
- Never write a placeholder like "the alternative discussed here". An empty
  field is worse than a missing one, because it reads as information. Drop
  the alternative instead.
- Check mid-thread claims against the final state. A comment calling something
  temporary on day one is not binding if a later commit in the same thread
  resolved it.
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
          required: ["statement", "context", "status", "rationale",
                     "alternatives", "revisit_if", "scope", "evidence",
                     "confidence"],
          properties: {
            statement: { type: "string" },
            context:   { type: ["string","null"] },
            status: { type: "string",
                      enum: ["adopted","rejected","deferred","temporary","superseded"] },
            rationale: { type: ["string","null"] },
            alternatives: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                required: ["option","outcome","reason"],
                properties: {
                  option:  { type: "string" },
                  outcome: { type: "string",
                             enum: ["rejected","deferred","untested"] },
                  reason:  { type: ["string","null"] }
                }
              }
            },
            revisit_if: { type: ["string","null"] },
            scope: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                required: ["target","kind"],
                properties: {
                  target: { type: "string" },
                  kind: { type: "string",
                          enum: ["code","column","table","rule","row",
                                 "clause","section","spec"] }
                }
              }
            },
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

When writing scope targets for these files, prefix each one:
  repo:${doc.repo}/<path>     kind "code"

DISCUSSION (chronological):
${comments}

Return the decisions as JSON.`;
  }

  // A schema is a request, not a guarantee. Older responses returned scope as
  // bare strings, and a card that renders "undefined" in front of someone is a
  // worse failure than one that renders a slightly plainer pointer.
  function normaliseScope(scope, repo){
    return (Array.isArray(scope) ? scope : [])
      .map(s => {
        if(typeof s === "string")
          return { target: /^[a-z]+:/.test(s) ? s : `repo:${repo}/${s}`, kind: "code" };
        if(s && typeof s.target === "string")
          return { target: s.target, kind: s.kind || "code" };
        return null;
      })
      .filter(Boolean);
  }

  // cfg is a provider from PriorProviders: an adapter, a base URL, a model
  // name and optionally a key. A plain string is still accepted and read as an
  // Anthropic key, so an older call site keeps working.
  function asConfig(cfg){
    if(typeof cfg === "string" || !cfg)
      return { ...window.PriorProviders.PRESETS.anthropic, key: cfg || "" };
    return cfg;
  }

  async function extract(doc, cfg, log){
    const p = asConfig(cfg);
    log("model", `${p.model} reading ${doc.comments.length} comments` +
                 (p.local ? " on this machine" : ""), "run");

    const out = await window.PriorProviders.call(
      p, SYSTEM, SCHEMA, userMessage(doc), log);
    const parsed = { decisions: out.decisions };
    const u = { input_tokens: out.usage?.in, output_tokens: out.usage?.out };

    log("model",
      `${parsed.decisions.length} decision${parsed.decisions.length===1?"":"s"} ` +
      `· ${u.input_tokens||"?"} in, ${u.output_tokens||"?"} out` +
      (out.repaired ? " · needed a repair pass" : ""),
      parsed.decisions.length ? "ok" : "warn");

    // origin is stamped here, never asked of the model. "extracted" means
    // nobody has confirmed this yet, and the interface has to say so.
    return parsed.decisions.map((d,i) => ({
      ...d,
      scope: normaliseScope(d.scope, doc.repo),
      alternatives: (d.alternatives || []).filter(a => a && a.option),
      id: `${doc.repo}#${doc.number}-${i+1}`,
      pr: doc.number,
      source: `${doc.repo}#${doc.number}`,
      origin: "extracted",
      fromModel: true
    }));
  }

  return { extract, MODEL };
})();
