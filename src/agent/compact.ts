import type { Message, Provider, UserMessage } from "../types.ts";

export type Compaction = {
  /** Message count before and after. */
  before: number;
  after: number;
  summary: UserMessage;
  /** How many trailing messages were kept verbatim. */
  keep: number;
};

export type CompactOptions = {
  provider: Provider;
  model: string;
  messages: Message[];
  keepRecent: number;
};

const RESULT_CHARS = 1500;
const TRANSCRIPT_CHARS = 200_000;

/**
 * Index where the kept tail should start, or 0 if there is nothing worth
 * summarizing. Never starts the tail on a tool result, so a tool call and its
 * result are never split.
 */
export function findCut(messages: Message[], keepRecent: number): number {
  let cut = messages.length - keepRecent;
  while (cut > 0 && messages[cut]?.role === "toolResult") cut--;
  return cut >= 2 ? cut : 0;
}

/** Plain-text rendering of messages, for the summarizer. */
export function renderTranscript(messages: Message[]): string {
  const clip = (s: string) =>
    s.length > RESULT_CHARS ? `${s.slice(0, RESULT_CHARS)}…[clipped]` : s;
  const lines = messages.map((m) => {
    if (m.role === "user") return `USER: ${m.content}`;
    if (m.role === "toolResult")
      return `TOOL RESULT (${m.toolName}${m.isError ? ", error" : ""}): ${clip(m.content)}`;
    return m.content
      .map((b) =>
        b.type === "text"
          ? `ASSISTANT: ${b.text}`
          : `ASSISTANT CALLED ${b.name}(${clip(JSON.stringify(b.arguments))})`,
      )
      .join("\n");
  });
  const text = lines.join("\n\n");
  return text.length > TRANSCRIPT_CHARS ? `…[earlier part omitted]\n${text.slice(-TRANSCRIPT_CHARS)}` : text;
}

/** Approximate current context size from the last assistant turn's usage. */
export function contextTokens(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant") return m.usage.input + m.usage.output;
  }
  return 0;
}

/**
 * Summarize old messages and replace them, in place, with one summary message.
 * Returns undefined when there was nothing to compact.
 */
export async function compact(opts: CompactOptions): Promise<Compaction | undefined> {
  const { provider, model, messages } = opts;
  const cut = findCut(messages, opts.keepRecent);
  if (!cut) return undefined;

  const prompt = `Summarize the conversation below so the work can continue without it. Keep: the user's goal and instructions, decisions made, files read or changed (with paths), commands run and results that matter, errors hit, and what remains to be done. Be concise but specific.

<conversation>
${renderTranscript(messages.slice(0, cut))}
</conversation>`;

  let text = "";
  for await (const event of provider.stream({
    messages: [{ role: "user", content: prompt }],
    model,
    system: "You write precise summaries of coding-agent sessions.",
  })) {
    if (event.type === "done")
      text = event.message.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
  }
  if (!text) throw new Error("compaction failed: the model returned an empty summary");

  const summary: UserMessage = {
    role: "user",
    content: `[Summary of the earlier conversation]\n${text}`,
  };
  const before = messages.length;
  messages.splice(0, cut, summary);
  return { before, after: messages.length, summary, keep: messages.length - 1 };
}
