import assert from "node:assert/strict";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Runtime } from "../src/runtime.ts";
import { App, type AskBridge } from "../src/tui/app.tsx";
import { editInput, emptyInput, type InputState } from "../src/tui/input.ts";
import {
  formatMs,
  formatTokens,
  initialState,
  previewLines,
  reduce,
  summarizeCall,
} from "../src/tui/state.ts";
import { scriptedProvider, tick, toolCall, withTempHome } from "./helpers.ts";

describe("transcript reducer", () => {
  const now = 1000;
  const ev = (event: any, at = now) => ({ kind: "event" as const, event, now: at });

  it("streams text, then finalizes it when the assistant message lands", () => {
    let s = reduce(initialState(), ev({ type: "text", delta: "Hel" }));
    s = reduce(s, ev({ type: "text", delta: "lo" }));
    assert.equal(s.streaming, "Hello");
    s = reduce(
      s,
      ev({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: { input: 0, output: 0 },
          stopReason: "stop",
        },
      }),
    );
    assert.equal(s.streaming, "");
    assert.deepEqual(s.items.at(-1), { id: s.items.at(-1)!.id, kind: "assistant", text: "Hello" });
  });

  it("tracks a tool from start to end with its duration", () => {
    const call = toolCall("t1", "bash", { command: "ls" });
    let s = reduce(initialState(), ev({ type: "tool_start", call }, 1000));
    assert.equal(s.running.length, 1);
    s = reduce(s, ev({ type: "tool_end", call, result: "a\nb", isError: false }, 1450));
    assert.equal(s.running.length, 0);
    const item = s.items.at(-1)!;
    assert.ok(item.kind === "tool" && item.status === "done" && item.ms === 450);
  });

  it("marks denied vs failed tools", () => {
    const call = toolCall("t1", "bash");
    const end = (result: string) =>
      reduce(initialState(), ev({ type: "tool_end", call, result, isError: true })).items.at(
        -1,
      ) as any;
    assert.equal(end("Error the user denied this tool call").status, "denied");
    assert.equal(end("Error ENOENT: no such file").status, "error");
  });

  it("interrupt keeps partial text and clears live state", () => {
    let s = reduce(initialState(), ev({ type: "text", delta: "partial answer" }));
    s = reduce(s, { kind: "interrupt" });
    assert.equal(s.streaming, "");
    assert.deepEqual(
      s.items.slice(-2).map((i) => i.kind),
      ["assistant", "info"],
    );
  });

  it("reset rebuilds the transcript with a new epoch", () => {
    const s = reduce(reduce(initialState(), { kind: "user", text: "x" }), { kind: "reset" });
    assert.equal(s.items.length, 1);
    assert.equal(s.epoch, 1);
  });

  it("formats helpers", () => {
    assert.equal(summarizeCall(toolCall("1", "bash", { command: "npm   test" })), "npm test");
    assert.equal(
      summarizeCall(toolCall("1", "grep", { pattern: "foo", path: "src" })),
      "foo in src",
    );
    assert.equal(summarizeCall(toolCall("1", "bash", { command: "x".repeat(200) })).length, 80);
    assert.deepEqual(previewLines("1\n2\n3\n4\n5\n", 3), { lines: ["1", "2", "3"], more: 2 });
    assert.equal(formatTokens(1234), "1.2k");
    assert.equal(formatMs(1500), "1.5s");
    assert.equal(formatMs(40), "40ms");
  });
});

describe("input editing", () => {
  const type = (s: InputState, text: string) => editInput(s, text, {}).state;

  it("inserts at the cursor and handles backspace from either key name", () => {
    let s = type(emptyInput(), "helo");
    s = editInput(s, "", { leftArrow: true }).state;
    s = type(s, "l");
    assert.equal(s.value, "hello");
    assert.equal(editInput(s, "", { backspace: true }).state.value, "helo");
    assert.equal(editInput(s, "", { delete: true }).state.value, "helo");
  });

  it("submits non-empty lines and clears; ignores blank", () => {
    assert.equal(editInput(type(emptyInput(), "  "), "", { return: true }).submit, undefined);
    const r = editInput(type(emptyInput(), "go "), "", { return: true });
    assert.equal(r.submit, "go");
    assert.equal(r.state.value, "");
    assert.deepEqual(r.state.history, ["go"]);
  });

  it("walks history with up/down and restores the draft", () => {
    let s = emptyInput(["one", "two"]);
    s = type(s, "dra");
    s = editInput(s, "", { upArrow: true }).state;
    assert.equal(s.value, "two");
    s = editInput(s, "", { upArrow: true }).state;
    assert.equal(s.value, "one");
    s = editInput(s, "", { downArrow: true }).state;
    s = editInput(s, "", { downArrow: true }).state;
    assert.equal(s.value, "dra");
  });

  it("supports ctrl+u / ctrl+w and flattens pasted newlines", () => {
    let s = type(emptyInput(), "hello big world");
    s = editInput(s, "w", { ctrl: true }).state;
    assert.equal(s.value, "hello big ");
    s = editInput(s, "u", { ctrl: true }).state;
    assert.equal(s.value, "");
    assert.equal(type(emptyInput(), "a\r\nb").value, "a b");
  });
});

describe("App", () => {
  const home = withTempHome();
  beforeEach(() => void home.setup());
  afterEach(() => home.teardown());

  const mount = (
    provider = scriptedProvider([{ text: "Hi from kite" }], { contextWindow: 1000 }),
    yes = false,
  ) => {
    const bridge: AskBridge = {};
    const rt = new Runtime({
      provider,
      yes,
      ask: (c, t) => (bridge.ask ? bridge.ask(c, t) : Promise.resolve("deny")),
    });
    const ui = render(<App rt={rt} bridge={bridge} />);
    return { rt, ui, bridge };
  };
  const typeLine = async (ui: ReturnType<typeof render>, text: string) => {
    ui.stdin.write(text);
    await tick();
    ui.stdin.write("\r");
    await tick(150);
  };

  it("shows the banner and status bar", async () => {
    const { ui } = mount();
    await tick();
    const frame = ui.lastFrame()!;
    assert.match(frame, /kite/);
    assert.match(frame, /fake · fake-1 · ctx 0%/);
    ui.unmount();
  });

  it("sends a prompt and shows the answer", async () => {
    const { ui, rt } = mount();
    await tick();
    await typeLine(ui, "say hi");
    const out = ui.frames.join("\n");
    assert.match(out, /say hi/);
    assert.match(out, /Hi from kite/);
    assert.equal(rt.messages.length, 2);
    ui.unmount();
  });

  it("asks for permission, shows the command, and runs on 'y'", async () => {
    const provider = scriptedProvider([
      { calls: [toolCall("c1", "bash", { command: "echo from-tool" })] },
      { text: "finished" },
    ]);
    const { ui } = mount(provider);
    await tick();
    await typeLine(ui, "do it");

    assert.match(ui.lastFrame()!, /Allow bash\?/);
    assert.match(ui.lastFrame()!, /\$ echo from-tool/);
    ui.stdin.write("y");
    await tick(400);

    const out = ui.frames.join("\n");
    assert.match(out, /from-tool/);
    assert.match(out, /finished/);
    ui.unmount();
  });

  it("denies on 'n' and the model sees the denial", async () => {
    const provider = scriptedProvider([
      { calls: [toolCall("c1", "bash", { command: "echo nope" })] },
      { text: "ok" },
    ]);
    const { ui, rt } = mount(provider);
    await tick();
    await typeLine(ui, "do it");
    ui.stdin.write("n");
    await tick(300);

    assert.match(ui.frames.join("\n"), /denied/);
    const result = rt.messages.find((m) => m.role === "toolResult") as {
      isError: boolean;
      content: string;
    };
    assert.ok(result.isError && /denied/.test(result.content));
    ui.unmount();
  });

  it("renders slash command output without calling the model", async () => {
    const provider = scriptedProvider([]);
    const { ui } = mount(provider);
    await tick();
    await typeLine(ui, "/help");
    assert.match(ui.frames.join("\n"), /\/compact/);
    assert.equal(provider.requests, 0);
    ui.unmount();
  });
});
