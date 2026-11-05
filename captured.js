// A finished record, for a visitor with no key and no model on their machine.
//
// These are not model output. They were read out of the real discussion on
// encode/httpx#3022 by a person and checked against the final diff, which is
// why origin is "confirmed" rather than "extracted" and why this is the only
// place in the app where that distinction has an example.
//
// context is null on every one of them. The thread argued the choices but never
// stated the surrounding condition, and the schema says to use null rather than
// restate the rationale. An invented context would make the demo look better
// and the system worth less.
//
// Six were verified by hand. One is not here: "ssl.SSLContext() is constructed
// with an explicit protocol argument" had no alternative recorded against it,
// and the gate says that a choice nothing was weighed against is not a decision,
// it is just how things are. Exempting our own demo from our own rule would be
// the cheapest possible way to stop believing the rule.
window.PriorCaptured = {
  "repo": "encode/httpx",
  "number": 3022,
  "title": "Add SSLContext, replacing verify= and cert=",
  "merged": true,
  "decisions": [
    {
      "id": "encode/httpx#3022-1",
      "pr": 3022,
      "source": "encode/httpx#3022",
      "origin": "confirmed",
      "statement": "SSL is configured through a new httpx.SSLContext object passed as ssl_context=, instead of the verify= and cert= arguments.",
      "context": null,
      "status": "adopted",
      "rationale": "Collects SSL configuration into one object rather than spreading it across top-level client arguments.",
      "revisit_if": null,
      "alternatives": [
        {
          "option": "Keep verify= and cert= as the only API",
          "outcome": "rejected",
          "reason": "Does not scale as SSL options grow."
        }
      ],
      "scope": [
        {
          "target": "repo:encode/httpx/httpx/_config.py",
          "kind": "code"
        },
        {
          "target": "repo:encode/httpx/httpx/_client.py",
          "kind": "code"
        }
      ],
      "evidence": [
        {
          "author": "karpetrosyan",
          "quote": "instead of httpx.Client(verify=False) do context = httpx.SSLContext(verify=False); httpx.Client(ssl_context=context)",
          "anchor": null
        }
      ],
      "confidence": "high",
      "fromModel": true
    },
    {
      "id": "encode/httpx#3022-2",
      "pr": 3022,
      "source": "encode/httpx#3022",
      "origin": "confirmed",
      "statement": "verify= and cert= are deprecated rather than removed outright: a warning first, an error at 1.0, removal later in 1.x.",
      "context": null,
      "status": "adopted",
      "rationale": "They are part of the top-level API, so the project's deprecation policy applies. Users who pin httpx<1.0.0 need releases where the old API still works while they migrate.",
      "revisit_if": null,
      "alternatives": [
        {
          "option": "Remove verify= and cert= immediately in this PR",
          "outcome": "rejected",
          "reason": "Too aggressive for a top-level API; the author had proposed it to avoid complicating the code."
        }
      ],
      "scope": [
        {
          "target": "repo:encode/httpx/httpx/_config.py",
          "kind": "code"
        },
        {
          "target": "repo:encode/httpx/httpx/_client.py",
          "kind": "code"
        }
      ],
      "evidence": [
        {
          "author": "T-256",
          "quote": "Removing `verify` and `cert` is too aggressive, I'd recommend deprecate them first.",
          "anchor": null
        },
        {
          "author": "T-256",
          "quote": "deprecate warning on 0.27 raise error on 1.0 remove at some point later on 1.x This is what I can be happy with.",
          "anchor": null
        },
        {
          "author": "karpetrosyan",
          "quote": "I believe migration is simple enough to skip that stage in order to avoid making that part of the code overly complicated.",
          "anchor": null
        }
      ],
      "confidence": "high",
      "fromModel": true
    },
    {
      "id": "encode/httpx#3022-3",
      "pr": 3022,
      "source": "encode/httpx#3022",
      "origin": "confirmed",
      "statement": "SSLContext construction was moved from __new__ to __init__ during review. A separate __new__ override remains, to pass the protocol argument to ssl.SSLContext.",
      "context": null,
      "status": "adopted",
      "rationale": "A reviewer asked why __new__ was overridden; the author agreed it belonged in __init__ and had only put it there temporarily. Fixed the next day by commit 'Use __init__ instead of __new__ in SSLContext'.",
      "revisit_if": null,
      "alternatives": [
        {
          "option": "Keep the construction logic in __new__",
          "outcome": "rejected",
          "reason": "The author said it was temporary and belonged in __init__."
        }
      ],
      "scope": [
        {
          "target": "repo:encode/httpx/httpx/_config.py",
          "kind": "code"
        }
      ],
      "evidence": [
        {
          "author": "lovelydinosaur",
          "quote": "I'm curious why we're overriding `__new__` instead of `__init__` here?",
          "anchor": "httpx/_config.py:51"
        },
        {
          "author": "karpetrosyan",
          "quote": "Yes, it should definitely be in __init__. I believe I encountered some issues and have temporarily moved it to __new__ to see how it looks in general.",
          "anchor": "httpx/_config.py:51"
        },
        {
          "author": "karpetrosyan",
          "quote": "Use __init__ instead of __new__ in SSLContext",
          "anchor": "commit 2023-12-29"
        }
      ],
      "confidence": "high",
      "fromModel": true
    },
    {
      "id": "encode/httpx#3022-4",
      "pr": 3022,
      "source": "encode/httpx#3022",
      "origin": "confirmed",
      "statement": "This PR adds the new API only; deprecating and removing the old one happens in a separate PR.",
      "context": null,
      "status": "adopted",
      "rationale": "Keeps a behavioural API change reviewable on its own, separate from clean-ups.",
      "revisit_if": null,
      "alternatives": [
        {
          "option": "Do the API change and the clean-ups together",
          "outcome": "rejected",
          "reason": "Would make an important API change harder to review."
        }
      ],
      "scope": [
        {
          "target": "repo:encode/httpx/httpx/_config.py",
          "kind": "code"
        }
      ],
      "evidence": [
        {
          "author": "T-256",
          "quote": "you could add `ssl_context=` and `httpx.SSLContext` in current PR and decide to deprecate/remove in separated PR.",
          "anchor": "httpx/_config.py:85"
        },
        {
          "author": "karpetrosyan",
          "quote": "Separating them will make it easier to review this PR, which contains an important API change.",
          "anchor": "httpx/_config.py:85"
        }
      ],
      "confidence": "high",
      "fromModel": true
    },
    {
      "id": "encode/httpx#3022-5",
      "pr": 3022,
      "source": "encode/httpx#3022",
      "origin": "confirmed",
      "statement": "The change ships in 1.0, not 0.27.",
      "context": null,
      "status": "adopted",
      "rationale": "It is a breaking API change, and 1.0 is the release where breaking changes are allowed.",
      "revisit_if": null,
      "alternatives": [
        {
          "option": "Ship in 0.27",
          "outcome": "rejected",
          "reason": "Breaking change in a minor release."
        }
      ],
      "scope": [
        {
          "target": "repo:encode/httpx/CHANGELOG.md",
          "kind": "code"
        }
      ],
      "evidence": [
        {
          "author": "T-256",
          "quote": "Then, we can merge this PR for v1.0 but not 0.27. (breaking api)",
          "anchor": null
        }
      ],
      "confidence": "medium",
      "fromModel": true
    }
  ]
};
