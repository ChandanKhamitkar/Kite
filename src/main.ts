import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getProvider } from "./providers/index.ts";
import type { Message } from "./types.ts";
import { runAgent } from "./agent/loop.ts";
import { tools } from "./tools/index.ts";
import { createAuthorizer } from "./permissions/index.ts";
import { createTerminalAsk } from "./permissions/prompt.ts";
import { kiteHome, loadConfig } from "./config/index.ts";
import { buildSystemPrompt } from "./config/prompt.ts";
import {
  createSession,
  latestSession,
  listSessions,
  resumeSession,
  sessionsDir,
} from "./session/index.ts";

loadEnv({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

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
  },
});

async function main() {
  const dir = sessionsDir(kiteHome());

  if (values.sessions) {
    const all = listSessions(dir).slice(0, 20);
    if (!all.length) console.log("No sessions yet.");
    for (const s of all)
      console.log(`${s.id}  ${s.modified.toLocaleString()}  ${s.firstPrompt ?? ""}`);
    return;
  }

  if (!values.prompt) {
    console.error(
      `No prompt bhai!, try: node src/main.ts -p "prompt" [--provider anthropic|anthropic-xkiro|gemini|groq] [--continue | --resume <id>] [--yes] | --sessions`,
    );
    process.exit(1);
  }

  const cfg = loadConfig({
    flags: {
      provider: values.provider,
      model: values.model,
      maxTurns: values["max-turns"] ? Number(values["max-turns"]) : undefined,
    },
  });
  if (!Number.isInteger(cfg.maxTurns) || cfg.maxTurns < 1)
    throw new Error("--max-turns must be a positive integer");

  const provider = getProvider(cfg.provider);
  const model = cfg.model ?? provider.defaultModel;
  const contextWindow = cfg.contextWindow ?? provider.contextWindow;

  // Start a new session, or pick up an old one.
  const resumeId =
    values.resume ?? (values.continue ? latestSession(dir, process.cwd())?.id : undefined);
  if (values.continue && !resumeId) console.error("No earlier session in this folder; starting a new one.");

  let messages: Message[] = [];
  let session;
  if (resumeId) {
    ({ session, messages } = resumeSession(dir, resumeId));
    console.log(`Resumed session ${session.id} (${messages.length} messages)`);
  } else {
    session = createSession({ dir, cwd: process.cwd(), provider: provider.name, model });
  }

  const userMessage: Message = { role: "user", content: values.prompt };
  messages.push(userMessage);
  session.append({ type: "message", message: userMessage });

  await runAgent({
    provider,
    model,
    system: buildSystemPrompt({ extra: cfg.systemPrompt }),
    tools,
    messages,
    maxTurns: cfg.maxTurns,
    compaction: contextWindow
      ? { contextWindow, threshold: cfg.compactAt, keepRecent: cfg.keepRecent }
      : undefined,
    authorize: createAuthorizer({
      ask: createTerminalAsk(),
      yes: values.yes,
      rules: cfg.permissions,
    }),
    onEvent(event) {
      if (event.type === "message") session.append({ type: "message", message: event.message });
      else if (event.type === "compacted") {
        session.append({ type: "compaction", summary: event.summary, keep: event.keep });
        console.log(`\n (compacted context: ${event.before} -> ${event.after} messages)`);
      } else if (event.type === "text") process.stdout.write(event.delta);
      else if (event.type === "tool_start") console.log(`\n ${event.call.name}`);
      else if (event.type === "tool_end") {
        const lines = event.result.split("\n").length;
        console.log(`\n ${event.isError ? event.result : lines}`);
      } else if (event.type === "turn_end") {
        const { usage, stopReason } = event.message;
        console.log(
          `\n\n Provider Name=${provider.name} ... Model=${model} ... Usage Input=${usage.input} ... Usage Output=${usage.output} ... StopReason=${stopReason}`,
        );
      }
    },
  });

  console.log(`\n session: ${session.id}  (continue with --continue or --resume ${session.id})`);
}

main().catch((error) => {
  console.error(`\nerror: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
