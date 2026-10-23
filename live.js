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

  // ---- stage 3: candidates (rules here, a model in production) --------
  //
  // This step cannot be done with regular expressions and the page does not
  // pretend otherwise. A review comment is overwhelmingly a nitpick: rename
  // this, move that, the licence header is missing. A decision leaves a trace
  // in the language instead: something was weighed against something else,
  // something was measured, or a condition for changing the answer was stated.
  //
  // Matching those traces finds roughly where a decision is. It cannot tell
  // you what the decision was, which is the model's job. So what comes out of
  // here is labelled candidates, not decisions.
  const RULED_OUT = /\b(we tried|tried (it|that|this|them)|was (tried|rejected|reverted|removed)|pulled (it|them) out|not worth|won'?t work|does ?n'?t work|didn'?t work|instead of|rather than|we (chose|decided|went with|moved away|settled on)|decided (to|against|not)|not yet|closing this|too (aggressive|risky|complex|slow|many|much)|against (doing|using))/i;
  const MEASURED  = /\b(we measured|measured it|benchmark|profil(ed|ing)|p9[59]|\d+\s*(ms|rps|qps|%|percent|x (faster|slower))|twice as (slow|long|fast))\b/i;
  const REVISIT   = /\b(revisit|reconsider|re-?evaluate)\b[^.]{0,60}\b(if|when|once|above|past|beyond)\b/i;
  const NIT       = /^(nit|typo|style|lint)\b|\b(licence|license) header|missing (a )?(comma|newline|docstring|header)|same (format|as) (in|above)/i;
  const REVISIT_C = /(?:revisit|reconsider|re-?evaluate)[^.]{0,20}?\b(?:if|when|once|above|past|beyond)\s+(.+?)(?:[.\n]|$)/i;

  function signalsOf(t){
    const out = [];
    if(RULED_OUT.test(t)) out.push("weighed against something");
    if(MEASURED.test(t))  out.push("measured");
    if(REVISIT.test(t))   out.push("set a condition to revisit");
    return out;
  }

  function extract(doc, log){
    const out = [];
    let examined = 0;

    for(const c of doc.comments){
      const t = (c.body||"").replace(/\s+/g," ").trim();
      examined++;
      if(t.split(/\s+/).length < 10) continue;
      if(NIT.test(t)) continue;
      const sig = signalsOf(t);
      if(!sig.length) continue;

      const rev = REVISIT_C.exec(t);
      out.push({
        id: `${doc.repo}#${doc.number}`,
        pr: doc.number,
        title: doc.title,
        status: doc.merged ? "adopted" : "rejected",
        quote: t,
        signals: sig,
        revisit: rev ? rev[1].trim().slice(0,120) : null,
        author: c.author,
        anchor: c.line ? `${c.path}:${c.line}` : null,
        governs: c.line ? [`${c.path}:${c.line}`]
                        : Object.entries(doc.scope).filter(([,l]) => l.length)
                            .slice(0,2).map(([pth,l]) => `${pth}:${l[0]}`)
      });
    }

    log("candidates",
      `${out.length} of ${examined} comments carry a decision signal` +
      (out.length ? "" : " — nothing in this discussion decided anything"),
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
