import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DEFAULTS, loadConfig } from "../src/config/index.ts";
import { buildSystemPrompt } from "../src/config/prompt.ts";
import { normalizeError, ProviderError } from "../src/providers/errors.ts";

let root: string;
let home: string;
let proj: string;
const write = (file: string, data: unknown) =>
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
const load = (env: NodeJS.ProcessEnv = {}, flags = {}) =>
  loadConfig({ cwd: proj, env: { KITE_HOME: home, ...env }, flags });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kite-cfg-"));
  home = join(root, "home");
  proj = join(root, "proj");
  mkdirSync(home);
  mkdirSync(proj);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("config cascade", () => {
  it("returns defaults when nothing is configured", () => {
    assert.deepEqual(load(), { ...DEFAULTS, permissions: { allow: [], deny: [] } });
  });

  it("applies global < project < env < flags", () => {
    write(join(home, "config.json"), { provider: "g", model: "g-model", maxTurns: 5 });
    assert.equal(load().provider, "g");

    write(join(proj, ".kite.json"), { provider: "p", model: "p-model" });
    assert.equal(load().provider, "p");
    assert.equal(load().maxTurns, 5); // untouched by project

    assert.equal(load({ KITE_PROVIDER: "e" }).provider, "e");
    assert.equal(load({ KITE_PROVIDER: "e" }, { provider: "f" }).provider, "f");
    assert.equal(load({}, { provider: undefined }).provider, "p"); // undefined flag ignored
    assert.equal(load({ KITE_MAX_TURNS: "9" }).maxTurns, 9);
  });

  it("concatenates permission rules from every layer", () => {
    write(join(home, "config.json"), { permissions: { deny: ["bash:rm *"], allow: ["edit"] } });
    write(join(proj, ".kite.json"), { permissions: { allow: ["bash:npm test*"] } });
    assert.deepEqual(load().permissions, {
      allow: ["edit", "bash:npm test*"],
      deny: ["bash:rm *"],
    });
  });

  it("names the file when a config is broken", () => {
    write(join(proj, ".kite.json"), "{ nope");
    assert.throws(() => load(), /invalid config .*\.kite\.json/);
    write(join(proj, ".kite.json"), { maxTurns: "ten" });
    assert.throws(() => load(), /"maxTurns" must be a positive integer/);
    write(join(proj, ".kite.json"), { compactAt: 2 });
    assert.throws(() => load(), /"compactAt"/);
    write(join(proj, ".kite.json"), {});
    assert.throws(() => load({ KITE_MAX_TURNS: "abc" }), /KITE_/);
  });
});

describe("system prompt", () => {
  it("includes cwd, date, git state and config text", () => {
    const text = buildSystemPrompt({
      cwd: proj,
      extra: "Always answer in French.",
      now: new Date("2026-10-10T00:00:00Z"),
    });
    assert.match(text, new RegExp(`Working directory: ${proj.replace(/[\\.]/g, "\\$&")}`));
    assert.match(text, /Date: 2026-10-10/);
    assert.match(text, /Git: not a git repository/);
    assert.match(text, /Always answer in French\./);
  });

  it("picks up KITE.md project instructions", () => {
    write(join(proj, "KITE.md"), "Use tabs, never spaces.");
    assert.match(buildSystemPrompt({ cwd: proj }), /Use tabs, never spaces\./);
  });
});

describe("provider errors", () => {
  const e = (status?: number, extra: object = {}) =>
    normalizeError(Object.assign(new Error("boom"), { status }, extra), "acme") as ProviderError;

  it("classifies by status", () => {
    assert.match(e(401).message, /authentication failed/);
    assert.equal(e(401).retryable, false);
    assert.match(e(404).message, /model name/);
    assert.equal(e(429).retryable, true);
    assert.equal(e(503).retryable, true);
    assert.match(e(400).message, /rejected \(400\)/);
  });

  it("recognises connection failures and passes unknown errors through", () => {
    assert.match(e(undefined, { name: "APIConnectionError" }).message, /could not reach/);
    assert.match(e(undefined, { code: "ENOTFOUND" }).message, /could not reach/);
    assert.equal(e(undefined).message, "boom");
  });
});
