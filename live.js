// A real run, in the browser.
//
// Stages 1 and 2 are the production logic: the structural linker and the
// relevance filter, ported from the Python in Simple-Test. They hit the live
// GitHub API and nothing about them is faked.
//
// Stage 3 is where the shipped product calls a small fine-tuned model. Here it
// runs readable rules instead, so the page needs no key, costs nothing, and
// gives the same answer every time. It finds less than a model would. The
// interface says so rather than hiding it.
window.PriorLive = (function(){

  const API = "https://api.github.com";

  async function gh(path, token){
    const headers = { "Accept": "application/vnd.github+json" };
    if(token) headers.Authorization = "Bearer " + token.trim();
    const res = await fetch(API + path, { headers });
    if(res.status === 403 || res.status === 429){
      const left = res.headers.get("x-ratelimit-remaining");
      if(left === "0"){
        const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
        const mins = Math.max(1, Math.round((reset - Date.now())/60000));
        throw new Error(`GitHub rate limit reached. Unauthenticated requests are capped at 60 an hour. Try again in about ${mins} minutes, or add a token below.`);
      }
      throw new Error("GitHub refused the request (403).");
    }
    if(res.status === 404) throw new Error("Not found. Check the repository and pull request number, and that the repository is public.");
    if(!res.ok) throw new Error(`GitHub returned ${res.status}.`);
    return res.json();
  }

  // ---- stage 1: the structural linker --------------------------------
  // Line numbers come from the diff, exactly. Nothing is guessed.
  function changedLines(patch){
    if(!patch) return [];
    const out = []; let n = 0;
    for(const ln of patch.split("\n")){
      const m = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if(m){ n = +m[1]; continue; }
      if(ln.startsWith("+") && !ln.startsWith("+++")){ out.push(n); n++; }
      else if(!ln.startsWith("-")) n++;
    }
    return out;
  }

  async function link(repo, number, token, log){
    log("fetching", `${repo} #${number}`);
    const [pr, files, reviewComments, issueComments] = await Promise.all([
      gh(`/repos/${repo}/pulls/${number}`, token),
      gh(`/repos/${repo}/pulls/${number}/files?per_page=100`, token),
      gh(`/repos/${repo}/pulls/${number}/comments?per_page=100`, token),
      gh(`/repos/${repo}/issues/${number}/comments?per_page=100`, token)
    ]);

    const body = pr.body || "";
    const refs = [...new Set((body.match(/#(\d+)/g) || []).map(x => +x.slice(1)))];
    const supersedes = [...body.matchAll(/supersed\w*[^#]{0,40}#(\d+)/gi)].map(m => +m[1]);

    const scope = {};
    for(const f of files) scope[f.filename] = changedLines(f.patch);

    const comments = [
      ...reviewComments.map(c => ({
        kind:"review", author:c.user?.login || "?", path:c.path,
        line:c.line || c.original_line, body:c.body || "", at:c.created_at })),
      ...issueComments.map(c => ({
        kind:"discussion", author:c.user?.login || "?", path:null,
        line:null, body:c.body || "", at:c.created_at }))
    ].sort((a,b) => a.at.localeCompare(b.at));

    log("linked",
      `${files.length} files, ${comments.length} comments, ` +
      `${Object.values(scope).flat().length} touched lines`, "ok");

    return { repo, number, title: pr.title, body, author: pr.user?.login,
             merged: !!pr.merged_at, mergedAt: pr.merged_at, createdAt: pr.created_at,
             refs, supersedes, scope, files, comments,
             commits: [] };
  }

  // ---- stage 2: the relevance filter ---------------------------------
  const BOT   = /(\[bot\]|codecov|dependabot|github-actions|netlify|vercel)/i;
  const NOISE = /^\s*(lgtm|looks good(\s+to\s+me)?|ship\s*it|\+1|👍|🎉|thanks?[!.]*|thank you[!.]*|done[!.]*|fixed[!.]*|nice[!.]*|agreed[!.]*|makes sense[!.]*|fair[!.]*|ok(ay)?[!.]*)\s*$/i;
  const REASON = /\b(because|why|reason|instead of|rather than|we (tried|chose|decided|should|could|can'?t|cannot|don'?t|do not|ran|measured|said)|i (think|would|prefer|suggest|believe)|the problem|downside|trade.?off|breaks?|regress|deprecat|backward|compat|performance|slower|faster|memory|alternative|avoid|prevent|not yet|too (aggressive|slow|complex|risky|many|much)|concern|revisit|supersed|closing this)\b/i;

  function filter(doc, log){
    const kept = [], dropped = {};
    const drop = r => dropped[r] = (dropped[r]||0) + 1;
    for(const c of doc.comments){
      const t = (c.body||"").trim();
      if(BOT.test(c.author)){ drop("bot"); continue; }
      if(!t){ drop("empty"); continue; }
      if(NOISE.test(t)){ drop("acknowledgement"); continue; }
      const words = t.split(/\s+/).length;
      if(words < 8){ drop("too short"); continue; }
      if(REASON.test(t) || (c.kind === "review" && words >= 15)) kept.push(c);
      else drop("no rationale signal");
    }
    const pct = doc.comments.length ? Math.round(100*kept.length/doc.comments.length) : 0;
    log("filtered",
      `kept ${kept.length} of ${doc.comments.length} (${pct}%) — ` +
      Object.entries(dropped).map(([k,v]) => `${v} ${k}`).join(", "), "ok");
    return { ...doc, comments: kept, dropped };
  }

  // ---- stage 3: extraction (rules here, a model in production) --------
  const REJECTED  = /(not yet|not worth|we tried this before|pulled it out|closing this|too many|is too \w+|won'?t work|against)/i;
  const REVISIT   = /(?:worth revisiting if|revisit if|revisiting if|reconsider if|revisit when)\s+(.+?)(?:[.\n]|$)/i;
  const PROPOSAL  = /(should we|why not|what about|could we|can we)\s+(.+?)\?/i;
  const NAMED     = /\b([A-Z][A-Za-z0-9_.-]+|\d+)\s+(?:is|are|was|were)\s+too\s+\w+/;
  const MEASURED  = /(we measured|p9[59]|\d+\s*(ms|rps|qps|percent|%|million|k\b))/i;

  function extract(doc, log){
    const out = [];
    const cs = doc.comments;

    // one decision for the pull request itself
    const dec = {
      id: `${doc.repo}#${doc.number}`, pr: doc.number,
      title: doc.title, status: doc.merged ? "adopted" : "rejected",
      because: null, rejected: [], revisit: null,
      governs: Object.entries(doc.scope).filter(([,l]) => l.length)
                 .slice(0,3).map(([p,l]) => `${p}:${l[0]}`),
      supersedes: doc.supersedes, evidence: [], measured: false
    };

    cs.forEach((c, i) => {
      const t = c.body.replace(/\s+/g," ").trim();
      if(REJECTED.test(t) || MEASURED.test(t)){
        if(!dec.because || t.length > dec.because.length) dec.because = t;
        dec.evidence.push({ author:c.author, quote:t,
          anchor: c.line ? `${c.path}:${c.line}` : null });
      }
      if(MEASURED.test(t)) dec.measured = true;
      if(REJECTED.test(t)){
        let option = null;
        if(i > 0){ const m = PROPOSAL.exec(cs[i-1].body); if(m) option = m[2].trim(); }
        if(!option){ const m = PROPOSAL.exec(t); if(m) option = m[2].trim(); }
        if(!option){ const m = NAMED.exec(t);    if(m) option = m[1].trim(); }
        if(option) dec.rejected.push({ option: option.slice(0,80),
                                       why: t.slice(0,180), by: c.author });
      }
      const r = REVISIT.exec(t);
      if(r) dec.revisit = r[1].trim().slice(0,120);
    });

    if(dec.because || dec.rejected.length) out.push(dec);

    // a pull request holds more than one decision: every anchored comment
    // with a real explanation becomes its own, keyed to the line it sits on
    const byLine = {};
    for(const c of cs){
      if(c.line && c.body.split(/\s+/).length >= 12){
        const k = `${c.path}:${c.line}`;
        (byLine[k] = byLine[k] || []).push(c);
      }
    }
    for(const [k, group] of Object.entries(byLine)){
      const longest = group.reduce((a,b) => b.body.length > a.body.length ? b : a);
      const t = longest.body.replace(/\s+/g," ").trim();
      if(dec.because === t) continue;
      out.push({
        id: `${doc.repo}#${doc.number} @ ${k}`, pr: doc.number,
        title: `Line level decision in ${k}`,
        status: doc.merged ? "adopted" : "rejected",
        because: t, rejected: [], revisit: null, governs: [k], supersedes: [],
        evidence: [{ author: longest.author, quote: t, anchor: k }],
        measured: MEASURED.test(t)
      });
    }

    log("extracted",
      `${out.length} decision${out.length===1?"":"s"}` +
      (out.reduce((n,d)=>n+d.rejected.length,0)
        ? `, ${out.reduce((n,d)=>n+d.rejected.length,0)} ruled out` : "") +
      (out.some(d=>d.revisit) ? ", 1 with a reopen condition" : ""),
      out.length ? "ok" : "warn");
    return out;
  }

  async function run(repo, number, token, log){
    const linked   = await link(repo, number, token, log);
    const filtered = filter(linked, log);
    const decisions = extract(filtered, log);
    return { doc: filtered, decisions };
  }

  function parseTarget(s){
    s = (s||"").trim().replace(/\/+$/,"");
    const pr = s.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i);
    if(pr) return { repo: pr[1], number: +pr[2] };
    const pair = s.match(/^([\w.-]+\/[\w.-]+)[\s#/]+(\d+)$/);
    if(pair) return { repo: pair[1], number: +pair[2] };
    // a whole repository: find the discussions worth reading
    const repoUrl = s.match(/github\.com\/([^/]+\/[^/?#]+)/i);
    if(repoUrl) return { repo: repoUrl[1].replace(/\.git$/,"") };
    const bare = s.match(/^([\w.-]+\/[\w.-]+)$/);
    if(bare) return { repo: bare[1] };
    return null;
  }

  // ---- a whole repository ---------------------------------------------
  // One search call finds the pull requests that actually hold a discussion,
  // then the normal pipeline runs on the best few. This is the entry point a
  // real user starts from: they have a repository, not a pull request number.
  const MIN_COMMENTS = 3, MAX_PRS = 3;

  async function scanRepo(repo, token, log){
    log("searching", `pull requests in ${repo}`);
    const all = await gh(
      `/search/issues?q=${encodeURIComponent(`repo:${repo} is:pr`)}&per_page=1`, token);
    const total = all.total_count || 0;
    if(!total){
      log("found", "no pull requests in this repository", "warn");
      return { repo, total:0, discussed:0, score:0, runs:[], decisions:[] };
    }

    const hits = await gh(
      `/search/issues?q=${encodeURIComponent(`repo:${repo} is:pr comments:>${MIN_COMMENTS}`)}` +
      `&sort=comments&order=desc&per_page=${MAX_PRS}`, token);
    const discussed = hits.total_count || 0;
    const ratio = total ? discussed/total : 0;
    const score = Math.round(Math.min(10, ratio*10) * 10) / 10;

    log("found",
      `${total} pull requests, ${discussed} with more than ${MIN_COMMENTS} comments ` +
      `(${Math.round(ratio*100)}%)`, discussed ? "ok" : "warn");

    if(!discussed){
      return { repo, total, discussed:0, score:0, runs:[], decisions:[] };
    }

    log("reading", `the ${Math.min(MAX_PRS, hits.items.length)} most discussed`);
    const runs = [], decisions = [];
    for(const it of hits.items.slice(0, MAX_PRS)){
      try{
        const linked = await link(repo, it.number, token, () => {});
        const filtered = filter(linked, () => {});
        const got = extract(filtered, () => {});
        runs.push({ number: it.number, title: it.title,
                    comments: linked.comments.length, kept: filtered.comments.length,
                    found: got.length });
        decisions.push(...got);
        log(`  #${it.number}`,
            `${linked.comments.length} comments, ${filtered.comments.length} kept, ` +
            `${got.length} decision${got.length===1?"":"s"}`,
            got.length ? "ok" : "warn");
      }catch(e){ log(`  #${it.number}`, e.message, "err"); }
    }
    return { repo, total, discussed, score, runs, decisions };
  }

  async function runRepo(repo, token, log){ return scanRepo(repo, token, log); }

  return { run, runRepo, parseTarget };
})();
