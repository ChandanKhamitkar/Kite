import { runAgent, type AgentEvent } from "./agent/loop.ts";
import { compact, contextTokens, type Compaction } from "./agent/compact.ts";
import { loadConfig, kiteHome, type Config } from "./config/index.ts";
import { buildSystemPrompt } from "./config/prompt.ts";
import { createAuthorizer, type Ask, type Authorizer } from "./permissions/index.ts";
import { getProvider } from "./providers/index.ts";
import {
  createSession,
  latestSession,
  resumeSession,
  sessionsDir,
  type Session,
} from "./session/index.ts";
import { tools } from "./tools/index.ts";
import type { Message, Provider } from "./types.ts";

export type RuntimeOptions = {
  /** Use this provider instead of the configured one (tests, embedding). */
  provider?: Provider;
  flags?: { provider?: string; model?: string; maxTurns?: number };
  yes?: boolean;
  /** How permission prompts reach the human. Without it, risky tools are denied. */
  ask?: Ask;
  resume?: string;
  /** Resume the latest session for this folder, if there is one. */
  continue?: boolean;
};

export type SendOptions = {
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
};

/** Everything a front end (print, REPL, TUI) needs to talk to the agent. */
export class Runtime {
  cfg: Config;
  provider: Provider;
  model: string;
  messages: Message[] = [];
  session: Session;
  /** True when this run picked up an earlier session. */
  resumed = false;
  /** Totals across the whole run (not reset by /clear). */
  usage = { input: 0, output: 0, turns: 0 };

  readonly sessionsDir = sessionsDir(kiteHome());
  private authorize: Authorizer;

  constructor(private opts: RuntimeOptions = {}) {
    this.cfg = loadConfig({ flags: opts.flags });
    this.provider = opts.provider ?? getProvider(this.cfg.provider);
    this.model = this.cfg.model ?? this.provider.defaultModel;

    const id = opts.resume ?? (opts.continue ? latestSession(this.sessionsDir, process.cwd())?.id : undefined);
    if (id) {
      const resumed = resumeSession(this.sessionsDir, id);
      this.session = resumed.session;
      this.messages = resumed.messages;
      this.resumed = true;
    } else {
      this.session = this.freshSession();
    }

    // One authorizer for the whole run, so "always this session" sticks.
    this.authorize = createAuthorizer({
      ask: opts.ask,
      yes: opts.yes,
      rules: this.cfg.permissions,
    });
  }

  get contextWindow(): number | undefined {
    return this.cfg.contextWindow ?? this.provider.contextWindow;
  }

  /** Share of the context window currently in use, 0..1 (0 if unknown). */
  get contextFill(): number {
    return this.contextWindow ? contextTokens(this.messages) / this.contextWindow : 0;
  }

  private freshSession(): Session {
    return createSession({
      dir: this.sessionsDir,
      cwd: process.cwd(),
      provider: this.provider.name,
      model: this.model,
    });
  }

  /** Run one user turn to completion. Rejects with an AbortError if aborted. */
  async send(prompt: string, { signal, onEvent }: SendOptions = {}): Promise<void> {
    const user: Message = { role: "user", content: prompt };
    this.messages.push(user);
    this.session.append({ type: "message", message: user });

    const window = this.contextWindow;
    try {
      await runAgent({
        provider: this.provider,
        model: this.model,
        system: buildSystemPrompt({ extra: this.cfg.systemPrompt }),
        tools,
        messages: this.messages,
        maxTurns: this.cfg.maxTurns,
        signal,
        compaction: window
          ? { contextWindow: window, threshold: this.cfg.compactAt, keepRecent: this.cfg.keepRecent }
          : undefined,
        authorize: this.authorize,
        onEvent: (event) => {
          if (event.type === "message") this.session.append({ type: "message", message: event.message });
          else if (event.type === "compacted")
            this.session.append({ type: "compaction", summary: event.summary, keep: event.keep });
          else if (event.type === "turn_end") {
            this.usage.input += event.message.usage.input;
            this.usage.output += event.message.usage.output;
            this.usage.turns++;
          }
          onEvent?.(event);
        },
      });
    } catch (error) {
      // SDKs report an abort in their own way; callers just see an AbortError.
      if (signal?.aborted) throw new DOMException("Interrupted", "AbortError");
      throw error;
    }
  }

  /** Summarize older messages now (the /compact command). */
  async compactNow(signal?: AbortSignal): Promise<Compaction | undefined> {
    const done = await compact({
      provider: this.provider,
      model: this.model,
      messages: this.messages,
      keepRecent: this.cfg.keepRecent,
    });
    signal?.throwIfAborted();
    if (done) this.session.append({ type: "compaction", summary: done.summary, keep: done.keep });
    return done;
  }

  /** Start over with an empty conversation in a new session file. */
  clear(): void {
    this.messages = [];
    this.session = this.freshSession();
    this.resumed = false;
  }

  setModel(model: string): void {
    this.model = model;
  }

  switchProvider(name: string, model?: string): void {
    this.provider = getProvider(name);
    this.model = model ?? this.provider.defaultModel;
    this.cfg = { ...this.cfg, provider: name };
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
