import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { kiteHome } from "./config/index.ts";
import { runPrint } from "./modes/print.ts";
import { runRepl } from "./modes/repl.ts";
import { createTerminalAsk } from "./permissions/prompt.ts";
import { providerNames } from "./providers/index.ts";
import { Runtime, type RuntimeOptions } from "./runtime.ts";
import { listSessions, sessionsDir } from "./session/index.ts";

// API keys: ~/.kite/.env first, then ./.env. Real environment variables always win.
loadEnv({ path: [join(kiteHome(), ".env"), ".env"], quiet: true });

const USAGE = `kite - a terminal coding agent

Usage:
  kite                       interactive UI
  kite --repl                plain-text chat
  kite -p "prompt"           one prompt, then exit

Options:
  --provider <name>          ${providerNames.join(" | ")}
  --model <name>
  -c, --continue             resume the latest session in this folder
  -r, --resume <id>          resume a specific session
  --sessions                 list recent sessions
  -y, --yes                  allow every tool call without asking
  --max-turns <n>
  -h, --help`;

const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    provider: { type: "string" },
    model: { type: "string" },
    yes: { type: "boolean", short: "y", default: false },
    "max-turns": { type: "string" },
    resume: { type: "string", short: "r" },
    continue: { type: "boolean", short: "c", default: false },
    sessions: { type: "boolean", default: false },
    repl: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

async function main() {
  if (values.help) return console.log(USAGE);

  if (values.sessions) {
    const all = listSessions(sessionsDir(kiteHome())).slice(0, 20);
    if (!all.length) console.log("No sessions yet.");
    for (const s of all)
      console.log(`${s.id}  ${s.modified.toLocaleString()}  ${s.firstPrompt ?? ""}`);
    return;
  }

  const maxTurns = values["max-turns"] ? Number(values["max-turns"]) : undefined;
  if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns < 1))
    throw new Error("--max-turns must be a positive integer");

  const opts: RuntimeOptions = {
    flags: { provider: values.provider, model: values.model, maxTurns },
    yes: values.yes,
    resume: values.resume,
    continue: values.continue,
  };

  if (values.prompt) {
    await runPrint(new Runtime({ ...opts, ask: createTerminalAsk() }), values.prompt);
  } else if (values.repl) {
    await runRepl(opts);
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    const { runTui } = await import("./tui/index.tsx");
    await runTui(opts);
  } else {
    console.error(`No terminal for the interactive UI. Use -p "prompt" or --repl.\n\n${USAGE}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\nerror: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
