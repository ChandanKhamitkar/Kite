import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { compact, contextTokens, findCut, renderTranscript } from "../src/agent/compact.ts";
import { runAgent, type AgentEvent } from "../src/agent/loop.ts";
import {
  createSession,
  latestSession,
  listSessions,
  readEntries,
  replay,
  resumeSession,
} from "../src/session/index.ts";
import type { AssistantMessage, Message, Provider } from "../src/types.ts";

const user = (content: string): Message => ({ role: "user", content });
const asst = (text: string, tokens = 0, calls: { id: string; name: string }[] = []): Message => ({
  role: "assistant",
  content: [
    { type: "text", text },
    ...calls.map((c) => ({ type: "toolCall" as const, id: c.id, name: c.name, arguments: {} })),
  ],
  usage: { input: tokens, output: 0 },
  stopReason: calls.length ? "toolUse" : "stop",
});
const result = (id: string, content = "r"): Message => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "t",
  content,
  isError: false,
});

/** Replies with `summaryText` to every call and records the prompts it received. */
const summarizer = (summaryText: string, seen: string[] = []): Provider => ({
  name: "fake",
  defaultModel: "fake",
  async *stream({ messages }) {
    seen.push((messages[0] as { content: string }).content);
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: summaryText }],
      usage: { input: 1, output: 1 },
      stopReason: "stop",
    };
    yield { type: "done", message };
  },
});

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "kite-sess-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sessions", () => {
  it("round-trips messages through an append-only file", () => {
    const s = createSession({ dir, cwd: "/work", provider: "p", model: "m" });
    s.append({ type: "message", message: user("hi") });
    s.append({ type: "message", message: asst("hello") });

    const { messages, meta, session } = resumeSession(dir, s.id);
    assert.deepEqual(messages, [user("hi"), asst("hello")]);
    assert.equal(meta?.cwd, "/work");

    session.append({ type: "message", message: user("again") });
    assert.equal(replay(readEntries(s.file)).length, 3);
  });

  it("ignores a half-written last line but rejects corruption elsewhere", () => {
    const s = createSession({ dir, cwd: "/w", provider: "p", model: "m" });
    s.append({ type: "message", message: user("one") });
    appendFileSync(s.file, '{"type":"message","mess'); // crash mid-write
    assert.equal(replay(readEntries(s.file)).length, 1);

    appendFileSync(s.file, '\n{"type":"message","message":{"role":"user","content":"x"}}\n');
    assert.throws(() => readEntries(s.file), /corrupt session file/);
  });

  it("replays compactions: summary + the last `keep` messages", () => {
    const s = createSession({ dir, cwd: "/w", provider: "p", model: "m" });
    for (const m of [user("a"), asst("b"), user("c"), asst("d"), user("e")])
      s.append({ type: "message", message: m });
    s.append({ type: "compaction", summary: user("SUMMARY"), keep: 2 });
    s.append({ type: "message", message: asst("f") });

    assert.deepEqual(resumeSession(dir, s.id).messages, [
      user("SUMMARY"),
      asst("d"),
      user("e"),
      asst("f"),
    ]);
  });

  it("lists newest first and finds the latest for a folder", async () => {
    const a = createSession({ dir, cwd: "/a", provider: "p", model: "m" });
    a.append({ type: "message", message: user("first prompt in a") });
    await new Promise((r) => setTimeout(r, 20));
    const b = createSession({ dir, cwd: "/b", provider: "p", model: "m" });

    assert.deepEqual(listSessions(dir).map((s) => s.id), [b.id, a.id]);
    assert.equal(latestSession(dir, "/a")?.id, a.id);
    assert.equal(latestSession(dir, "/a")?.firstPrompt, "first prompt in a");
    assert.equal(latestSession(dir, "/nowhere"), undefined);
    assert.throws(() => resumeSession(dir, "missing"), /no session/);
  });
});

describe("compaction", () => {
  it("never starts the kept tail on a tool result", () => {
    const msgs = [
      user("1"), asst("2"), user("3"),
      asst("4", 0, [{ id: "x", name: "t" }]), result("x"), asst("5"),
    ];
    // keepRecent 2 would start at index 4 (toolResult); must back up to the assistant call.
    assert.equal(findCut(msgs, 2), 3);
    assert.equal(findCut(msgs, 5), 0); // too little to summarize
  });

  it("replaces old messages in place with a summary", async () => {
    const msgs = [user("goal"), asst("a"), user("more"), asst("b"), user("now"), asst("c")];
    const seen: string[] = [];
    const done = await compact({ provider: summarizer("DONE SO FAR", seen), model: "m", messages: msgs, keepRecent: 2 });

    assert.ok(done);
    assert.equal(done.before, 6);
    assert.equal(done.after, 3);
    assert.equal(done.keep, 2);
    assert.match(String(msgs[0]!.role === "user" && msgs[0]!.content), /DONE SO FAR/);
    assert.deepEqual(msgs.slice(1), [user("now"), asst("c")]);
    assert.match(seen[0]!, /USER: goal/); // summarizer saw the old part…
    assert.doesNotMatch(seen[0]!, /USER: now/); // …but not the kept tail
  });

  it("clips big tool results in the transcript", () => {
    const text = renderTranscript([result("x", "z".repeat(5000))]);
    assert.ok(text.length < 2000);
    assert.match(text, /clipped/);
  });

  it("estimates context from the last assistant usage", () => {
    assert.equal(contextTokens([user("a")]), 0);
    assert.equal(contextTokens([asst("a", 100), user("b")]), 100);
  });

  it("triggers inside the agent loop and is reported as an event", async () => {
    // History already holds a huge assistant turn, so the first loop turn must compact.
    const messages: Message[] = [
      user("old goal"), asst("old", 0), user("older"), asst("older reply", 90_000), user("next task"),
    ];
    const events: AgentEvent[] = [];
    let calls = 0;
    const provider: Provider = {
      name: "fake",
      defaultModel: "fake",
      async *stream(opts) {
        calls++;
        const isSummary = !opts.tools && opts.system?.includes("summaries");
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [{ type: "text", text: isSummary ? "SUM" : "answer" }],
            usage: { input: 10, output: 1 },
            stopReason: "stop",
          },
        };
      },
    };

    await runAgent({
      provider,
      model: "m",
      tools: [],
      messages,
      compaction: { contextWindow: 100_000, threshold: 0.8, keepRecent: 2 },
      onEvent: (e) => events.push(e),
    });

    const compacted = events.find((e) => e.type === "compacted");
    assert.ok(compacted && compacted.type === "compacted");
    assert.equal(calls, 2); // one summary call + one real turn
    assert.equal(messages[0]!.role === "user" && messages[0]!.content.includes("SUM"), true);
    assert.equal(messages.at(-1)!.role, "assistant");
  });
});
