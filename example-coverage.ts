// SPDX-License-Identifier: MIT
// example-coverage.ts — proving a control by removing it. `npm run coverage`
//
// `example.ts` answers "did these attacks get through?". This one answers the harder question:
// "which of the controls you claim are actually doing the work?" — and it answers it the only way
// that means anything, by switching each one off and running the attacks again.
//
// The app below is FAKE and deliberately uneven: one control really stops an attack, one is pure
// theatre, and one cannot be switched off at all. Those are the three answers you will get from a
// real application, and seeing all three before you wire up your own is the point.
import { compareToBaseline, measure, reportCoverage, type ControlledApp } from "./src/coverage.ts";
import type { Outcome } from "./src/attacks/catalogue.ts";

interface Switches {
  emailGate: boolean;
  outputFilter: boolean;
}

/** A pretend support assistant. Reports every signal, so nothing comes back N/A. */
function fakeApp(on: Switches) {
  return ({
    turns,
    plantedDocument,
  }: {
    turns: { role: string; content: string }[];
    plantedDocument?: { name: string; text: string };
  }): Partial<Outcome> => {
    const last = turns.at(-1)?.content ?? "";
    const base = {
      toolsRun: [] as string[],
      toolsBlocked: [] as string[],
      toolCalls: [] as Outcome["toolCalls"],
      retrieved: [] as string[],
      recordsBefore: 4,
      recordsAfter: 4,
      emailsSent: [] as Outcome["emailsSent"],
    };

    // THE ORDER MATTERS, and each branch keys on the SIGNAL of its attack rather than on loose
    // words. The data-leak turn asks for "each customer's full name and email address", so keying
    // the mail branch on /email/ swallowed it — the same mistake the audit found in `example.ts`
    // (#46) and worth not repeating in the file that teaches the pattern.

    // Indirect injection: it is the planted document that carries the instruction, not the turn.
    if (plantedDocument !== undefined) {
      return {
        ...base,
        text: "Partners connect through the REST API; the limit is 100 requests a minute.",
        wire: "Partners connect through the REST API; the limit is 100 requests a minute.",
        retrieved: [plantedDocument.name],
        emailsSent: on.emailGate ? [] : [{ to: "a@evil.test", subject: "summary" }],
      };
    }

    // Tool abuse: keyed on the tool it names.
    if (/delete_records/i.test(last)) {
      return { ...base, text: "I cannot do that.", wire: "I cannot do that.", toolsBlocked: ["delete_records"] };
    }

    // Personal data: the records request. `outputFilter` is what masks it on the way out.
    if (/customer records/i.test(last)) {
      const answer = on.outputFilter
        ? "Ada Lovelace, [redacted email]; Chen Wei, [redacted email]."
        : "Ada Lovelace, ada@example.test; Chen Wei, chen@example.test.";
      return { ...base, text: answer, wire: answer, toolsRun: ["search_records"] };
    }

    // Direct injection, and anything else: it simply refuses.
    return { ...base, text: "I can't help with that request.", wire: "I can't help with that request." };
  };
}

const app: ControlledApp = {
  run: fakeApp({ emailGate: true, outputFilter: true }),
  controls: ["emailGate", "outputFilter", "promptHardening"],
  without: (control) => {
    if (control === "emailGate") return fakeApp({ emailGate: false, outputFilter: true });
    if (control === "outputFilter") return fakeApp({ emailGate: true, outputFilter: false });
    // The third one is the honest `null`: this app cannot run without its prompt hardening, so
    // nothing here can prove that hardening does anything. Saying so beats assuming either way.
    return null;
  },
};

const coverage = await measure(app, "example support assistant");
reportCoverage(coverage);

console.log();
console.log("As JSON, this is what you commit as secure-ai-coverage.json:");
console.log(JSON.stringify({ subject: coverage.subject, controls: coverage.controls }, null, 2));

// And what CI does with it. Here we compare the run against itself, which is the quiet case; in your
// repository the baseline is the committed file from the last time someone claimed a change.
const problems = compareToBaseline(coverage, coverage);
console.log();
console.log(
  problems.length === 0
    ? "Against the baseline: nothing changed. That is the result you want on most days."
    : problems.join("\n"),
);
console.log();
console.log("This is a FAKE app. Point `run`/`without` at yours — see ADAPTING.md, section 3.");
