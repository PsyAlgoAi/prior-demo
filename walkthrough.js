// The guided tour. Seven steps that together are the whole product.
// Each step is one real surface, rendered the way it actually looks.
window.PRIOR_TOUR = [
{
  n:1, kind:"problem", title:"You find a number nobody can explain",
  say:"This is where every user of Prior starts. Not with our product, with a question they cannot answer.",
  code:`# src/delivery.py

def deliver(message, provider, session):
    last_error = None

    for attempt in range(3):          # <- why 3?
        try:
            return provider.send(message, session=session)
        except ProviderTimeout as exc:
            last_error = exc
            time.sleep(2.5 ** attempt)`,
  after:"Why 3? Would 5 be safer? The answer was written in 2024, in a comment on one pull request, and nobody was ever going to read it again."
},
{
  n:2, kind:"term", title:"Prior reads the history once",
  say:"One command. It pulls every pull request, issue and review comment, and keeps the exact file and line each one is attached to.",
  term:[
    {p:"$ ", c:"prior scan"},
    {o:""},
    {o:"  reading orbitlabs/orbit-api"},
    {o:"  412 pull requests, 3,880 comments", d:1},
    {o:""},
    {o:"  linking     PR -> file -> line, issue -> PR, revert -> original"},
    {g:"              exact, from the API, 0 tokens"},
    {o:"  filtering   dropped 2,760 (approvals, nits, bots, too short)"},
    {g:"              1,120 kept, 0 tokens"},
    {o:"  extracting  1,120 threads -> 14 decisions"},
    {e:"              the only step that costs anything"},
    {o:""},
    {g:"  saved to .decisions/graph.db        4m 12s"}
  ],
  after:"Five of the seven stages run for nothing. The entire cost of the product sits in the extraction step, which is why it uses a small model and why the filter throws away as much as it safely can."
},
{
  n:3, kind:"decision", title:"What it found",
  say:"Not a paragraph. A record a program can query.",
  did:"D-040",
  after:"status, ruled out, reopen when, and the exact lines it governs. A paragraph is something a person has to read correctly. This is data."
},
{
  n:4, kind:"term", title:"A developer asks",
  say:"The question from step one, answered in under a second. No model runs: this is a lookup.",
  term:[
    {p:"$ ", c:"prior why src/delivery.py:38"},
    {o:""},
    {o:"  Delivery attempts are capped at 3    "},{s:"ADOPTED"},
    {o:"  PR #847 . omar . March 2024"},
    {o:""},
    {o:"  Five was tried first. When the provider is already struggling"},
    {o:"  every extra attempt lands on a box that is falling over: in"},
    {o:"  staging, five made the pile-up worse and recovery took twice"},
    {o:"  as long."},
    {o:""},
    {r:"  x  Five attempts        measured worse in staging"},
    {r:"  x  Circuit breaker      another piece of state to get wrong"},
    {o:""},
    {e:"  reopen when  traffic passes 10k requests per second"}
  ],
  after:"The comment that answers this contains no word from the question. Not retry, not 3, not the filename. Plain search over the same comments returns the pull request that proposed raising the cap and was refused."
},
{
  n:5, kind:"agent", title:"An AI assistant asks, before it writes",
  say:"This is the part that matters commercially. The developer did nothing. Cursor asked on its own.",
  after:"Without this, the assistant proposes a circuit breaker and raises the cap: both reasonable ideas that this team already considered and declined. We are not competing with Cursor. We are the thing it is missing."
},
{
  n:6, kind:"pr", title:"Somebody breaks a decision anyway",
  say:"A human, or an assistant that was never given the constraints. The bot comments on the pull request.",
  after:"Note the last line. It does not assume the change is wrong, and it harvests a new decision when it is right. The tool gets better from being disagreed with."
},
{
  n:7, kind:"loop", title:"And the memory grows on its own",
  say:"Every merge triggers a check. Every correction is the strongest kind of evidence there is.",
  after:"Extraction is copyable by anyone in a couple of months. A year of one team's corrections is not, and it only exists where this loop has been running."
}];
