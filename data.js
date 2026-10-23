// Decisions for the demo. The world is the one in Simple-Test: a fake
// notification service written so every feature has something to show.
// Marked as simulated in the UI; nothing here is passed off as real.
window.PRIOR = {
  repo: "orbitlabs/orbit-api",
  simulated: true,
  score: 6.4,
  scoreTrend: [4.1, 4.6, 5.2, 5.0, 5.8, 6.1, 6.4],
  stats: { prs: 412, comments: 3880, kept: 1120, decisions: 14, withReason: 11 },
  coverage: [
    { area: "delivery",  files: 12, covered: 11, risk: "low" },
    { area: "events",    files: 8,  covered: 6,  risk: "low" },
    { area: "prefs",     files: 5,  covered: 4,  risk: "low" },
    { area: "billing",   files: 17, covered: 3,  risk: "high" },
    { area: "auth",      files: 9,  covered: 2,  risk: "high" }
  ],
  people: [
    { name: "omar",  areas: ["delivery", "events", "billing"], decisions: 8, left: false },
    { name: "lina",  areas: ["delivery", "prefs"],             decisions: 4, left: false },
    { name: "sara",  areas: ["prefs"],                          decisions: 2, left: false },
    { name: "karim", areas: ["billing"],                        decisions: 3, left: true }
  ],
  alerts: [
    { kind: "revisit", text: "Decision D-040 said to revisit the circuit breaker above 10k rps. Traffic is now 11.2k.", ref: "D-040" },
    { kind: "stale",   text: "D-031 was superseded by D-058 but is still referenced in docs/architecture.md.", ref: "D-031" },
    { kind: "gap",     text: "auth/ has 9 files and 2 recorded decisions. Only one person has touched it.", ref: null }
  ],
  decisions: [
    { id:"D-040", title:"Delivery attempts are capped at 3", area:"delivery", status:"adopted",
      because:"Five was tried first. When the provider is already struggling every extra attempt lands on a box that is falling over: in staging, five made the pile-up worse and recovery took twice as long.",
      rejected:[ {option:"Five attempts", why:"Measured worse in staging"},
                 {option:"Circuit breaker", why:"Another piece of state to get wrong, and the cap was enough at 2k rps"} ],
      revisit:"Traffic passes 10k requests per second", governs:["src/delivery.py:38-41"],
      pr:40, author:"omar", date:"2024-03-05", decidedBy:"human",
      quote:"Five is too many. We measured it in staging: five made the pile-up worse and recovery took twice as long." },

    { id:"D-041", title:"The HTTP session is passed in, never opened per attempt", area:"delivery", status:"adopted",
      because:"Opening a connection on every attempt makes a pile-up worse, because the provider pays for the handshake too.",
      rejected:[], revisit:null, governs:["src/delivery.py:52"],
      pr:40, author:"omar", date:"2024-03-05", decidedBy:"human",
      quote:"Pass the session in rather than opening one per attempt." },

    { id:"D-058", title:"The event log is Mongo. Everything else stays Postgres", area:"events", status:"adopted",
      because:"Events are append-only and never joined on, so the transactional guarantee that mattered in 2021 buys nothing here. At 40 million events a month the single Postgres write path became the slowest step.",
      rejected:[ {option:"Keep events in Postgres", why:"p95 on insert reached 180ms and was climbing"},
                 {option:"Move everything to Mongo", why:"Only the event log has this shape"} ],
      revisit:null, governs:["src/events.py:5-7","src/events.py:30-31"], supersedes:"D-031",
      pr:58, author:"omar", date:"2024-07-11", decidedBy:"human",
      quote:"Events are append-only and we never join on them. Everything else stays on Postgres." },

    { id:"D-031", title:"The event log uses Postgres", area:"events", status:"superseded",
      because:"We already run it, the team knows it, and transactions come free. Mongo would be a second system to operate for no benefit at our size.",
      rejected:[ {option:"Mongo", why:"A second datastore to operate"} ],
      revisit:"Event volume makes the write path a problem", governs:["src/events.py"],
      supersededBy:"D-058", pr:null, issue:31, author:"omar", date:"2021-06-14", decidedBy:"human",
      quote:"Postgres. We already run it. Revisit if the event volume makes the write path a problem." },

    { id:"D-044", title:"Preferences are cached in process, not in Redis", area:"prefs", status:"adopted",
      because:"Redis ran for the rate limiter in 2023 and was pulled out after four months: a second datastore to monitor, back up and page someone about, and the hit rate never justified it. Preferences change rarely and the in-process cache gets 95 percent.",
      rejected:[ {option:"Redis", why:"Tried in 2023, removed after four months"} ],
      revisit:null, governs:["src/prefs.py:10-12"],
      pr:44, author:"omar", date:"2024-04-11", decidedBy:"human",
      quote:"We ran Redis for the rate limiter in 2023 and pulled it out. Not worth bringing it back." },

    { id:"D-045", title:"The preference cache expires after five minutes", area:"prefs", status:"adopted",
      because:"Without a TTL a worker can serve a stale preference for its whole lifetime, and a user who turns notifications off expects that to take effect.",
      rejected:[], revisit:null, governs:["src/prefs.py:20"],
      pr:44, author:"omar", date:"2024-04-11", decidedBy:"human",
      quote:"Give this a TTL of five minutes." },

    { id:"D-061", title:"Raising the attempt cap to 5 for server errors", area:"delivery", status:"rejected",
      because:"Proposed again in August 2024 and refused: the same measurement from PR #40 still applies.",
      rejected:[], revisit:null, governs:["src/delivery.py:38"],
      pr:61, author:"omar", date:"2024-08-03", decidedBy:"human",
      quote:"We tried this before, in #40. Five attempts made recovery twice as slow." },

    { id:"D-072", title:"Webhook payloads are signed with HMAC-SHA256", area:"auth", status:"adopted",
      because:"Receivers need to verify the payload came from us without us holding a secret per receiver.",
      rejected:[ {option:"Per-receiver API keys", why:"Key rotation across hundreds of receivers"} ],
      revisit:null, governs:["src/auth/signing.py:14-28"],
      pr:72, author:"karim", date:"2024-09-02", decidedBy:"human",
      quote:"HMAC means we never store a shared secret per receiver." },

    { id:"D-080", title:"Billing totals are computed at read time, not stored", area:"billing", status:"temporary",
      because:"Done this way to ship the first version. It will not hold past a few thousand invoices, and the author said so at the time.",
      rejected:[], revisit:"Invoice count passes 5,000, or read latency passes 300ms",
      governs:["src/billing/totals.py:40-66"],
      pr:80, author:"karim", date:"2024-10-14", decidedBy:"human",
      quote:"Computing at read time for now. This will not hold once invoice volume grows." },

    { id:"D-088", title:"Retry backoff is exponential with a 2.5 base", area:"delivery", status:"adopted",
      because:"Linear backoff kept three attempts inside the provider's recovery window, so all three failed together.",
      rejected:[ {option:"Linear backoff", why:"All attempts fell inside the outage window"} ],
      revisit:null, governs:["src/delivery.py:6"],
      pr:88, author:"lina", date:"2024-11-20", decidedBy:"human",
      quote:"Linear meant all three attempts landed during the same outage." },

    { id:"D-094", title:"Timestamps are stored in UTC and formatted at the edge", area:"events", status:"adopted",
      because:"Storing local time made two incidents harder to reconstruct because the same event had two plausible orderings.",
      rejected:[], revisit:null, governs:["src/events.py:12"],
      pr:94, author:"lina", date:"2025-01-08", decidedBy:"human",
      quote:"Two postmortems were slower because event order was ambiguous." },

    { id:"D-101", title:"No ORM. Queries are written by hand", area:"events", status:"adopted",
      because:"The query shapes here are few and performance sensitive, and generated SQL was the cause of a slow path we had to unpick twice.",
      rejected:[ {option:"SQLAlchemy", why:"Generated SQL caused a regression twice"} ],
      revisit:"The number of distinct query shapes passes about 40",
      governs:["src/events.py","src/billing/queries.py"],
      pr:101, author:"omar", date:"2025-03-12", decidedBy:"human",
      quote:"Twice now a slow path turned out to be generated SQL." },

    { id:"D-112", title:"Rate limits are per API key, not per IP", area:"auth", status:"adopted",
      because:"Several large customers sit behind one egress IP, so per-IP limiting punished them for being big.",
      rejected:[ {option:"Per IP", why:"Customers share egress IPs"} ],
      revisit:null, governs:["src/auth/limits.py:22-40"],
      pr:112, author:"lina", date:"2025-06-04", decidedBy:"human",
      quote:"Three of our largest customers share one egress IP." },

    { id:"D-120", title:"Dead letters are kept for 30 days, then dropped", area:"delivery", status:"adopted",
      because:"Support almost never looks past a week, and unbounded retention was the second largest line on the storage bill.",
      rejected:[ {option:"Keep forever", why:"Storage cost, and nobody read them"} ],
      revisit:null, governs:["src/delivery.py:120-134"],
      pr:120, author:"omar", date:"2025-09-17", decidedBy:"agent",
      quote:"Proposed by an assistant during cleanup, reviewed and accepted by omar." }
  ]
};
