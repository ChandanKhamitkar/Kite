import { createInterface } from "node:readline/promises";

import { runCommand } from "../commands.ts";
import { createTerminalAsk } from "../permissions/prompt.ts";
import { isAbort, Runtime, type RuntimeOptions } from "../runtime.ts";
import { plainRenderer } from "./print.ts";

/** Simple multi-turn chat on plain readline (`kite --repl`). */
export async function runRepl(opts: RuntimeOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const rt = new Runtime({ ...opts, ask: createTerminalAsk(rl) });

  let controller: AbortController | undefined;
  rl.on("SIGINT", () => {
    if (controller) controller.abort();
    else rl.close();
  });

  console.log(`kite | ${rt.provider.name} | ${rt.model} | /help for commands, Ctrl+C to stop`);
  if (rt.resumed) console.log(`Resumed session ${rt.session.id} (${rt.messages.length} messages)`);

  let closed = false;
  rl.on("close", () => (closed = true));

  while (!closed) {
    let line: string;
    try {
      line = (await rl.question("\n> ")).trim();
    } catch {
      break; // input closed
    }
    if (!line) continue;

    controller = new AbortController();
    try {
      const result = await runCommand(rt, line, controller.signal);
      if (result) {
        if (result.output) console.log(result.output);
        if (result.exit) break;
      } else {
        await rt.send(line, { signal: controller.signal, onEvent: plainRenderer(rt) });
      }
    } catch (error) {
      console.log(isAbort(error) ? "\n interrupted" : `\nerror: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      controller = undefined;
    }
  }
  rl.close();
}
