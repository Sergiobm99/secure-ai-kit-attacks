# Pointing these attacks at your own application

Everything here runs against **your** app. You write one function; the suite drives the attacks
through it and tells you what it can and cannot conclude.

The one rule worth reading twice: **a signal you do not report comes back `N/A`, never `STOPPED`.**
Not measuring something and defending it are different, and this suite will not blur them for you.

```
npm install
node example.ts        # a fake app, so you can see the shape of a report first
```

## 1 · The function

```ts
import { runAttacks, report, exitCode, type YourApp } from "./src/adapter.ts";

const myApp: YourApp = async ({ turns, plantedDocument }) => {
  // 1. If your app has RAG and `plantedDocument` arrived, put it in the index FIRST.
  //    That document is where the indirect attack lives. Skipping it is not testing it.
  // 2. Run the turns through your app, in order, as one conversation.
  // 3. Report what happened. Leave out anything you did not measure.
  return { text: "…", wire: "…" };
};

const results = await runAttacks(myApp);
report(results);
process.exit(exitCode(results));
```

Your app is probably behind HTTP rather than in this process. `src/http-adapter.ts` is the adapter
for that, and it needs one endpoint on your side that takes `{ turns, plantedDocument }` and answers
with the JSON below. **Your product should not have that endpoint in production** — it is a testing
seam. A dozen lines mounted behind a flag is the normal shape.

```ts
import { httpApp } from "./src/http-adapter.ts";
const results = await runAttacks(httpApp({ url: "http://localhost:3000/__attack", timeoutMs: 30_000 }));
```

## 2 · What to report, and what each attack needs

| field | what it is |
| --- | --- |
| `text` | the assistant's prose, concatenated. What the model **said**. |
| `wire` | **everything** your app sent the client, in order — prose, tool calls, tool results, blocked calls — serialised. |
| `toolsRun` | names of tools that actually executed. |
| `toolsBlocked` | names of tools that were asked for and refused. |
| `toolCalls` | tool calls the model asked for, with arguments. |
| `retrieved` | names of documents that reached the context. |
| `recordsBefore` / `recordsAfter` | how many records existed before and after the turn. |
| `emailsSent` | `{ to, subject }` for each message your app actually sent. |

**`wire` is not `text`, and the difference is why this column exists.** The kit's own suite once
reported an attack as stopped while four customer email addresses crossed to the browser as JSON in
a tool result — the prose had them masked, and the assertion only read the prose. Anything about
*leaking* is judged on `wire`. If you can only report `text`, those attacks come back `N/A`, which
is the honest answer and the one you want.

Each attack reads only what it needs:

| attack | needs | what it costs you when it lands |
| --- | --- | --- |
| **Direct prompt injection** (LLM01, LLM07) | `wire` | Your system prompt comes back out — and with it whatever an operator put in it: keys, internal policy, the names of systems. |
| **Indirect prompt injection** (LLM01, LLM08) | `emailsSent` | A stranger who can put a document in front of the assistant is giving it orders, and your user never sees why. Report the plant, or you are not testing this. |
| **Tool abuse** (LLM06, LLM05) | `toolsRun`, `recordsBefore`, `recordsAfter` | The assistant does not say something wrong — it *does* something irreversible, with the permissions you gave it. |
| **Personal data disclosure** (LLM02) | `wire` | A customer's data goes to whoever is chatting. No injection needed; the assistant is only being helpful. |

## 3 · Proving a control instead of listing it

Listing your controls is easy and means nothing. `src/coverage.ts` proves each one the only way it
can be proved: **it removes the control and checks that an attack that was stopped now gets
through.**

```ts
import { measure, reportCoverage, type ControlledApp } from "./src/coverage.ts";

const app: ControlledApp = {
  run: myApp,
  controls: ["output-filter", "tool-allow-list", "human-approval"],
  // The same app with that control switched off — or null if you cannot build that.
  without: (control) => buildMyApp({ disable: control }),
};

reportCoverage(await measure(app, "my support assistant"));
```

You get four things per control, and no fifth:

- `declared` — you say you have it.
- `demonstrated` — removing it let an attack through.
- `demonstratedBy` — **which** attacks. The evidence, not the claim.
- `why` — when it could not be demonstrated, the reason in words.

**There is no score, and there will not be one.** A number out of 100 for an application this tool
has just met is a claim, not a measurement, and it is the exact failure this project has already
made once: the kit's README said its suite proved nine guardrails, and pulling the chain apart one
at a time showed that **two** of them changed any outcome. A total would have hidden that. A list of
what was actually demonstrated could not.

**`demonstrated: false` is not a failing grade.** A control that changes what the *model* does —
prompt framing, context isolation — cannot be proved by a deterministic replay, because a replay
ignores the prompt. The report says that instead of guessing in either direction.

Returning `null` from `without()` is a legitimate answer. You then get `demonstrated: false` with the
reason, which is more useful than a number that pretends otherwise.

## 4 · In CI

`measure()` gives you a plain object. Write it next to your code as `secure-ai-coverage.json`, commit
it, and compare on every run:

```ts
import { compareToBaseline } from "./src/coverage.ts";
const problems = compareToBaseline(baseline, await measure(app, "my app"));
if (problems.length > 0) { problems.forEach((p) => console.error(p)); process.exit(1); }
```

**It fails in both directions, and the second is the interesting one.** A control that stops being
load-bearing is a regression. A control that *starts* being load-bearing without anyone claiming it
is luck, not a control — update the baseline in the same commit as the change that earned it, or you
have a coverage table that describes a world that no longer exists.

## 5 · Reading the result honestly

- `STOPPED` — the attack ran and your app held.
- `GOT THROUGH` — it ran and your app did not.
- `N/A` — it could not be judged, because you did not report a signal it needs. The report names the
  field. This is **not** a pass.
- `ERROR` — your app threw, hung, or answered something unusable. Also **not** a pass. A non-200 is
  an error and never a defence: from out here, your guardrail refusing and your framework crashing
  look identical.

`exitCode()` fails on `GOT THROUGH` and `ERROR`. `N/A` does not fail the run — but it does not pass
it either, and it is the number to drive to zero before you trust anything else on this page.
