# prior-demo

A clickable demo of **Prior**, a decision API for codebases.

**Live:** deployed from this repository on Vercel.

> Version control remembers *what* changed. Nobody remembers *why*.
> Prior recovers the reasoning a team already wrote, and serves it to the people
> and the AI assistants that keep tripping over its absence.

---

## It actually runs

Open **Try it live**, paste any public pull request, and the page calls the GitHub API
from your browser and runs the pipeline in front of you.

```
fetching    encode/httpx #3022
linked      17 files, 112 comments, 327 touched lines
filtered    kept 50 of 112 (45%) - 37 no rationale signal, 24 too short, 1 acknowledgement
extracted   13 decisions
```

Those numbers match the Python pipeline in
[Simple-Test](https://github.com/PsyAlgoAi/Simple-Test) exactly, because the fetching,
linking and filtering are the same logic ported to JavaScript.

**One stage is not the real thing.** In the shipped product, extraction calls a small
fine-tuned model. Here it runs readable rules instead, so the page needs no key, costs
nothing and gives the same answer every time. It finds less than a model would. The
interface says so, under the results, rather than hiding it.

There is **no server**. An optional GitHub token raises the rate limit from 60 requests
an hour to 5,000; it stays in the browser tab and is sent to github.com and nowhere else.

## What you are looking at

It opens on **How it works**: a seven step walk through the whole system, one real
surface per step.

| | |
|---|---|
| 1 | A number in the code that nobody can explain |
| 2 | `prior scan` reading three years of history, with what each stage costs |
| 3 | What it found, as a record rather than a paragraph |
| 4 | A developer asking, answered without a model running |
| 5 | **Cursor asking on its own, before it writes** |
| 6 | The bot catching a pull request that contradicts a past decision |
| 7 | The loop that makes the memory grow without anyone remembering to feed it |

Then five views over the memory itself.

| | |
|---|---|
| **Overview** | How much of this project's reasoning was written down, and what needs attention |
| **Decisions** | Every choice someone explained at the time. Click one to see why, what was ruled out, and the comment it came from |
| **Coverage** | Which parts of the codebase have recorded reasoning and which do not |
| **People** | Where knowledge is concentrated, so you can tell when it is about to leave |
| **Alerts** | Conditions a past decision set, that have now been met |

### Three things worth clicking

- **D-031** (Postgres for the event log) is marked **superseded**, not deleted. The
  original reasoning still explains code that was written under it.
- **D-080** is marked **temporary**: the author said at the time that it would not hold.
  No documentation format records that.
- **D-120** is marked **AI proposed**. Recording whether a decision came from a person or
  an assistant is cheap now and impossible to add backwards.

---

## The data is simulated

`data.js` describes a fake notification service, written so that every feature has
something to show. **Nothing here is presented as a real project.** The world it uses is
the one in [Simple-Test](https://github.com/PsyAlgoAi/Simple-Test), where the pipeline
that would produce this data actually runs.

This demo shows **the shape of the product**, not a result. The measurement that would
justify it is the subject of the research, and has not been done yet.

---

## Running it

No build step, no dependencies.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

`index.html` is the whole application. `data.js` holds the decisions and `walkthrough.js` the tour script. Swapping that file
for real extracted decisions is all it takes to point this at a live repository.

## Deploying

Static. On Vercel: import the repository, framework preset **Other**, no build command,
output directory `.` (the root).

## Design

Colours come from the mark: black line art with a single ember accent. That accent is
reserved for the brand, so product state gets its own palette (adopted, ruled out,
temporary, superseded). **Colour is never the only signal** - every state carries its
word, because roughly one person in twelve cannot separate two of those hues.

Type is `Instrument Serif` for the wordmark only, `Inter` for the interface and
`JetBrains Mono` for paths. A serif in the interface would make a developer tool read
like a magazine.

---

Part of [PsyAlgoAi](https://github.com/PsyAlgoAi).
