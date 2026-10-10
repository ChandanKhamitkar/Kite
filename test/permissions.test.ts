import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runAgent } from "../src/agent/loop.ts";
import {
  createAuthorizer,
  loadRules,
  matchesRule,
  type Verdict,
} from "../src/permissions/index.ts";
import type { AssistantMessage, Message, Provider, Tool, ToolCallBlock } from "../src/types.ts";

const call = (name: string, args: Record<string, unknown> = {}): ToolCallBlock => ({
  type: "toolCall",
  id: `id-${name}`,
  name,
  arguments: args,
});
const tool = (name: string, risk?: Tool["risk"]): Tool => ({
  name,
  risk,
  description: "",
  parameters: {},
  execute: async () => "ok",
});

describe("rules", () => {
  it("matches by tool name and by argument pattern", () => {
    assert.ok(matchesRule("bash", call("bash", { command: "ls" })));
    assert.ok(matchesRule("bash:npm test*", call("bash", { command: "npm test -- x" })));
    assert.ok(!matchesRule("bash:npm test*", call("bash", { command: "rm -rf /" })));
    assert.ok(matchesRule("edit:src/*", call("edit", { path: "src/a/b.ts" })));
    assert.ok(!matchesRule("edit:src/*", call("edit", { path: "lib/a.ts" })));
    assert.ok(!matchesRule("bash", call("write")));
  });

  it("treats regex characters in patterns literally", () => {
    assert.ok(matchesRule("bash:echo (a)", call("bash", { command: "echo (a)" })));
    assert.ok(!matchesRule("bash:a.c", call("bash", { command: "abc" })));
  });

  it("loads rules from .kite.json and tolerates absence", () => {
    const dir = mkdtempSync(join(tmpdir(), "kite-perm-"));
    try {
      assert.deepEqual(loadRules(dir), {});
      writeFileSync(
        join(dir, ".kite.json"),
        JSON.stringify({ permissions: { allow: ["edit"], deny: ["bash:rm *"] } }),
      );
      assert.deepEqual(loadRules(dir), { allow: ["edit"], deny: ["bash:rm *"] });
      writeFileSync(join(dir, ".kite.json"), "{ nope");
      assert.throws(() => loadRules(dir), /could not parse/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("authorizer", () => {
  it("never asks for read tools", async () => {
    const auth = createAuthorizer({ ask: async () => assert.fail("asked") });
    assert.equal((await auth(call("read"), tool("read", "read"))).allow, true);
  });

  it("treats a tool with no risk as exec and asks", async () => {
    let asked = 0;
    const auth = createAuthorizer({ ask: async () => (asked++, "allow") });
    await auth(call("mystery"), tool("mystery"));
    assert.equal(asked, 1);
  });

  it("denies without a prompt unless --yes", async () => {
    const denied = await createAuthorizer()(call("bash"), tool("bash", "exec"));
    assert.equal(denied.allow, false);
    assert.match(denied.reason!, /--yes/);
    const yes = await createAuthorizer({ yes: true })(call("bash"), tool("bash", "exec"));
    assert.equal(yes.allow, true);
  });

  it("deny rules beat --yes and allow rules", async () => {
    const auth = createAuthorizer({
      yes: true,
      rules: { allow: ["bash"], deny: ["bash:rm *"] },
    });
    const bash = tool("bash", "exec");
    assert.equal((await auth(call("bash", { command: "rm -rf x" }), bash)).allow, false);
    assert.equal((await auth(call("bash", { command: "ls" }), bash)).allow, true);
  });

  it("allow rules skip the prompt", async () => {
    const auth = createAuthorizer({
      rules: { allow: ["bash:npm test*"] },
      ask: async () => assert.fail("asked"),
    });
    const r = await auth(call("bash", { command: "npm test" }), tool("bash", "exec"));
    assert.equal(r.allow, true);
  });

  it("remembers allow_session per tool, and deny is not remembered", async () => {
    const answers: Verdict[] = ["allow_session", "deny", "allow"];
    let asked = 0;
    const auth = createAuthorizer({ ask: async () => answers[asked++]! });
    const edit = tool("edit", "write");
    const write = tool("write", "write");

    assert.equal((await auth(call("edit"), edit)).allow, true); // asks (1)
    assert.equal((await auth(call("edit"), edit)).allow, true); // remembered
    assert.equal(asked, 1);

    assert.equal((await auth(call("write"), write)).allow, false); // asks (2) -> deny
    assert.equal((await auth(call("write"), write)).allow, true); // asks (3) -> allow
    assert.equal(asked, 3);
  });
});

describe("loop integration", () => {
  const scripted = (calls: ToolCallBlock[]): Provider => {
    let turn = 0;
    return {
      name: "fake",
      defaultModel: "fake",
      async *stream() {
        const message: AssistantMessage =
          turn++ === 0
            ? {
                role: "assistant",
                content: calls,
                usage: { input: 0, output: 0 },
                stopReason: "toolUse",
              }
            : {
                role: "assistant",
                content: [{ type: "text", text: "done" }],
                usage: { input: 0, output: 0 },
                stopReason: "stop",
              };
        yield { type: "done", message };
      },
    };
  };

  it("runs allowed tools, blocks denied ones, and reports back to the model", async () => {
    const ran: string[] = [];
    const safe: Tool = { ...tool("safe", "read"), execute: async () => (ran.push("safe"), "S") };
    const risky: Tool = { ...tool("risky", "exec"), execute: async () => (ran.push("risky"), "R") };

    const messages: Message[] = [{ role: "user", content: "go" }];
    const events: string[] = [];
    await runAgent({
      provider: scripted([call("safe"), call("risky")]),
      model: "fake",
      tools: [safe, risky],
      messages,
      authorize: createAuthorizer({ ask: async () => "deny" }),
      onEvent: (e) => events.push(e.type),
    });

    assert.deepEqual(ran, ["safe"]); // risky never executed
    const results = messages.filter((m) => m.role === "toolResult");
    assert.equal(results.length, 2);
    assert.equal(results[0]!.role === "toolResult" && results[0]!.isError, false);
    assert.ok(results[1]!.role === "toolResult" && results[1]!.isError);
    assert.match((results[1] as { content: string }).content, /denied/);
    assert.equal(events.filter((t) => t === "permission_request").length, 2);
  });

  it("names the tool in the unknown-tool error", async () => {
    const messages: Message[] = [{ role: "user", content: "go" }];
    await runAgent({
      provider: scripted([call("ghost")]),
      model: "fake",
      tools: [],
      messages,
      onEvent() {},
    });
    const result = messages.find((m) => m.role === "toolResult") as { content: string };
    assert.match(result.content, /unknown tool name ghost/);
  });
});
