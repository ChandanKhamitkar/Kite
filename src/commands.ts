import { providerNames } from "./providers/index.ts";
import type { Runtime } from "./runtime.ts";
import { listSessions } from "./session/index.ts";

export type CommandResult = {
  output: string;
  /** The front end should quit. */
  exit?: boolean;
  /** The front end should clear the visible transcript. */
  clear?: boolean;
};

export const HELP = `Commands:
  /help                       show this list
  /model [name]               show or change the model
  /provider [name] [model]    show or change the provider
  /compact                    summarize older messages now
  /clear                      start a new conversation
  /sessions                   list recent sessions
  /cost                       token usage so far
  /exit                       quit`;

/** Handle a slash command. Returns undefined when the line is not one. */
export async function runCommand(
  rt: Runtime,
  line: string,
  signal?: AbortSignal,
): Promise<CommandResult | undefined> {
  if (!line.startsWith("/")) return undefined;
  const [name, ...args] = line.slice(1).trim().split(/\s+/);

  switch (name) {
    case "help":
      return { output: HELP };

    case "exit":
    case "quit":
      return { output: "", exit: true };

    case "model":
      if (!args[0]) return { output: `model: ${rt.model} (provider ${rt.provider.name})` };
      rt.setModel(args[0]);
      return { output: `model set to ${rt.model}` };

    case "provider":
      if (!args[0])
        return { output: `provider: ${rt.provider.name}. Available: ${providerNames.join(", ")}` };
      try {
        rt.switchProvider(args[0], args[1]);
      } catch (error) {
        return { output: `error: ${error instanceof Error ? error.message : String(error)}` };
      }
      return { output: `provider set to ${rt.provider.name}, model ${rt.model}` };

    case "compact": {
      const done = await rt.compactNow(signal);
      return {
        output: done
          ? `compacted ${done.before} messages into ${done.after}`
          : "nothing to compact yet",
      };
    }

    case "clear":
      rt.clear();
      return { output: `new session ${rt.session.id}`, clear: true };

    case "sessions": {
      const all = listSessions(rt.sessionsDir).slice(0, 10);
      if (!all.length) return { output: "no sessions yet" };
      return {
        output: all
          .map((s) => `${s.id}${s.id === rt.session.id ? " *" : ""}  ${s.firstPrompt ?? ""}`)
          .join("\n"),
      };
    }

    case "cost": {
      const { input, output, turns } = rt.usage;
      const fill = rt.contextWindow ? ` | context ${Math.round(rt.contextFill * 100)}% full` : "";
      return { output: `${turns} turns | ${input} input + ${output} output tokens${fill}` };
    }

    default:
      return { output: `unknown command /${name}. Try /help` };
  }
}
