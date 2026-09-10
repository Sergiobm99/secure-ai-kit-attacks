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
// TWO THINGS THIS CANNOT KNOW, said here because a reader will otherwise assume it does.
//
// It cannot check BLAST RADIUS. `without(control)` is your function, and if switching off your audit
// logging also switches off your mail gate — the normal shape of a one-flag rebuild — this file sees
// an attack that got through and writes `demonstrated: true` next to the wrong name. All it can
// check is that you handed back a different application at all. Keep `without()` surgical.
//
// It cannot see STOCHASTICITY. Each attack runs once per configuration. Against the recorded
// transcripts that is exact; against a live model it is a single paired sample, and one lucky
// pairing can write `demonstrated: true` into a baseline that then keeps it there. Re-run before you
// commit a baseline taken against a live model.
//
// `demonstrated: false` IS NOT A FAILING GRADE. Some controls change what a model does rather than
// what your code does, and a deterministic replay ignores the prompt: it cannot prove them, and
// saying so is more useful than pretending. What it must never do is report them as proved.
import { ATTACKS, type Attack, type Outcome } from "./attacks/catalogue.ts";
import { complete, reported, requiredSignals, type Verdict, type YourApp } from "./adapter.ts";

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

  const missing = requiredSignals(attack.id).filter((field) => !reported(partial[field]));
  if (missing.length > 0) {
    return {
      verdict: "not-applicable",
      detail:
        `your adapter does not report ${missing.join(", ")}, so this assertion cannot be evaluated. ` +
        `It does not count as stopped.`,
    };
  }

  // Judging is inside the guard too: an assertion reads the shape it was promised, and a field
  // reported with the wrong type made it throw out of the whole run. Same fix as `adapter.ts`.
  try {
    const outcome = complete(partial);
    return attack.holds(outcome)
      ? { verdict: "stopped", detail: "" }
      : { verdict: "got-through", detail: attack.explain(outcome) };
  } catch (e) {
    return {
      verdict: "error",
      detail:
        `this attack could not be judged: ${e instanceof Error ? e.message : String(e)}. Usually a ` +
        `field reported with the wrong shape — see ADAPTING.md section 2.`,
    };
  }
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

  // WAS ANYTHING ACTUALLY MEASURED? Without this, an application that was unreachable for the
  // whole run — wrong port in CI, container not up, test flag off — produced "no attack changes its
  // verdict when this control is removed" for every control. Every clause of that sentence was
  // false: nothing ran. And because the baseline comparison then saw controls that used to be
  // demonstrated and no longer were, CI called a downed endpoint a security regression. Found by
  // the detached review of 2026-09-10.
  const evaluables = attacks.filter((a) => base.get(a.id)!.verdict === "stopped").length;
  const nadaQueMedir =
    evaluables === 0
      ? `no attack in this run reached a verdict this control could change: ` +
        attacks.map((a) => `${a.id}=${base.get(a.id)!.verdict}`).join(", ") +
        `. Nothing was measured, so nothing here says anything about your controls. Fix that first.`
      : null;

  const controls: ControlCoverage[] = [];
  const vistos = new Set<string>();

  for (const control of app.controls) {
    // A name that is blank, or repeated, is a mistake worth naming rather than a control worth
    // testing: a duplicate runs the whole attack sweep twice — real money against a live model —
    // and prints the same line twice as if it were two findings.
    if (control.trim() === "") {
      controls.push({
        control,
        declared: false,
        demonstrated: false,
        demonstratedBy: [],
        why: "this control has no name. Nothing was run for it.",
      });
      continue;
    }
    if (vistos.has(control)) {
      controls.push({
        control,
        declared: true,
        demonstrated: false,
        demonstratedBy: [],
        why: `"${control}" is listed more than once. Only the first entry was run.`,
      });
      continue;
    }
    vistos.add(control);

    // `without()` may throw instead of returning null — ADAPTING.md tells you to write
    // `buildMyApp({ disable: control })`, and a builder that validates its argument throws on a name
    // it does not know. That used to destroy the entire run, baseline included.
    let without: YourApp | null;
    try {
      without = app.without(control);
    } catch (e) {
      controls.push({
        control,
        declared: true,
        demonstrated: false,
        demonstratedBy: [],
        why:
          `your without() threw for this control: ${e instanceof Error ? e.message : String(e)}. ` +
          `Return null instead when you cannot build the app without it — that is a legitimate ` +
          `answer and it does not lose the rest of the run.`,
      });
      continue;
    }

    // Nothing was removed. The common cause is a typo in the name, and reading "your control is not
    // load-bearing" when the truth is "you misspelled it" is the worst answer this file can give.
    if (without === app.run) {
      controls.push({
        control,
        declared: true,
        demonstrated: false,
        demonstratedBy: [],
        why:
          `without("${control}") handed back the same application. Nothing was removed, so nothing ` +
          `was tested. Check the spelling of the name against what without() expects.`,
      });
      continue;
    }

    if (nadaQueMedir !== null) {
      controls.push({ control, declared: true, demonstrated: false, demonstratedBy: [], why: nadaQueMedir });
      continue;
    }

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
  // THE ATTACK VERDICTS GO FIRST, and they were not printed at all.
  //
  // Without them the page answered "are your controls load-bearing?" and silently dropped "did
  // these attacks get through?" — so an application that started leaking read as a clean control
  // report, and an application that was simply unreachable read the same as one whose controls are
  // theatre. The controls section means nothing until you have read this one.
  console.log(`Attacks — ${coverage.subject}\n`);
  for (const a of coverage.attacks) {
    const mark = { stopped: "STOPPED    ", "got-through": "GOT THROUGH", "not-applicable": "N/A        ", error: "ERROR      " }[a.verdict];
    console.log(`  ${mark}  ${a.name}`);
    if (a.detail !== "") console.log(`                ${a.detail}`);
  }

  console.log(`\nControl coverage — ${coverage.subject}\n`);
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
 * Exit code for a coverage run. 1 if any attack got through or could not be run.
 *
 * This exists because it was MISSING, and its absence was a trap: a developer who followed the docs
 * from `runAttacks`/`exitCode` to `measure`/`compareToBaseline` silently lost the got-through gate.
 * Their build went green while an attack was landing. Found by the detached review of 2026-09-10.
 */
export function coverageExitCode(coverage: Coverage): number {
  return coverage.attacks.some((a) => a.verdict === "got-through" || a.verdict === "error") ? 1 : 0;
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

  // A RUN THAT MEASURED NOTHING IS NOT A REGRESSION, and saying it is trains people to ignore this.
  //
  // With the application unreachable — wrong port in CI, container not up, the test flag off —
  // every attack errors, every control comes back not-demonstrated, and the comparison below
  // dutifully reported each one as "WAS demonstrated and is not any more". A downed endpoint read
  // exactly like your defences collapsing. It still fails the build, and it should; what changes is
  // that it says the true thing. Found by the detached review of 2026-09-10.
  const medidos = now.attacks.filter((a) => a.verdict === "stopped" || a.verdict === "got-through");
  if (now.attacks.length > 0 && medidos.length === 0) {
    return [
      `nothing was measured in this run: ` +
        now.attacks.map((a) => `${a.id}=${a.verdict}`).join(", ") +
        `. This is NOT a security regression — your application did not answer. Fix that and run ` +
        `again before reading anything else here.`,
    ];
  }

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

  // AND THE ATTACKS. This half was missing entirely, which made the whole comparison a decoration:
  // an attack that went from stopped to got-through — the actual regression anyone cares about —
  // changed nothing here and the build stayed green.
  const antesAtaques = new Map(baseline.attacks.map((a) => [a.id, a]));
  for (const a of now.attacks) {
    const previo = antesAtaques.get(a.id);
    if (previo === undefined) {
      problems.push(`${a.id}: attack not in the baseline. Add it in the same commit that adds it.`);
      continue;
    }
    if (previo.verdict === "stopped" && a.verdict !== "stopped") {
      problems.push(
        `${a.id}: WAS stopped and is now ${a.verdict}. ${a.detail || "That is the regression this file exists to catch."}`,
      );
    }
    if (previo.verdict !== "stopped" && a.verdict === "stopped") {
      problems.push(
        `${a.id}: is stopped now and was ${previo.verdict} in the baseline. If a change earned that, ` +
          `update the baseline in the SAME commit. A door that closed and nobody claimed is luck.`,
      );
    }
  }
  for (const a of baseline.attacks) {
    if (!now.attacks.some((x) => x.id === a.id)) {
      problems.push(`${a.id}: in the baseline and not in this run. The baseline describes a world that is gone.`);
    }
  }

  return problems;
}
