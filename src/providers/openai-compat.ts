import OpenAI from "openai";
import type {
  ContentBlock,
  Provider,
  StopReason,
  Usage,
  Message,
} from "../types.ts";

function toOpenAI(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg): OpenAI.ChatCompletionMessageParam => {
    if (msg.role === "user") return { role: "user", content: msg.content };
    if (msg.role === "assistant") {
      const text = msg.content
        .filter((m) => m.type === "text")
        .map((m) => m.text)
        .join("");
      const calls = msg.content.filter((m) => m.type === "toolCall");
      return {
        role: "assistant",
        content: text || null,
        tool_calls: calls.length
          ? calls.map((tool) => ({
              id: tool.id,
              type: "function" as const,
              function: {
                name: tool.name,
                arguments: JSON.stringify(tool.arguments),
              },
            }))
          : undefined,
      };
    }

    return {
      role: "tool",
      tool_call_id: msg.toolCallId,
      content: msg.content,
    };
  });
}

export function createOpenAICompat(
  name: string,
  baseURL: string,
  apiKey: string,
  defaultModel: string,
  contextWindow = 128_000,
): Provider {
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 4 });

  return {
    name,
    defaultModel,
    contextWindow,
    async *stream({ messages, model, system, tools = [] }) {
      const chat = toOpenAI(messages);

      const stream = await client.chat.completions.create({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: system
          ? [{ role: "system", content: system }, ...chat]
          : chat,
        tools: tools.length
          ? tools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            }))
          : undefined,
      });

      let text = "";
      const calls: {
        id: string;
        name: string;
        args: string;
      }[] = [];
      let usage: Usage = { input: 0, output: 0 };
      let stopReason: StopReason = "stop";

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          text += choice.delta.content;
          yield {
            type: "text_delta",
            delta: choice.delta.content,
          };
        }

        for (const tc of choice?.delta?.tool_calls ?? []) {
          calls[tc.index] ??= {
            id: tc.id ?? `call_${tc.index}`,
            name: tc.function?.name ?? "",
            args: "",
          };
          calls[tc.index].args += tc.function?.arguments ?? "";
        }

        if (choice?.finish_reason === "tool_calls") stopReason = "toolUse";
        else if (choice?.finish_reason === "length") stopReason = "length";
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens,
            output: chunk.usage.completion_tokens,
          };
        }
      }
      const content: ContentBlock[] = text ? [{ type: "text", text }] : [];
      for (const c of calls) {
        if (c)
          content.push({
            type: "toolCall",
            id: c.id,
            name: c.name,
            arguments: c.args ? JSON.parse(c.args) : {},
          });
      }
      if (content.some((b) => b.type === "toolCall")) stopReason = "toolUse";
      yield {
        type: "done",
        message: {
          role: "assistant",
          content,
          usage,
          stopReason,
        },
      };
    },
  };
}
