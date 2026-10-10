import { createInterface } from "node:readline/promises";

import type { Ask, Verdict } from "./index.ts";
import { describeCall } from "./index.ts";

/** Terminal prompt. Returns undefined when there is no interactive stdin. */
export function createTerminalAsk(): Ask | undefined {
  if (!process.stdin.isTTY) return undefined;

  return async (call, tool) => {
    console.log(`\n? ${call.name} wants to run (${tool.risk ?? "exec"}):`);
    console.log(describeCall(call));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const answer = (
          await rl.question("  Allow? [y]es / [n]o / [a]lways this session: ")
        )
          .trim()
          .toLowerCase();
        const verdict: Record<string, Verdict> = {
          y: "allow",
          yes: "allow",
          n: "deny",
          no: "deny",
          a: "allow_session",
          always: "allow_session",
        };
        if (verdict[answer]) return verdict[answer];
      }
    } finally {
      rl.close();
    }
  };
}
