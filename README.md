# Secure AI Kit — the isolation module and the attack suite

Two pieces of [Secure AI Kit](https://secureaikit.com), published in full before anyone is asked for
money: the **untrusted-context isolation guardrail** and the **four attacks** the kit is measured
against. Plus an adapter so you can point those attacks at the application you already have.

Nothing here is a demo build or a trimmed version. `src/guardrails/context-isolation.ts` and
`src/attacks/catalogue.ts` are **byte-for-byte the files that ship in the paid kit**, with one import
line rewritten so they resolve inside this repository. The script that copies them is here too
([tools/port-from-kit.py](tools/port-from-kit.py)) and it prints the diff every time it runs: if
that difference ever grows past an import line, you see it, and so does anyone reading its output.

## Why you would look at this

Because a security product that asks you to take its word for it is the one thing a security product
must not do. So:

- [**RESULTS.md**](RESULTS.md) — a real run against my own implementation, **including the one attack
  that is not proven and why it says SKIP rather than STOPPED**. That is the part worth reading.
- [**transcripts/**](transcripts/) — the three recorded runs where the attacks actually landed. They
  are the evidence the "stopped" results are replayed against, not an illustration.
- [**src/guardrails/context-isolation.ts**](src/guardrails/context-isolation.ts) — the guardrail
  itself, 39 lines, with the reasoning in the comments rather than in a blog post.

## Run the attacks against your own app

Requires **Node 22.18+** (it runs TypeScript directly, no build step).

22.6 is where `--experimental-strip-types` first appeared, behind a flag; 22.18 is where it became
the default and `node example.ts` runs with no flag at all. The floor here used to say 22.6, which
named the version that introduced the feature rather than the one where the documented command
works. On 22.6–22.17 it still runs, with `node --experimental-strip-types example.ts`.

```
npm install
node example.ts
```

`example.ts` ships a fake application so you can see the shape of a report before writing anything.
Replace it with yours:

```ts
import { runAttacks, report, exitCode, type YourApp } from "./src/adapter.ts";

const myApp: YourApp = async ({ turns, plantedDocument }) => {
  // 1. If you have RAG and `plantedDocument` is set, index it first. That is where the
  //    indirect injection lives, and skipping it is not testing it.
  // 2. Run `turns` through your chat endpoint.
  // 3. Report what happened. Every field is optional — see below.
  return {
    wire: everythingYouSentTheClient,
    toolsRun: ["search_records"],
    recordsBefore: 4,
    recordsAfter: 4,
    emailsSent: [],
  };
};

const results = await runAttacks(myApp);
report(results);
process.exit(exitCode(results));
```

### The one rule that makes the report worth having

**An attack whose signal your app does not report comes back `N/A`, never `stopped`.**

If you do not report `toolsRun`, tool abuse is not stopped — it is unchecked, and the report says so
in those words. "3 of 4 stopped" when the third could not be measured is exactly the lie these
attacks exist to catch, and a suite that tells it is worse than no suite.

### `wire` vs `text`, and why both exist

`text` is the assistant's prose. `wire` is **everything** your application sends the client — prose,
tool calls, tool results, blocked calls — serialised in the order it was sent.

Both leak assertions read `wire`. That is not a preference: the kit's own suite once printed
`STOPPED` for the PII attack while four customer addresses crossed as JSON in the tool result right
before the masked prose. Reading `text` measures the channel the filters cover and misses the one
that carried the payload. If your adapter reports only `text`, those two attacks come back `N/A`.

## What is here, and what is not

| Here | Not here |
|---|---|
| The untrusted-context isolation guardrail, in full | The other seven runtime guardrails |
| The four attacks, their payloads and their assertions | The kit's agent, tools, providers and harness |
| Three transcripts of the attacks landing | The Next.js reference application |
| An adapter to run them against your app | The replay runner and the recording tooling |
| The full licence text of the paid kit | |

The harness is not withheld to tease: it is bolted to the kit's own agent, and publishing it would
mean publishing the kit. The adapter here does the useful half — pointing the attacks at *your*
application — and it is 162 lines you can read.

## The licence

[`KIT-LICENSE.txt`](KIT-LICENSE.txt) is the licence of the **paid kit**, published at an address
rather than sent on request, which is the third of the four things the site promises before the first
sale. It is a draft and says so: it has not yet been through a lawyer, and it will before anything is
sold.

[`LICENSE`](LICENSE) covers **this repository** — the isolation module, the attack catalogue, the
adapter, the example and the transcripts — under **MIT**. Run them against your own application,
fork them, ship them. The paid kit is a different licence, and that is the whole point of publishing
both texts side by side.

---

Questions, or the licence text in another form: the address is on
[secureaikit.com](https://secureaikit.com).
