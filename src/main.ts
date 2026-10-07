import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getProvider } from "./providers/index.ts";
import type { Message } from "./types.ts";
import { runAgent } from "./agent/loop.ts";
import { tools } from "./tools/index.ts";

config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    provider: { type: "string", default: "anthropic-xkiro" },
    model: { type: "string" },
  },
});

if (!values.prompt) {
  console.error(
    `No prompt bhai!, try this $ node src/main.ts -p "prompt" --provider anthropic-xkiro or anthropic`,
  );
  process.exit(1);
}

const provider = getProvider(values.provider);
const model = values.model ?? provider.defaultModel;
const messages: Message[] = [
  {
    role: "user",
    content: values.prompt,
  },
];

await runAgent({
  provider,
  model,
  tools,
  messages,
  onEvent(event) {
    if (event.type === "text") process.stdout.write(event.delta);
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