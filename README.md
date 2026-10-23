# prior-demo

A clickable demo of **Prior**, a decision API for codebases.

**Live:** deployed from this repository on Vercel.

> Version control remembers *what* changed. Nobody remembers *why*.
> Prior recovers the reasoning a team already wrote, and serves it to the people
> and the AI assistants that keep tripping over its absence.

---

## It actually runs

Open **Try it live** and paste a whole repository. It finds the discussions worth
reading and runs the pipeline on them, in your browser, against live GitHub.

```
searching   pull requests in encode/httpx
found       1803 pull requests, 561 with more than 3 comments (31%)
reading     the 3 most discussed
  #3022     112 comments, 50 kept, 13 decisions
  #305      101 comments, 63 kept, 27 decisions
  #276       71 comments, 42 kept, 13 decisions
```

**That 31% is a real measurement**, and it is the first research question in miniature:
how much of a project's reasoning survives in its own history. One repository is not a
result, but it is a data point, produced live.

Paste a single pull request instead and it runs just that one.

Those numbers match the Python pipeline in
[Simple-Test](https://github.com/PsyAlgoAi/Simple-Test) exactly, because the fetching,
linking and filtering are the same logic ported to JavaScript.

**A repository with nothing to show says so.** Point it at a project whose changes were
merged without discussion and it reports exactly that, because how often reasoning fails
to survive is the finding, not a failure of the tool.

## The last step cannot be done with rules, and the page says so

An earlier version of this demo treated any anchored comment over twelve words as a
decision. On `huggingface/transformers#43451` that produced **37 "decisions"** which
were really code review nitpicks: *licence header missing*, *rename this class*, *no
need to guard anymore*. It was noise wearing the shape of a result.

Telling a decision apart from a nitpick takes judgement, and regular expressions have
none. What the rules can do is spot the language a decision leaves behind:

- something **weighed against something else** (*"we tried five and it was worse"*)
- something **measured** (*"p95 went to 180ms"*)
- a **condition set** for changing the answer (*"revisit above 10k rps"*)

That points at *where* a decision probably is. It cannot say what was decided. So the
output is labelled **candidates**, not decisions, and the same two pull requests now
report honestly:

```
transformers #43451   149 comments -> 42 kept -> 2 candidates
httpx #3022           112 comments -> 50 kept -> 7 candidates
```

The first two candidates on httpx are the two real decisions in that thread: that
removing `verify` and `cert` outright was too aggressive, and that the `__new__`
override was the wrong place. **The shipped product reads each candidate with a small
fine-tuned model** and returns the choice, the reason and what was ruled out, or returns
nothing, which is the right answer for most threads.

This demo has no model. Everything before that step is the production logic.

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
