// src/types.ts — the types the isolation module and the attack catalogue need.
//
// Extracted by script from the kit's lib/provider/types.ts and lib/retrieval/documents.ts, not
// rewritten: a second hand-written definition diverges from the original the moment either one
// changes, and then this repository would publish a shape the kit no longer uses.

/** Who said it. `tool` carries the result of a call the model asked for. */
export type Role = "system" | "user" | "assistant" | "tool";

/** A tool call as requested BY the model. Arguments are whatever it produced — never trusted. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * The model sent arguments that were not a JSON object. Set by the providers, refused by the tool
   * gate: a call nobody can read the arguments of is not a call anybody should run.
   */
  malformed?: boolean;
}

export interface Message {
  role: Role;
  content: string;
  /** Set on `tool` messages: which call this is the answer to. */
  toolCallId?: string;
  /** Set on `tool` messages: the tool that produced it. */
  name?: string;
  /** Set on `assistant` messages that asked for calls rather than answering. */
  toolCalls?: ToolCall[];
}

export interface RetrievedDocument {
  name: string;
  text: string;
  score: number;
}
