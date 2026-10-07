import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getProvider } from "./providers/index.ts";
import type { Message, AssistantMessage } from "./types.ts";
import { readTool } from "./tools/read.ts";

config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

const tools = [readTool];

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

async function callModel(): Promise<AssistantMessage> {
  for await (const event of provider.stream({ messages, model, tools })) {
    if (event.type === "text_delta") process.stdout.write(event.delta);
    else {
      const { usage, stopReason } = event.message;
      console.log(
        `\n\n Provider Name=${provider.name} ... Model=${model} ... Usage Input=${usage.input} ... Usage Output=${usage.output} ... StopReason=${stopReason}`,
      );

      return event.message;
    }
  }

  throw new Error("Stream ended without a done event");
}

const first = await callModel();
messages.push(first);

if (first.stopReason === "toolUse") {
  for (const block of first.content) {
    if (block.type !== "toolCall") continue;

    console.log(`-> ${block.name}(${JSON.stringify(block.arguments)})`);
    const result = await readTool.execute(block.arguments);
    messages.push({
      role: "toolResult",
      toolCallId: block.id,
      toolName: block.name,
      content: result,
      isError: false,
    });
  }

  messages.push(await callModel());
}
