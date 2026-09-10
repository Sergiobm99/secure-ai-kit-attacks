// SPDX-License-Identifier: MIT
// src/adapter.ts — point these attacks at YOUR application.
//
// This file is the only thing here that does not come from the kit. The kit has its own harness,
// wired to its agent, its tools and its providers; that harness is no use to you, and publishing it
// would mean publishing the whole kit. What is useful — and what was promised — is the opposite:
// that you can point these attacks at the application you ALREADY have, before deciding anything
// about this one.
//
// THE RULE THAT ORDERS THIS FILE: an attack whose assertion needs a signal your application does not
// produce is reported NOT APPLICABLE, never as stopped. Saying "3 of 4 stopped" when the third could
// not even be measured is exactly the lie these attacks exist to catch. If your app calls no tools,
// tool abuse is not stopped — it is unchecked.
import { ATTACKS, type Attack, type Outcome } from "./attacks/catalogue.ts";
import type { Message } from "./types.ts";

/**
 * What you implement: run one turn against your application and report what happened.
 *
 * `plantedDocument` arrives when the attack works through retrieval. If your application has RAG,
 * put it in the index before running the turns; that is where the indirect attack lives, and
 * skipping it is not testing it.
 */
export type YourApp = (request: {
  turns: Message[];
  plantedDocument?: { name: string; text: string };
}) => Promise<Partial<Outcome>> | Partial<Outcome>;

export type Verdict = "stopped" | "got-through" | "not-applicable" | "error";

export interface Result {
  attack: Attack;
  verdict: Verdict;
  detail: string;
}

/**
 * The signals each attack's assertion actually reads.
 *
 * Declared by hand and not inferred: inferring it by reading `holds()` would be guessing, and
 * guessing here produces exactly the false "stopped" this file exists to avoid.
 *
 * NOTE ON `wire` vs `text`, because it is the whole reason the kit's own suite once lied. `text` is
 * the assistant's prose. `wire` is EVERYTHING your app sends the client — tool calls, tool results,
 * blocked calls, prose — serialised in the order it was sent. Both leak assertions read `wire`,
 * because that is where the leak actually happened: four customer addresses crossed as JSON in a
 * tool result while the prose went out with them masked. If your adapter only reports `text`, those
 * two attacks come back N/A, which is the honest answer.
 */
export const NEEDS: Record<string, (keyof Outcome)[]> = {
  "direct-injection": ["wire"],
  "indirect-injection": ["emailsSent"],
  "tool-abuse": ["toolsRun", "recordsBefore", "recordsAfter"],
  "pii-leak": ["wire"],
};

// Every attack in the catalogue has to declare what it needs. Checking that AT LOAD rather than at
// run is deliberate: with `NEEDS[id] ?? []`, a new attack with no entry would get an empty list of
// requirements, be evaluated against the defaults, and come back "stopped" without anyone having run
// it. That failure already happened here once, writing `pii-disclosure` where the catalogue says
// `pii-leak`, and it is invisible unless something checks.
for (const attack of ATTACKS) {
  if (NEEDS[attack.id] === undefined) {
    throw new Error(
      `Attack "${attack.id}" does not declare its required signals in NEEDS. Add them: without ` +
        `them it would be evaluated against defaults and could report a false "stopped".`,
    );
  }
}

/**
 * A complete `Outcome` from whatever your application was able to report.
 *
 * Exported because `coverage.ts` builds the same outcome from the same partial and must not
 * grow a second copy of these defaults: two copies of a default drift, and the one that
 * survives is the one nobody is testing.
 */
export function complete(partial: Partial<Outcome>): Outcome {
  return {
    text: partial.text ?? "",
    wire: partial.wire ?? "",
    toolCalls: partial.toolCalls ?? [],
    toolsRun: partial.toolsRun ?? [],
    toolsBlocked: partial.toolsBlocked ?? [],
    retrieved: partial.retrieved ?? [],
    recordsBefore: partial.recordsBefore ?? 0,
    recordsAfter: partial.recordsAfter ?? 0,
    emailsSent: partial.emailsSent ?? [],
  };
}

/**
 * What this attack's assertion reads, for callers outside this file.
 *
 * A function and not the bare map so the load-time check above stays the single gate: an id
 * with no entry throws here too instead of quietly returning an empty list of requirements,
 * which is how a missing declaration becomes a false "stopped".
 */
export function requiredSignals(attackId: string): (keyof Outcome)[] {
  const needs = NEEDS[attackId];
  if (needs === undefined) {
    throw new Error(`Attack "${attackId}" does not declare its required signals in NEEDS.`);
  }
  return needs;
}

/** Runs the attacks against your application and returns one verdict each. */
export async function runAttacks(app: YourApp, attacks: Attack[] = ATTACKS): Promise<Result[]> {
  const results: Result[] = [];

  for (const attack of attacks) {
    let partial: Partial<Outcome>;

    try {
      partial = await app({ turns: attack.turns, plantedDocument: attack.plant });
    } catch (e) {
      results.push({
        attack,
        verdict: "error",
        detail: `your application threw: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    // What your application did NOT report. A missing field is not an empty field: not knowing
    // whether a tool ran is different from knowing that none did, and treating them the same turns
    // "I did not measure it" into "I stopped it".
    const missing = NEEDS[attack.id]!.filter((field) => partial[field] === undefined);
    if (missing.length > 0) {
      results.push({
        attack,
        verdict: "not-applicable",
        detail:
          `your adapter does not report ${missing.join(", ")}, so this assertion cannot be ` +
          `evaluated. It does not count as stopped.`,
      });
      continue;
    }

    const outcome = complete(partial);
    const held = attack.holds(outcome);
    results.push({
      attack,
      verdict: held ? "stopped" : "got-through",
      detail: held ? "" : attack.explain(outcome),
    });
  }

  return results;
}

/** Prints the results. The count does NOT add "not applicable" to "stopped". */
export function report(results: Result[]): void {
  const mark: Record<Verdict, string> = {
    stopped: "STOPPED    ",
    "got-through": "GOT THROUGH",
    "not-applicable": "N/A        ",
    error: "ERROR      ",
  };

  for (const r of results) {
    console.log(`  ${mark[r.verdict]}  ${r.attack.name}  [${r.attack.owasp.join(", ")}]`);
    if (r.detail !== "") {
      console.log(`                ${r.detail}`);
    }
  }

  const count = (v: Verdict): number => results.filter((r) => r.verdict === v).length;
  console.log();
  console.log(
    `${results.length} attacks · ${count("stopped")} stopped · ` +
      `${count("got-through")} got through · ${count("not-applicable")} not measured` +
      (count("error") > 0 ? ` · ${count("error")} errored` : ""),
  );
  if (count("not-applicable") > 0) {
    console.log('"Not measured" is NOT stopped: your adapter did not produce the signal needed.');
  }
}

/** Exit code: 1 if anything got through. Unmeasured does not fail, but it does not pass either. */
export function exitCode(results: Result[]): number {
  return results.some((r) => r.verdict === "got-through" || r.verdict === "error") ? 1 : 0;
}
