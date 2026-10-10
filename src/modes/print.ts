import type { AgentEvent } from "../agent/loop.ts";
import { isAbort, type Runtime } from "../runtime.ts";

/** Plain-text renderer for agent events (used by print mode and the REPL). */
export function plainRenderer(rt: Runtime): (event: AgentEvent) => void {
  return (event) => {
    if (event.type === "text") process.stdout.write(event.delta);
    else if (event.type === "tool_start") console.log(`\n ${event.call.name}`);
    else if (event.type === "tool_end") {
      const lines = event.result.split("\n").length;
      console.log(` ${event.isError ? event.result : `${lines} line${lines === 1 ? "" : "s"}`}`);
    } else if (event.type === "compacted") {
      console.log(`\n (compacted context: ${event.before} -> ${event.after} messages)`);
    } else if (event.type === "turn_end") {
      const { usage, stopReason } = event.message;
      console.log(
        `\n\n ${rt.provider.name} | ${rt.model} | in ${usage.input} out ${usage.output} | ${stopReason}`,
      );
    }
  };
}

/** One prompt in, answer out (`kite -p "..."`). */
export async function runPrint(rt: Runtime, prompt: string): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    if (rt.resumed)
      console.log(`Resumed session ${rt.session.id} (${rt.messages.length} messages)`);
    await rt.send(prompt, { signal: controller.signal, onEvent: plainRenderer(rt) });
  } catch (error) {
    if (!isAbort(error)) throw error;
    console.log("\n interrupted");
  } finally {
    process.off("SIGINT", onSigint);
  }
  console.log(
    `\n session: ${rt.session.id}  (continue with --continue or --resume ${rt.session.id})`,
  );
}
