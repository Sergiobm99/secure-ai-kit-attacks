// SPDX-License-Identifier: MIT
// src/http-adapter.ts — point the attacks at an application that lives behind a URL.
//
// `example.ts` calls a function in the same process, which is the shape nobody actually has. Yours
// is behind HTTP, so this is the adapter you will really start from.
//
// WHAT YOU HAVE TO BUILD, said plainly: an endpoint that takes one attack's turns and answers with
// what happened. Your product almost certainly does not have that endpoint today, and it should not
// — it is a testing seam, not a feature. A dozen lines in your own codebase, mounted only when a
// test flag is on, is the normal shape. `ADAPTING.md` says what each attack needs you to report.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. Every way of not getting an answer — a timeout, a 500, a
// body that is not JSON, a socket that dies — reports ERROR. None of them reports "stopped". An
// attack that could not be run is not an attack that was defended, and the difference is the entire
// value of the suite: a harness that swallows its own failures prints a clean page for an
// application nobody tested.
import type { Outcome } from "./attacks/catalogue.ts";
import type { YourApp } from "./adapter.ts";

export interface HttpAppOptions {
  /** Where your testing endpoint lives. */
  url: string;
  /** Milliseconds before a turn is given up on. A hung app is an ERROR, never a defence. */
  timeoutMs?: number;
  /** Anything else your endpoint needs — an auth token for the test flag, say. */
  headers?: Record<string, string>;
}

/** Thrown for every "no usable answer". `runAttacks` turns it into an ERROR verdict. */
export class HttpAdapterError extends Error {}

/**
 * The fields we will read off your response, and nothing else.
 *
 * A response carrying extra keys is fine and they are ignored. What is NOT fine is inventing the
 * ones you left out: a missing field has to stay missing all the way into the verdict, because
 * `adapter.ts` turns a missing field into N/A and an invented one into a false "stopped".
 */
const FIELDS: (keyof Outcome)[] = [
  "text",
  "wire",
  "toolCalls",
  "toolsRun",
  "toolsBlocked",
  "retrieved",
  "recordsBefore",
  "recordsAfter",
  "emailsSent",
];

/** Builds a `YourApp` that POSTs each attack to your endpoint. */
export function httpApp(options: HttpAppOptions): YourApp {
  const { url, timeoutMs = 30_000, headers = {} } = options;

  return async ({ turns, plantedDocument }) => {
    const control = new AbortController();
    const alarm = setTimeout(() => control.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ turns, plantedDocument }),
        signal: control.signal,
      });
    } catch (e) {
      throw new HttpAdapterError(
        control.signal.aborted
          ? `no answer in ${timeoutMs}ms. A hung application is an ERROR, not a defence.`
          : `could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(alarm);
    }

    if (!response.ok) {
      // Deliberately NOT treated as "the app refused the attack". A 403 from your framework and a
      // guardrail deciding to refuse look identical from out here, and calling that "stopped" is
      // how a suite starts lying. If refusing IS your defence, report it in `text`/`wire` with a
      // 200 and let the attack's own assertion judge it.
      throw new HttpAdapterError(
        `${url} answered ${response.status}. That is an error, not a verdict: from here a refusal ` +
          `by your guardrail and a crash in your framework look the same.`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new HttpAdapterError(`${url} answered 200 with a body that is not JSON.`);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpAdapterError(`${url} answered 200 with JSON that is not an object.`);
    }

    // Copy across only what is actually present. `undefined` has to survive: it is what makes the
    // difference between "no tool ran" and "I did not look at whether a tool ran".
    const partial: Partial<Outcome> = {};
    for (const field of FIELDS) {
      const value = (body as Record<string, unknown>)[field];
      if (value !== undefined) {
        (partial as Record<string, unknown>)[field] = value;
      }
    }
    return partial;
  };
}
