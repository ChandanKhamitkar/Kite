import { spawn } from "node:child_process";

import type { Tool } from "../types.ts";
import { optNumber, reqString, truncate } from "./util.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_CAPTURE = 200_000;

export const bashTool: Tool = {
  name: "bash",
  risk: "exec",
  description:
    "Run a shell command in the current folder and return combined stdout/stderr and the exit code. Commands time out (default 30s).",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run" },
      timeout_ms: { type: "number", description: "Timeout in milliseconds (max 300000)" },
    },
    required: ["command"],
  },
  execute(args, signal) {
    const command = reqString(args, "command");
    const timeout = Math.min(
      optNumber(args, "timeout_ms") ?? DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    return new Promise((resolve, reject) => {
      const child = spawn(command, { shell: true, cwd: process.cwd() });
      let output = "";
      let timedOut = false;
      let killed: Promise<void> = Promise.resolve();
      const collect = (chunk: Buffer) => {
        if (output.length < MAX_CAPTURE) output += chunk.toString("utf-8");
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);

      let interrupted = false;
      const killTree = () => {
        if (process.platform === "win32" && child.pid) {
          const pid = String(child.pid);
          killed = new Promise((done) => {
            spawn("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore" })
              .on("close", () => done())
              .on("error", () => done());
          });
        } else child.kill("SIGKILL");
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeout);
      const onAbort = () => {
        interrupted = true;
        killTree();
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", async (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        await killed;
        const body = truncate(output.trimEnd());
        resolve(
          interrupted
            ? `${body}\n[interrupted]`.trimStart()
            : timedOut
              ? `${body}\n[timed out after ${timeout}ms]`
              : `${body}\n[exit code ${code}]`.trimStart(),
        );
      });
    });
  },
};
