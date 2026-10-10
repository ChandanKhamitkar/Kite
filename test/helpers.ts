import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage, Provider, ToolCallBlock } from "../src/types.ts";

/** Point KITE_HOME at a temp folder for the duration of a test file. */
export function useTempHome() {
  let dir = "";
  let previous: string | undefined;
  return {
    setup() {
      previous = process.env.KITE_HOME;
      dir = mkdtempSync(join(tmpdir(), "kite-home-"));
      process.env.KITE_HOME = dir;
      return dir;
    },
    teardown() {
      if (previous === undefined) delete process.env.KITE_HOME;
      else process.env.KITE_HOME = previous;
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

export type Script = { text?: string; calls?: ToolCallBlock[] };

/**
 * A provider that plays back one scripted reply per call, then "done".
 * Each reply streams its text, and ends with tool calls if it has any.
 */
export function scriptedProvider(script: Script[], opts: { contextWindow?: number } = {}): Provider & { requests: number } {
  const p = {
    name: "fake",
    defaultModel: "fake-1",
    contextWindow: opts.contextWindow,
    requests: 0,
    async *stream({ signal }: { signal?: AbortSignal }) {
      signal?.throwIfAborted();
      const step = script[p.requests++] ?? { text: "done" };
      if (step.text) yield { type: "text_delta" as const, delta: step.text };
      const message: AssistantMessage = {
        role: "assistant",
        content: [
          ...(step.text ? [{ type: "text" as const, text: step.text }] : []),
          ...(step.calls ?? []),
        ],
        usage: { input: 10, output: 5 },
        stopReason: step.calls?.length ? "toolUse" : "stop",
      };
      yield { type: "done" as const, message };
    },
  };
  return p;
}

export const toolCall = (id: string, name: string, args: Record<string, unknown> = {}): ToolCallBlock => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
