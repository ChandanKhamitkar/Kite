import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { tools } from "../src/tools/index.ts";
import { truncate } from "../src/tools/util.ts";

const run = (name: string, args: Record<string, unknown> = {}) => {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} is registered`);
  return tool.execute(args);
};

const original = process.cwd();
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kite-"));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(original);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("registry", () => {
  it("has unique names and a risk level on every tool", () => {
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    for (const t of tools) assert.ok(t.risk, `${t.name} has a risk`);
  });
});

describe("path guard", () => {
  it("rejects parent and absolute paths on every file tool", async () => {
    writeFileSync(join(dir, "a.txt"), "x");
    for (const path of ["../outside.txt", "..", join(original, "package.json")]) {
      await assert.rejects(run("read", { path }), /outside the working directory/);
      await assert.rejects(run("write", { path, content: "x" }), /outside/);
      await assert.rejects(run("edit", { path, old_string: "a", new_string: "b" }), /outside/);
      await assert.rejects(run("ls", { path }), /outside/);
      await assert.rejects(run("find", { pattern: "*", path }), /outside/);
      await assert.rejects(run("grep", { pattern: "x", path }), /outside/);
    }
  });

  it("allows nested relative paths", async () => {
    await run("write", { path: "sub/dir/a.txt", content: "hi" });
    assert.equal(await run("read", { path: "sub/dir/../dir/a.txt" }), "hi");
  });
});

describe("read", () => {
  it("supports offset and limit", async () => {
    writeFileSync(join(dir, "f.txt"), "1\n2\n3\n4\n5");
    assert.equal(await run("read", { path: "f.txt", offset: 2, limit: 2 }), "2\n3");
  });

  it("truncates huge files and says so", () => {
    assert.match(truncate("x".repeat(40_000)), /\[truncated: 10000 more characters\]$/);
  });
});

describe("write", () => {
  it("creates parent folders and overwrites", async () => {
    await run("write", { path: "a/b/c.txt", content: "one" });
    await run("write", { path: "a/b/c.txt", content: "two" });
    assert.equal(readFileSync(join(dir, "a/b/c.txt"), "utf-8"), "two");
  });
});

describe("edit", () => {
  beforeEach(() => writeFileSync(join(dir, "f.txt"), "foo bar foo"));

  it("replaces a unique match", async () => {
    await run("edit", { path: "f.txt", old_string: "bar", new_string: "baz" });
    assert.equal(readFileSync(join(dir, "f.txt"), "utf-8"), "foo baz foo");
  });

  it("refuses ambiguous matches unless replace_all", async () => {
    await assert.rejects(
      run("edit", { path: "f.txt", old_string: "foo", new_string: "x" }),
      /matches 2 times/,
    );
    await run("edit", { path: "f.txt", old_string: "foo", new_string: "x", replace_all: true });
    assert.equal(readFileSync(join(dir, "f.txt"), "utf-8"), "x bar x");
  });

  it("errors when the text is missing", async () => {
    await assert.rejects(
      run("edit", { path: "f.txt", old_string: "nope", new_string: "x" }),
      /not found/,
    );
  });

  it("does not interpret $ patterns in new_string", async () => {
    await run("edit", { path: "f.txt", old_string: "bar", new_string: "$&$1" });
    assert.equal(readFileSync(join(dir, "f.txt"), "utf-8"), "foo $&$1 foo");
  });
});

describe("ls / find / grep", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "src/deep"), { recursive: true });
    mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "const needle = 1;\nconst other = 2;");
    writeFileSync(join(dir, "src/deep/b.ts"), "// NEEDLE here");
    writeFileSync(join(dir, "src/c.md"), "needle in docs");
    writeFileSync(join(dir, "node_modules/pkg/x.ts"), "needle ignored");
    writeFileSync(join(dir, "bin.dat"), "needle\0binary");
  });

  it("ls marks folders", async () => {
    assert.equal(await run("ls", { path: "src" }), "a.ts\nc.md\ndeep/");
  });

  it("find matches globs and skips node_modules", async () => {
    assert.equal(await run("find", { pattern: "*.ts" }), "src/a.ts\nsrc/deep/b.ts");
    assert.equal(await run("find", { pattern: "src/**/*.ts" }), "src/a.ts\nsrc/deep/b.ts");
    assert.equal(await run("find", { pattern: "*.{md,dat}" }), "bin.dat\nsrc/c.md");
    assert.equal(await run("find", { pattern: "*.zzz" }), "No files found");
  });

  it("grep reports path:line:text, honours glob/ignore_case, skips binary", async () => {
    assert.equal(
      await run("grep", { pattern: "needle", glob: "*.ts" }),
      "src/a.ts:1:const needle = 1;",
    );
    const all = await run("grep", { pattern: "needle", ignore_case: true });
    assert.match(all, /src\/deep\/b\.ts:1:/);
    assert.doesNotMatch(all, /node_modules|bin\.dat/);
    assert.equal(await run("grep", { pattern: "absent" }), "No matches");
  });
});

describe("bash", () => {
  it("returns output and exit code", async () => {
    const ok = await run("bash", { command: "echo hello" });
    assert.match(ok, /hello/);
    assert.match(ok, /\[exit code 0\]/);
    assert.match(await run("bash", { command: "exit 3" }), /\[exit code 3\]/);
  });

  it("runs in the cwd", async () => {
    writeFileSync(join(dir, "marker.txt"), "x");
    const cmd = process.platform === "win32" ? "dir /b" : "ls";
    assert.match(await run("bash", { command: cmd }), /marker\.txt/);
  });

  it("kills commands that time out", async () => {
    const started = Date.now();
    const out = await run("bash", {
      command: `node -e "setTimeout(()=>{}, 10000)"`,
      timeout_ms: 300,
    });
    assert.match(out, /timed out after 300ms/);
    assert.ok(Date.now() - started < 5000);
  });
});

describe("git", () => {
  beforeEach(() => {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "a.txt"), "one\n");
  });

  it("status, commit, log, diff", async () => {
    assert.match(await run("git_status"), /\?\? a\.txt/);
    await run("git_commit", { message: "first", paths: ["a.txt"] });
    assert.match(await run("git_log"), /first/);

    writeFileSync(join(dir, "a.txt"), "two\n");
    assert.match(await run("git_diff"), /\+two/);
    assert.match(await run("git_diff", { path: "a.txt" }), /-one/);
  });

  it("rejects empty commit messages", async () => {
    await assert.rejects(run("git_commit", { message: "  " }), /empty/);
  });
});
