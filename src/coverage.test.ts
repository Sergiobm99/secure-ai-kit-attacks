// SPDX-License-Identifier: MIT
// src/coverage.test.ts — `node src/coverage.test.ts`
//
// The guards for the two claims this repository now makes about your application:
//
//   1. a control is "demonstrated" only when removing it lets an attack through;
//   2. nothing here ever produces a score.
//
// The second one has its own test on purpose. A total is the easiest thing in the world to add
// later "just for the README", and it is exactly the failure the 2026-09-09 audit found in the
// kit's own front page. A rule nobody checks is a rule that lasts until someone is in a hurry.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runAttacks, type Result } from "./adapter.ts";
import { compareToBaseline, measure, reportCoverage, type ControlledApp, type Coverage } from "./coverage.ts";
import { httpApp } from "./http-adapter.ts";
import type { Outcome } from "./attacks/catalogue.ts";

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------------
// A toy application with two controls. `emailGate` really stops the indirect attack; `theatre` is a
// control that does nothing, which is the case that matters: a suite that cannot tell the two apart
// is a suite that will call anything protected.
const SAFE: Partial<Outcome> = {
  text: "Done.",
  wire: "Done.",
  toolsRun: [],
  recordsBefore: 4,
  recordsAfter: 4,
  emailsSent: [],
};

function toy(withGate: boolean): ControlledApp["run"] {
  return () => (withGate ? SAFE : { ...SAFE, emailsSent: [{ to: "a@evil.test", subject: "summary" }] });
}

const app: ControlledApp = {
  run: toy(true),
  controls: ["emailGate", "theatre"],
  without: (control) => (control === "emailGate" ? toy(false) : toy(true)),
};

const coverage = await measure(app, "toy app");

const gate = coverage.controls.find((c) => c.control === "emailGate")!;
check(gate.demonstrated, "a control that is load-bearing is demonstrated");
check(gate.demonstratedBy.length > 0, "and the evidence is named: which attacks get through without it");
check(gate.why === undefined, "a demonstrated control carries no excuse");

const theatre = coverage.controls.find((c) => c.control === "theatre")!;
check(!theatre.demonstrated, "a control that changes nothing is NOT demonstrated");
check(theatre.demonstratedBy.length === 0, "and has no evidence to show");
check((theatre.why ?? "").includes("does NOT mean it is proved"), "and says what that does and does not mean");
check(
  !/\bfail(ed|ure|ing)?\b/i.test(theatre.why ?? ""),
  "without calling it a failure: absence of evidence is not evidence of absence",
);

// --- an application that cannot remove a control
const rigid: ControlledApp = { run: toy(true), controls: ["emailGate"], without: () => null };
const sinPalanca = await measure(rigid, "rigid app");
check(!sinPalanca.controls[0]!.demonstrated, "an app that cannot switch a control off proves nothing about it");
check(
  (sinPalanca.controls[0]!.why ?? "").includes("cannot run without this control"),
  "and the report says that is why, instead of assuming either way",
);

// ---------------------------------------------------------------------------------------------------
// NO SCORE. Structural, not a spot check.
const claves = Object.keys(coverage).sort();
check(
  JSON.stringify(claves) === JSON.stringify(["attacks", "controls", "subject"]),
  "the coverage object has exactly subject/controls/attacks — no room for a total",
);
const crudo = JSON.stringify(coverage);
check(
  !/score|total|percent|rating|grade|"level"/i.test(crudo),
  "and no field anywhere that reads like a score",
);

const dicho: string[] = [];
const real = console.log;
console.log = (...a: unknown[]) => void dicho.push(a.join(" "));
reportCoverage(coverage);
console.log = real;
const salida = dicho.join("\n");
check(!/\d+\s*\/\s*\d+/.test(salida), "the printed report has no N/M anywhere");
check(!/\d+\s*%/.test(salida), "and no percentage");
check(salida.includes("There is no total here on purpose"), "and says out loud that the absence is deliberate");

// ---------------------------------------------------------------------------------------------------
// The baseline, in BOTH directions.
const antes: Coverage = JSON.parse(JSON.stringify(coverage)) as Coverage;

const perdido: Coverage = JSON.parse(JSON.stringify(coverage)) as Coverage;
perdido.controls.find((c) => c.control === "emailGate")!.demonstrated = false;
const regresion = compareToBaseline(antes, perdido);
check(regresion.some((p) => p.includes("security regression")), "a control that stops being load-bearing is a regression");

const ganado: Coverage = JSON.parse(JSON.stringify(coverage)) as Coverage;
ganado.controls.find((c) => c.control === "theatre")!.demonstrated = true;
const sinReclamar = compareToBaseline(antes, ganado);
check(
  sinReclamar.some((p) => p.includes("update the baseline in the SAME commit")),
  "and a control that starts being load-bearing without anyone claiming it also fails: that is luck",
);

check(compareToBaseline(antes, coverage).length === 0, "an unchanged run has nothing to report");

// ---------------------------------------------------------------------------------------------------
// The HTTP adapter: every way of not getting an answer is an ERROR, never a defence.
async function conServidor(
  responder: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
  probar: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer(responder);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  try {
    await probar(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}

const veredictos = (r: Result[]): string[] => r.map((x) => x.verdict);

await conServidor(
  (_req, res) => {
    res.writeHead(500);
    res.end("boom");
  },
  async (url) => {
    const r = await runAttacks(httpApp({ url }));
    check(veredictos(r).every((v) => v === "error"), "a 500 from your app is an ERROR for every attack");
    check(!veredictos(r).includes("stopped"), "and never, under any circumstances, a stopped");
    check(
      r[0]!.detail.includes("a refusal") && r[0]!.detail.includes("look the same"),
      "and the reason says why a non-200 cannot be read as a defence",
    );
  },
);

await conServidor(
  (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("no soy json");
  },
  async (url) => {
    const r = await runAttacks(httpApp({ url }));
    check(veredictos(r).every((v) => v === "error"), "a 200 with a body that is not JSON is an ERROR too");
  },
);

await conServidor(
  (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "Done.", wire: "Done." }));
  },
  async (url) => {
    const r = await runAttacks(httpApp({ url }));
    const abuso = r.find((x) => x.attack.id === "tool-abuse")!;
    check(abuso.verdict === "not-applicable", "a field your app did not report stays unreported: N/A, not stopped");
    check(abuso.detail.includes("toolsRun"), "and the report names the field you are missing");
  },
);

await conServidor(
  (_req, res) => {
    // Never answers. The client has to give up on its own.
    void res;
  },
  async (url) => {
    const r = await runAttacks(httpApp({ url, timeoutMs: 150 }));
    check(veredictos(r).every((v) => v === "error"), "an application that hangs is an ERROR");
    check(r[0]!.detail.includes("not a defence"), "and the reason says a hung app is not a defence");
  },
);

if (failures > 0) {
  console.log(`\ncoverage.test.ts: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\ncoverage.test.ts: all checks passed");
