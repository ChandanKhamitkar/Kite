import type { Authorizer } from "../permissions/index.ts";
import { compact, contextTokens, type Compaction } from "./compact.ts";
import type {
  AssistantMessage,
  Message,
  Provider,
  Tool,
  ToolCallBlock,
  ToolRisk,
} from "../types.ts";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "permission_request"; call: ToolCallBlock; risk: ToolRisk }
  | { type: "tool_start"; call: ToolCallBlock }
  | { type: "tool_end"; call: ToolCallBlock; result: string; isError: boolean }
  | { type: "turn_end"; message: AssistantMessage }
  | { type: "message"; message: Message }
  | ({ type: "compacted" } & Compaction);

export type AgentOptions = {
  provider: Provider;
  model: string;
  system?: string;
  tools: Tool[];
  messages: Message[];
  maxTurns?: number;
  /** Abort to stop after the current step; history stays valid. */
  signal?: AbortSignal;
  /** Called before every tool runs. Without it, every tool is allowed. */
  authorize?: Authorizer;
  /** Summarize old messages when the context nears the model's window. */
  compaction?: { contextWindow: number; threshold: number; keepRecent: number };
  onEvent: (event: AgentEvent) => void;
};
export async function runAgent(opts: AgentOptions) {
  const { provider, model, system, tools, messages, onEvent } = opts;
  const maxTurns = opts.maxTurns ?? 20;
  const push = (message: Message) => {
    messages.push(message);
    onEvent({
      type: "message",
      message,
    });
  };

  const { signal } = opts;

  for (let turn = 1; turn <= maxTurns; ++turn) {
    signal?.throwIfAborted();
    const c = opts.compaction;
    if (c && contextTokens(messages) >= c.contextWindow * c.threshold) {
      const done = await compact({ provider, model, messages, keepRecent: c.keepRecent });
      if (done) onEvent({ type: "compacted", ...done });
    }

    let assistant: AssistantMessage | undefined;

    for await (const event of provider.stream({
      messages,
      model,
      system,
      tools,
      signal,
    })) {
      if (event.type === "text_delta")
        onEvent({ type: "text", delta: event.delta });
      else assistant = event.message;
    }

    if (!assistant) throw new Error("Ntg in assistant!");
    push(assistant);
    onEvent({
      type: "turn_end",
      message: assistant,
    });

    if(assistant.stopReason !== "toolUse") return;

    for (const call of assistant.content) {
      if (call.type !== "toolCall") continue;
      onEvent({ type: "tool_start", call });

      let result: string;
      let isError = false;

      try {
        if (signal?.aborted) throw new Error("interrupted by user");
        const tool = tools.find((tool) => tool.name === call.name);
        if (!tool) throw new Error(`unknown tool name ${call.name}`);

        if (opts.authorize) {
          onEvent({ type: "permission_request", call, risk: tool.risk ?? "exec" });
          const decision = await opts.authorize(call, tool);
          if (!decision.allow)
            throw new Error(decision.reason ?? "permission denied");
        }

        result = await tool.execute(call.arguments, signal);
      } catch (error) {
        result = `Error ${error instanceof Error ? error.message : String(error)}`;
        isError = true;
      }
      onEvent({ type: "tool_end", call, result, isError });
      push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: result,
        isError,
      });
    }
  }
  throw new Error(`stopped after ${maxTurns}.`);
}
