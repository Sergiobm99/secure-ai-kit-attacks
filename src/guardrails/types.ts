// lib/guardrails/types.ts — the seam every guardrail plugs into.
//
// A guardrail is a set of optional hooks, run in registration order at four points in the agent
// loop. Keeping them small and separate is what lets each one be written, tested and reverted on its
// own — and reverting one to watch its attack reopen is how the kit proves a guardrail is real.
//
// TWO KINDS OF GUARDRAIL, and the difference decides how each is demonstrated:
//
//   DETERMINISTIC INTERCEPTOR — acts on execution, not on the model: gateTool blocks a call,
//     filterOutput redacts an answer, inspectInput refuses a turn before the model runs. Replaying
//     the recorded before-transcript THROUGH the guarded agent shows red→green with no model at all,
//     because the guardrail catches the same canned behaviour. This is the strong demonstration.
//
//   MODEL-BEHAVIOUR — changes what the model sees (frameContext relabels untrusted content). It
//     cannot be shown by replay: replay ignores the prompt and plays the old chunks back regardless.
//     Its demonstration is LIVE and statistical — the injection lands N times without it and far
//     fewer with it — and that is stated honestly rather than dressed up as deterministic.
import type { ToolCall, RetrievedDocument } from "../types.ts";

export type Decision = { allow: true } | { allow: false; reason: string };

export const ALLOW: Decision = { allow: true };
export function block(reason: string): Decision {
  return { allow: false, reason };
}

export interface Guardrail {
  readonly id: string;

  /** Runs before the model is called. A block refuses the turn; the model never sees it. */
  inspectInput?(userTurn: string): Decision;

  /**
   * Turns retrieved documents into the block that goes in the prompt. Its PRESENCE also changes
   * placement: with no context guardrail the agent glues retrieved text onto the user turn (the
   * naive, vulnerable baseline); with one, the returned block is placed separately and labelled.
   */
  frameContext?(documents: RetrievedDocument[]): string;

  /** Runs before a tool call executes. A block stops the call and the model is told it was refused. */
  gateTool?(call: ToolCall): Decision;

  /** Runs on the finished answer text before it leaves. Returns the text to actually send. */
  filterOutput?(answer: string): string;
}
