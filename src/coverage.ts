// SPDX-License-Identifier: MIT
// src/coverage.ts — which of your controls actually hold, and how we know.
//
// WHY THIS IS NOT A SCORE, said first because it is the whole design.
//
// A number out of 100 for an application this tool has just met is a claim, not a measurement. It
// invites the one failure this project exists to avoid: publishing a figure nobody can trace back to
// a test. It is not a hypothetical — the kit's own README said its attack suite "proves each of the
// nine guardrails", and when the 2026-09-09 audit pulled the chain apart one guardrail at a time,
// only TWO changed any outcome. The number was wrong and nothing could tell you.
//
// So there is no total here. No percentage, no letter, no "level". For each control you get four
// things and they are all falsifiable:
//
//   declared        you say your application has it
//   demonstrated    an attack that is stopped WITH it gets through WITHOUT it
//   demonstratedBy  which attacks, by id — the evidence, not the assertion
//   why             when it could not be demonstrated: the reason, in words
//
// `demonstrated: false` IS NOT A FAILING GRADE. Some controls change what a model does rather than
// what your code does, and a deterministic replay ignores the prompt: it cannot prove them, and
// saying so is more useful than pretending. What it must never do is report them as proved.
import { ATTACKS, type Attack, type Outcome } from "./attacks/catalogue.ts";
import { complete, requiredSignals, type Verdict, type YourApp } from "./adapter.ts";

/**
 * Your application, plus the two things this file needs that a bare function cannot express.
 *
 * `without()` is the whole mechanism. If you cannot hand back a copy of your app with one control
 * switched off, nothing here can demonstrate that control — and it will say so rather than assume.
 * Returning `null` for a control you cannot remove is a legitimate answer and the honest one.
 */
export interface ControlledApp {
  /** Same contract as `YourApp`: run one attack's turns and report what happened. */
  run: YourApp;
  /** The controls you claim to have, by whatever names you use. */
  controls: string[];
  /** The same app with `control` switched off, or null if you cannot build that. */
  without: (control: string) => YourApp | null;
}

export interface ControlCoverage {
  control: string;
  declared: boolean;
  demonstrated: boolean;
  /** Attack ids that are stopped with this control and get through without it. */
  demonstratedBy: string[];
  /** Present only when `demonstrated` is false: why not. Never a euphemism for "failed". */
  why?: string;
}

export interface AttackCoverage {
  id: string;
  name: string;
  verdict: Verdict;
  detail: string;
}

export interface Coverage {
  /** A label you pass in, so a report says what it is about. Never inferred. */
  subject: string;
  controls: ControlCoverage[];
  attacks: AttackCoverage[];
}

/** One attack against one app. Shared by the baseline run and every without-a-control run. */
async function verdictFor(app: YourApp, attack: Attack): Promise<{ verdict: Verdict; detail: string }> {
  let partial: Partial<Outcome>;
  try {
    partial = await app({ turns: attack.turns, plantedDocument: attack.plant });
  } catch (e) {
    return { verdict: "error", detail: `your application threw: ${e instanceof Error ? e.message : String(e)}` };
  }

  const missing = requiredSignals(attack.id).filter((field) => partial[field] === undefined);
  if (missing.length > 0) {
    return {
      verdict: "not-applicable",
      detail:
        `your adapter does not report ${missing.join(", ")}, so this assertion cannot be evaluated. ` +
        `It does not count as stopped.`,
    };
  }

  const outcome = complete(partial);
  return attack.holds(outcome)
    ? { verdict: "stopped", detail: "" }
    : { verdict: "got-through", detail: attack.explain(outcome) };
}

/**
 * Runs the attacks, then removes each declared control in turn and runs them again.
 *
 * The cost is honest and worth saying out loud: this is (controls + 1) × attacks runs against your
 * application. Against a live model that is real money. Against a replay it is free, which is why
 * the kit records transcripts.
 */
export async function measure(app: ControlledApp, subject: string, attacks: Attack[] = ATTACKS): Promise<Coverage> {
  const base = new Map<string, { verdict: Verdict; detail: string }>();
  for (const attack of attacks) {
    base.set(attack.id, await verdictFor(app.run, attack));
  }

  const controls: ControlCoverage[] = [];
  for (const control of app.controls) {
    const without = app.without(control);
    if (without === null) {
      controls.push({
        control,
        declared: true,
        demonstrated: false,
        demonstratedBy: [],
        why: "your adapter cannot run without this control, so nothing here can prove it does anything",
      });
      continue;
    }

    // The evidence: an attack that IS stopped with the control and IS NOT without it. Anything else
    // proves nothing — an attack that gets through either way was never being stopped by this.
    const brokenBy: string[] = [];
    for (const attack of attacks) {
      if (base.get(attack.id)!.verdict !== "stopped") continue;
      const removed = await verdictFor(without, attack);
      if (removed.verdict === "got-through") brokenBy.push(attack.id);
    }

    controls.push(
      brokenBy.length > 0
        ? { control, declared: true, demonstrated: true, demonstratedBy: brokenBy }
        : {
            control,
            declared: true,
            demonstrated: false,
            demonstratedBy: [],
            why:
              "no attack in this run changes its verdict when this control is removed. That can mean " +
              "it defends something these attacks do not test, or that it changes what the model does " +
              "and a deterministic replay cannot see it. It does NOT mean it is proved.",
          },
    );
  }

  return {
    subject,
    controls,
    attacks: attacks.map((a) => ({
      id: a.id,
      name: a.name,
      verdict: base.get(a.id)!.verdict,
      detail: base.get(a.id)!.detail,
    })),
  };
}

/** The report, for people. No totals: see the header. */
export function reportCoverage(coverage: Coverage): void {
  console.log(`Control coverage — ${coverage.subject}\n`);
  for (const c of coverage.controls) {
    if (c.demonstrated) {
      console.log(`  DEMONSTRATED   ${c.control}`);
      console.log(`                 removing it lets through: ${c.demonstratedBy.join(", ")}`);
    } else {
      console.log(`  NOT PROVED     ${c.control}`);
      console.log(`                 ${c.why}`);
    }
  }
  console.log();
  console.log('"Not proved" is not a failure and not a pass. It is the absence of evidence, and this');
  console.log("tool will not turn it into either. There is no total here on purpose.");
}

/**
 * Compares a run against the committed baseline. Exit code, not a judgement.
 *
 * BOTH DIRECTIONS FAIL, and the second one is the interesting half. A control that stops being
 * load-bearing is a regression. A control that starts being load-bearing without anyone claiming it
 * is luck, not a control — the kit's own `expected-failures.json` has enforced exactly that rule
 * since the beginning, for the same reason: the file is the coverage table, and it may only change
 * in the same commit as the change that earns it.
 */
export function compareToBaseline(baseline: Coverage, now: Coverage): string[] {
  const before = new Map(baseline.controls.map((c) => [c.control, c]));
  const problems: string[] = [];

  for (const c of now.controls) {
    const a = before.get(c.control);
    if (a === undefined) {
      problems.push(`${c.control}: not in the baseline. Add it in the same commit as the control.`);
      continue;
    }
    if (a.demonstrated && !c.demonstrated) {
      problems.push(
        `${c.control}: WAS demonstrated (${a.demonstratedBy.join(", ")}) and is not any more. ` +
          `That is a security regression, not a baseline to update.`,
      );
    }
    if (!a.demonstrated && c.demonstrated) {
      problems.push(
        `${c.control}: is demonstrated now and was not in the baseline. If a change earned that, ` +
          `update the baseline in the SAME commit. A door that closed and nobody claimed is luck.`,
      );
    }
  }

  for (const a of baseline.controls) {
    if (!now.controls.some((c) => c.control === a.control)) {
      problems.push(`${a.control}: in the baseline and gone from this run. Was it removed on purpose?`);
    }
  }

  return problems;
}
