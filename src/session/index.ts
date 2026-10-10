import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { Message } from "../types.ts";

/**
 * One JSON object per line, append-only:
 *  - meta:       first line, describes the session
 *  - message:    a message added to the conversation
 *  - compaction: everything before the last `keep` messages was replaced by `summary`
 */
export type Entry =
  | { type: "meta"; id: string; cwd: string; provider: string; model: string; createdAt: string }
  | { type: "message"; message: Message }
  | { type: "compaction"; summary: Message; keep: number };

export type Session = {
  id: string;
  file: string;
  append(entry: Entry): void;
};

export type SessionInfo = {
  id: string;
  file: string;
  modified: Date;
  cwd?: string;
  firstPrompt?: string;
};

export function sessionsDir(home: string): string {
  return join(home, "sessions");
}

export function createSession(opts: {
  dir: string;
  cwd: string;
  provider: string;
  model: string;
}): Session {
  mkdirSync(opts.dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const id = `${stamp}-${randomBytes(2).toString("hex")}`;
  const session = openFile(opts.dir, id);
  session.append({
    type: "meta",
    id,
    cwd: opts.cwd,
    provider: opts.provider,
    model: opts.model,
    createdAt: new Date().toISOString(),
  });
  return session;
}

function openFile(dir: string, id: string): Session {
  const file = join(dir, `${id}.jsonl`);
  return {
    id,
    file,
    append: (entry) => appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf-8"),
  };
}

/** Parse a session file. A half-written last line (crash) is ignored. */
export function readEntries(file: string): Entry[] {
  const entries: Entry[] = [];
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  lines.forEach((line, i) => {
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      if (i !== lines.length - 1)
        throw new Error(`corrupt session file ${file}: line ${i + 1} is not valid JSON`);
    }
  });
  return entries;
}

/** Rebuild the conversation, applying compactions in order. */
export function replay(entries: Entry[]): Message[] {
  let messages: Message[] = [];
  for (const entry of entries) {
    if (entry.type === "message") messages.push(entry.message);
    else if (entry.type === "compaction")
      messages = [entry.summary, ...messages.slice(Math.max(messages.length - entry.keep, 0))];
  }
  return messages;
}

/** Open an existing session (by id) for appending, returning its messages. */
export function resumeSession(
  dir: string,
  id: string,
): { session: Session; messages: Message[]; meta?: Extract<Entry, { type: "meta" }> } {
  const file = join(dir, `${id}.jsonl`);
  if (!existsSync(file)) throw new Error(`no session "${id}" in ${dir}`);
  const entries = readEntries(file);
  const meta = entries.find((e) => e.type === "meta");
  return { session: openFile(dir, id), messages: replay(entries), meta };
}

/** Sessions, newest first. */
export function listSessions(dir: string): SessionInfo[] {
  if (!existsSync(dir)) return [];
  const infos: SessionInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(dir, name);
    const info: SessionInfo = {
      id: name.slice(0, -".jsonl".length),
      file,
      modified: statSync(file).mtime,
    };
    try {
      const entries = readEntries(file);
      const meta = entries.find((e) => e.type === "meta");
      if (meta?.type === "meta") info.cwd = meta.cwd;
      const first = entries.find((e) => e.type === "message" && e.message.role === "user");
      if (first?.type === "message" && first.message.role === "user")
        info.firstPrompt = first.message.content.slice(0, 80);
    } catch {
      // unreadable sessions are still listed by id
    }
    infos.push(info);
  }
  return infos.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** Most recently modified session, optionally only for a given folder. */
export function latestSession(dir: string, cwd?: string): SessionInfo | undefined {
  return listSessions(dir).find((s) => !cwd || s.cwd === cwd);
}
