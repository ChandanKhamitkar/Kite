import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { parseArgs } from "node:util";

config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    model: { type: "string", default: "mistralai/mistral-medium-3.5" },
  },
});

if (!values.prompt) {
  console.error("No prompt bhai!");
  process.exit(1);
}

const client = new Anthropic({
  apiKey: process.env.XKIRO_API_KEY,
  baseURL: "https://api.xkiro.com",
});

const message = await client.messages.create({
  max_tokens: 1024,
  system: "You are a concise assistant.",
  messages: [
    {
      role: "user",
      content: values.prompt,
    },
  ],
  model: values.model,
});

console.log(message.content);
