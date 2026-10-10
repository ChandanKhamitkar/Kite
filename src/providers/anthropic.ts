import Anthropic from "@anthropic-ai/sdk";
import type { Provider, StopReason, Message, ContentBlock } from "../types.ts";

function toAnthropic(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((msg): Anthropic.MessageParam => {
    if (msg.role === "user") return { role: "user", content: msg.content };
    if (msg.role === "assistant") {
      return {
        role: "assistant",
        content: msg.content.map(
          (m): Anthropic.ContentBlockParam =>
            m.type === "text"
              ? { type: "text", text: m.text }
              : {
                  type: "tool_use",
                  id: m.id,
                  name: m.name,
                  input: m.arguments,
                },
        ),
      };
    }

    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: msg.toolCallId,
          content: msg.content,
          is_error: msg.isError,
        },
      ],
    };
  });
}

export function createAnthropic(
  name?: string,
  baseURL?: string,
  apiKey?: string,
  model?: string,
  contextWindow = 200_000,
): Provider {
  const clientOptions = apiKey && baseURL ? { baseURL, apiKey } : {};
  const client = new Anthropic({ ...clientOptions, maxRetries: 4 });

  return {
    name: name || "anthropic",
    defaultModel: model || "claude-sonnet-5-5",
    contextWindow,
    async *stream({ messages, model, system, tools = [], signal }) {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 4096,
          system,
          messages: toAnthropic(messages),
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool.InputSchema,
          })),
        },
        { signal },
      );

      const content: ContentBlock[] = [];
      let json = "";

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;

          if (block.type === "text") content.push({ type: "text", text: "" });
          else if (block.type === "tool_use") {
            content.push({
              type: "toolCall",
              id: block.id,
              name: block.name,
              arguments: {},
            });
            json = "";
          }
        } else if (event.type === "content_block_delta") {
          const block = content.at(-1);

          if (event.delta.type === "text_delta" && block?.type === "text") {
            block.text += event.delta.text;
            yield {
              type: "text_delta",
              delta: event.delta.text,
            };
          } else if (event.delta.type === "input_json_delta") {
            json += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const block = content.at(-1);
          if (block?.type === "toolCall") block.arguments = json ? JSON.parse(json) : {};
        }
      }

      const final = await stream.finalMessage();

      const stopReason: StopReason =
        final.stop_reason === "tool_use"
          ? "toolUse"
          : final.stop_reason === "max_tokens"
            ? "length"
            : "stop";
      yield {
        type: "done",
        message: {
          role: "assistant",
          content,
          usage: {
            input: final.usage.input_tokens,
            output: final.usage.output_tokens,
          },
          stopReason,
        },
      };
    },
  };
}
