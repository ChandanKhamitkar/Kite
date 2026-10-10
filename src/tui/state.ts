import type { AgentEvent } from "../agent/loop.ts";
import { primaryArg } from "../permissions/index.ts";
import type { ToolCallBlock } from "../types.ts";

export type Item =
  | { id: number; kind: "banner" }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string }
  | {
      id: number;
      kind: "tool";
      call: ToolCallBlock;
      status: "done" | "error" | "denied";
      result: string;
      ms: number;
    }
  | { id: number; kind: "info"; text: string }
  | { id: number; kind: "error"; text: string };

export type Running = { call: ToolCallBlock; startedAt: number };

export type UiState = {
  /** Finished items; printed once and never redrawn (Ink <Static>). */
  items: Item[];
  /** Assistant text arriving right now. */
  streaming: string;
  running: Running[];
  nextId: number;
  /** Bumps on /clear so the static transcript is rebuilt. */
  epoch: number;
};

export type Action =
  | { kind: "event"; event: AgentEvent; now: number }
  | { kind: "user"; text: string }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }
  | { kind: "interrupt" }
  | { kind: "reset" };

export function initialState(): UiState {
  return { items: [{ id: 0, kind: "banner" }], streaming: "", running: [], nextId: 1, epoch: 0 };
}

const DENIED = /denied|deny rule|needs permission|interrupted by user/;

function add(state: UiState, item: DistributiveOmit<Item, "id">): UiState {
  return {
    ...state,
    items: [...state.items, { ...item, id: state.nextId } as Item],
    nextId: state.nextId + 1,
  };
}
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export function reduce(state: UiState, action: Action): UiState {
  switch (action.kind) {
    case "user":
      return add(state, { kind: "user", text: action.text });
    case "info":
      return add(state, { kind: "info", text: action.text });
    case "error":
      return add(state, { kind: "error", text: action.text });
    case "reset":
      return { ...initialState(), epoch: state.epoch + 1 };

    case "interrupt": {
      let next = state;
      if (state.streaming.trim())
        next = add(next, { kind: "assistant", text: `${state.streaming.trim()} …` });
      next = add(next, { kind: "info", text: "interrupted" });
      return { ...next, streaming: "", running: [] };
    }

    case "event": {
      const { event, now } = action;
      switch (event.type) {
        case "text":
          return { ...state, streaming: state.streaming + event.delta };

        case "message": {
          const m = event.message;
          if (m.role !== "assistant") return state;
          const text = m.content
            .map((b) => (b.type === "text" ? b.text : ""))
            .join("")
            .trim();
          const cleared = { ...state, streaming: "" };
          return text ? add(cleared, { kind: "assistant", text }) : cleared;
        }

        case "tool_start":
          return { ...state, running: [...state.running, { call: event.call, startedAt: now }] };

        case "tool_end": {
          const started = state.running.find((r) => r.call.id === event.call.id);
          const next = {
            ...state,
            running: state.running.filter((r) => r.call.id !== event.call.id),
          };
          return add(next, {
            kind: "tool",
            call: event.call,
            status: !event.isError ? "done" : DENIED.test(event.result) ? "denied" : "error",
            result: event.result,
            ms: started ? now - started.startedAt : 0,
          });
        }

        case "compacted":
          return add(state, {
            kind: "info",
            text: `compacted context: ${event.before} -> ${event.after} messages`,
          });

        default:
          return state;
      }
    }
  }
}

/** One-line description of a tool call's arguments. */
export function summarizeCall(call: ToolCallBlock, max = 80): string {
  const a = call.arguments;
  let text: string;
  if (call.name === "grep" && typeof a.pattern === "string")
    text = `${a.pattern}${typeof a.path === "string" ? ` in ${a.path}` : ""}`;
  else if (call.name === "find" && typeof a.pattern === "string") text = a.pattern;
  else text = primaryArg(call) || (Object.keys(a).length ? JSON.stringify(a) : "");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** First `max` lines of a result, plus how many were left out. */
export function previewLines(text: string, max = 3): { lines: string[]; more: number } {
  const all = text.replace(/\s+$/, "").split("\n");
  return {
    lines: all.slice(0, max).map((l) => (l.length > 160 ? `${l.slice(0, 159)}…` : l)),
    more: Math.max(all.length - max, 0),
  };
}

export function formatTokens(n: number): string {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n);
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Replace the home folder with ~ for display. */
export function shortPath(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
