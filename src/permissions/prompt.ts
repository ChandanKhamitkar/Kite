import { createInterface, type Interface } from "node:readline/promises";

import type { Ask, Verdict } from "./index.ts";
import { describeCall } from "./index.ts";

const VERDICTS: Record<string, Verdict> = {
  y: "allow",
  yes: "allow",
  n: "deny",
  no: "deny",
  a: "allow_session",
  always: "allow_session",
};

/**
 * Terminal prompt. Pass the REPL's readline interface to share it; otherwise
 * a short-lived one is used. Returns undefined when there is no interactive stdin.
 */
export function createTerminalAsk(shared?: Interface): Ask | undefined {
  if (!shared && !process.stdin.isTTY) return undefined;

  return async (call, tool) => {
    console.log(`\n? ${call.name} wants to run (${tool.risk ?? "exec"}):`);
    console.log(describeCall(call));

    const rl = shared ?? createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const answer = (await rl.question("  Allow? [y]es / [n]o / [a]lways this session: "))
          .trim()
          .toLowerCase();
        if (VERDICTS[answer]) return VERDICTS[answer];
      }
    } finally {
      if (!shared) rl.close();
    }
  };
}
