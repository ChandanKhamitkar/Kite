import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runCommand } from "../src/commands.ts";
import { isAbort, Runtime } from "../src/runtime.ts";
import { listSessions, resumeSession } from "../src/session/index.ts";
import { scriptedProvider, toolCall, withTempHome } from "./helpers.ts";

const home = withTempHome();
beforeEach(() => void home.setup());
afterEach(() => home.teardown());

describe("Runtime", () => {
  it("runs a turn, tracks usage and persists the conversation", async () => {
    const rt = new Runtime({ provider: scriptedProvider([{ text: "hello there" }]) });
    const types: string[] = [];
    await rt.send("hi", { onEvent: (e) => types.push(e.type) });

    assert.deepEqual(
      rt.messages.map((m) => m.role),
      ["user", "assistant"],
    );
    assert.deepEqual(rt.usage, { input: 10, output: 5, turns: 1 });
    assert.ok(types.includes("text") && types.includes("turn_end"));

    const saved = resumeSession(rt.sessionsDir, rt.session.id).messages;
    assert.deepEqual(saved, rt.messages);
  });

  it("resumes the latest session with --continue", async () => {
    const first = new Runtime({ provider: scriptedProvider([{ text: "one" }]) });
    await first.send("first");

    const again = new Runtime({ provider: scriptedProvider([{ text: "two" }]), continue: true });
    assert.equal(again.resumed, true);
    assert.equal(again.session.id, first.session.id);
    assert.equal(again.messages.length, 2);
    await again.send("second");
    assert.equal(resumeSession(again.sessionsDir, again.session.id).messages.length, 4);
  });

  it("denies risky tools when there is no way to ask", async () => {
    const provider = scriptedProvider([
      { calls: [toolCall("c1", "bash", { command: "echo hi" })] },
      { text: "ok" },
    ]);
    const rt = new Runtime({ provider });
    await rt.send("run it");
    const result = rt.messages.find((m) => m.role === "toolResult");
    assert.ok(result && result.role === "toolResult" && result.isError);
    assert.match(result.content, /needs permission/);
  });

  it("asks the human and remembers 'always'", async () => {
    const provider = scriptedProvider([
      { calls: [toolCall("c1", "bash", { command: "echo one" })] },
      { calls: [toolCall("c2", "bash", { command: "echo two" })] },
      { text: "ok" },
    ]);
    let asked = 0;
    const rt = new Runtime({ provider, ask: async () => (asked++, "allow_session") });
    await rt.send("go");
    assert.equal(asked, 1);
    const outputs = rt.messages
      .filter((m) => m.role === "toolResult")
      .map((m) => (m as { content: string }).content);
    assert.match(outputs[0]!, /one/);
    assert.match(outputs[1]!, /two/);
  });

  it("turns an abort into an AbortError and leaves valid history", async () => {
    const controller = new AbortController();
    const provider = scriptedProvider([
      {
        calls: [
          toolCall("c1", "bash", { command: "echo hi" }),
          toolCall("c2", "bash", { command: "echo again" }),
        ],
      },
    ]);
    const rt = new Runtime({ provider, yes: true });
    await assert.rejects(
      rt.send("go", {
        signal: controller.signal,
        onEvent: (e) => e.type === "tool_start" && controller.abort(),
      }),
      (error) => isAbort(error),
    );
    // every tool call in the assistant message has a matching result
    const calls = rt.messages.flatMap((m) =>
      m.role === "assistant" ? m.content.filter((b) => b.type === "toolCall") : [],
    );
    const results = rt.messages.filter((m) => m.role === "toolResult");
    assert.equal(results.length, calls.length);
  });

  it("starts a fresh session on clear()", async () => {
    const rt = new Runtime({ provider: scriptedProvider([{ text: "x" }]) });
    await rt.send("hi");
    const old = rt.session.id;
    rt.clear();
    assert.notEqual(rt.session.id, old);
    assert.equal(rt.messages.length, 0);
    assert.equal(listSessions(rt.sessionsDir).length, 2);
  });
});

describe("slash commands", () => {
  const make = () =>
    new Runtime({ provider: scriptedProvider([{ text: "x" }], { contextWindow: 1000 }) });

  it("ignores normal text", async () => {
    assert.equal(await runCommand(make(), "hello"), undefined);
  });

  it("/model shows and changes the model", async () => {
    const rt = make();
    assert.match((await runCommand(rt, "/model"))!.output, /fake-1/);
    await runCommand(rt, "/model big-one");
    assert.equal(rt.model, "big-one");
  });

  it("/provider reports errors instead of throwing", async () => {
    const out = (await runCommand(make(), "/provider nope"))!.output;
    assert.match(out, /unknown provider "nope"/);
  });

  it("/cost, /sessions, /help, /exit, unknown", async () => {
    const rt = make();
    await rt.send("hi");
    assert.match(
      (await runCommand(rt, "/cost"))!.output,
      /1 turns \| 10 input \+ 5 output tokens \| context \d+% full/,
    );
    assert.match((await runCommand(rt, "/sessions"))!.output, new RegExp(rt.session.id));
    assert.match((await runCommand(rt, "/help"))!.output, /\/compact/);
    assert.equal((await runCommand(rt, "/exit"))!.exit, true);
    assert.match((await runCommand(rt, "/wat"))!.output, /unknown command \/wat/);
  });

  it("/clear resets and asks the UI to clear", async () => {
    const rt = make();
    await rt.send("hi");
    const result = await runCommand(rt, "/clear");
    assert.equal(result!.clear, true);
    assert.equal(rt.messages.length, 0);
  });

  it("/compact says so when there is nothing to do", async () => {
    assert.match((await runCommand(make(), "/compact"))!.output, /nothing to compact/);
  });
});
