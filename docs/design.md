# Design

Why kite is built the way it is. The goal was an agent small enough to read in an afternoon, where each piece can be replaced without touching the others.

## The loop

`runAgent` ([src/agent/loop.ts](../src/agent/loop.ts)) is the whole idea in ~100 lines:

1. Compact the history if it is close to the model's limit.
2. Stream the model's reply.
3. If it asked for tools, run each one (after a permission check) and append the results.
4. Go back to 1. Stop when the model answers without tools, or after `maxTurns`.

The loop never prints, never reads the keyboard and never touches a file. It receives a provider, a list of tools and a callback, and that is why three different front ends can share it.

## Two event streams

There are two vocabularies, on purpose.

- **`StreamEvent`** goes *into* the loop from a provider: `text_delta` while the model is typing, then one `done` carrying the finished message.
- **`AgentEvent`** goes *out of* the loop to the front end: `text`, `permission_request`, `tool_start`, `tool_end`, `turn_end`, `message`, `compacted`.

Providers do not know about tools being executed or permissions. Front ends do not know about HTTP, SDKs or token formats. A provider author only writes `stream()`; a UI author only handles `AgentEvent`s.

## Providers

```ts
interface Provider {
  name: string;
  defaultModel: string;
  contextWindow?: number;
  stream(opts: StreamOptions): AsyncIterable<StreamEvent>;
}
```

Messages inside kite use one neutral format (`user`, `assistant` with text and tool-call blocks, `toolResult`). Each adapter translates to and from its API: [anthropic.ts](../src/providers/anthropic.ts) for the Anthropic SDK and [openai-compat.ts](../src/providers/openai-compat.ts) for anything that speaks the OpenAI chat format. Gemini and Groq are just that adapter pointed at their endpoints.

Every provider is wrapped by `withNormalizedErrors`, which turns SDK errors into one `ProviderError` with a readable message (bad key, wrong model, rate limit, server error, network). The SDKs do their own retries (set to 4).

## Tools

```ts
type Tool = ToolSpec & {
  risk?: "read" | "write" | "exec";
  execute(args, signal?): Promise<string>;
};
```

A tool takes JSON arguments and returns a string. Errors are thrown; the loop turns them into an `isError` tool result so the model can react. This is deliberate: a failed edit or a denied command is information for the model, not a crash.

`risk` is what the permission layer reads. A tool with no `risk` is treated as `exec`, so forgetting to declare one fails safe.

Safety lives in shared helpers rather than in each tool: `resolveInside` rejects paths outside the working directory (including through symlinks) and `truncate` caps output. `find` and `grep` are pure Node, not wrappers over `rg`, so they behave the same on Windows.

## Permissions

The loop calls `authorize(call, tool)` before running anything. The default authorizer ([src/permissions/index.ts](../src/permissions/index.ts)) decides in this order:

1. A **deny rule** matches: blocked, always (even with `--yes`).
2. The tool is `read`: allowed.
3. `--yes`: allowed.
4. An **allow rule** matches: allowed.
5. The tool was answered "always" earlier this session: allowed.
6. Otherwise **ask**; with nobody to ask, deny and say why.

Asking is injected as a function, so the same logic serves a readline prompt, the Ink panel and tests. Rules are `tool` or `tool:pattern` with `*` wildcards against the call's main argument (`command`, `path` or `message`). They are a convenience layer: a wildcard can be abused by a chained command, which is why sandboxing is the next big feature.

## Interruption

`AbortSignal` flows from the front end through `Runtime.send` into the loop, the provider's HTTP request and `bash`. On abort the loop stops at the next safe point. Any tool calls the model already requested get an "interrupted" result so the history stays valid: every tool call always has a matching result, and the conversation can continue.

## Sessions

A session is an append-only JSONL file ([src/session/index.ts](../src/session/index.ts)). Line types:

- `meta`: id, working directory, provider, model
- `message`: one conversation message
- `compaction`: "replace everything except the last `keep` messages with this summary"

Resuming is a pure function (`replay`) over the entries. Compaction is itself an appended entry, so the file is never rewritten and a crash can at worst leave a half-written last line, which the reader ignores.

## Compaction

Before each turn the loop estimates context size from the last assistant message's token usage. Past `compactAt` of the window, `compact()` renders the old messages to text, asks the same model for a summary and splices it in. The cut point never lands on a tool result, so a tool call and its result stay together. The estimate is approximate, which is fine: it only needs to fire before the real limit, not exactly at it.

## Runtime and front ends

`Runtime` ([src/runtime.ts](../src/runtime.ts)) owns the state that outlives a single turn: config, provider, model, messages, session, token totals and the authorizer (so "always this session" survives across prompts). Front ends are thin:

- **print**: `-p`, plain output, exits.
- **REPL**: readline loop plus slash commands.
- **TUI**: Ink. Its logic is split so most of it is testable without a terminal: a pure reducer turns `AgentEvent`s into transcript state ([state.ts](../src/tui/state.ts)), a pure function edits the input line ([input.ts](../src/tui/input.ts)), and the components only draw. Finished items go into Ink's `<Static>` so they are printed once and never redrawn, which avoids flicker in long sessions.

## Testing

73 tests run offline with `node --test` through tsx:

- tools against temp folders and a throwaway git repo (including path-escape attempts and a bash timeout);
- the loop, permissions, compaction and sessions with a scripted fake provider;
- the runtime end to end (persist, resume, abort, "always");
- the TUI through `ink-testing-library` (type a prompt, answer a permission panel, run a slash command).

Provider adapters are exercised manually against real APIs. They are the thinnest layer and the only one that needs network and keys.

## What was left out on purpose

- No plugin system or MCP yet. The `Tool` interface is small enough that adding them later is easy; adding them early would have hidden the core.
- No streaming tool-argument display. Arguments are shown once the call is complete.
- No markdown rendering in the UI.
- Cost tracking is not implemented; token counts are shown instead.
