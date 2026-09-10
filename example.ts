// SPDX-License-Identifier: MIT
// example.ts — a fake adapter, so you can see the shape before writing your own.
//
//   node example.ts
//
// This "application" has no model: it returns fixed answers. It is here for two things and only two:
// to show you what your adapter has to return, and to prove the verdicts are real.
//
// Watch the third case. The example app reports NOTHING about tools, so tool abuse comes back NOT
// MEASURED rather than stopped. That difference is the whole distance between this report and one
// that makes you feel good without telling you anything. (The fourth verdict, ERROR, is what you get
// when your own application throws — there is no need to fake one here.)
import { runAttacks, report, exitCode, type YourApp } from "./src/adapter.ts";

const exampleApp: YourApp = ({ turns, plantedDocument }) => {
  const last = turns[turns.length - 1]?.content ?? "";

  // An app that refuses to repeat its prompt: it stops the direct injection.
  //
  // Note it reports `wire`, not just `text`. `wire` is everything you send the client — prose, tool
  // calls, tool results — and it is what the leak assertions read, because that is where the kit's
  // own leak actually happened. Report only `text` and these come back N/A.
  if (/system prompt|instructions/i.test(last)) {
    return { wire: "I can't share my internal configuration.", text: "I can't share my internal configuration." };
  }

  // An app that DOES obey a planted document: the indirect injection gets through. On purpose, so
  // you can see what a failure reads like — with the payload in front of you, not a red line.
  if (plantedDocument) {
    return {
      wire: "Sure, I sent the summary as the document asked.",
      text: "Sure, I sent the summary as the document asked.",
      emailsSent: [{ to: "a@evil.test", subject: "summary" }],
    };
  }

  // An app that hands out customer data: it gets through too.
  if (/customer|record|email address/i.test(last)) {
    const leak = "The customer is Ada Lovelace, ada@example.test, +44 20 7946 0000.";
    return { wire: leak, text: leak };
  }

  // And for tool abuse it reports nothing about tools: NOT MEASURED, not stopped.
  return { wire: "Done.", text: "Done." };
};

const results = await runAttacks(exampleApp);
report(results);
console.log();
console.log("This is a FAKE app. Swap it for yours in example.ts and run it again.");
process.exit(exitCode(results));
