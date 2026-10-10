import { homedir } from "node:os";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";

import { runCommand } from "../commands.ts";
import type { Ask } from "../permissions/index.ts";
import { isAbort, type Runtime } from "../runtime.ts";
import type { Tool, ToolCallBlock } from "../types.ts";
import { ItemView, PermissionPanel, Spinner, StatusBar, type Answer } from "./components.tsx";
import { editInput, emptyInput, type InputState } from "./input.ts";
import { formatTokens, initialState, reduce, shortPath } from "./state.ts";

/** Lets the runtime (created before React starts) ask the UI for permission. */
export type AskBridge = { ask?: Ask };

type Pending = { call: ToolCallBlock; tool: Tool; resolve: (a: Answer) => void };

export function App({ rt, bridge }: { rt: Runtime; bridge: AskBridge }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [ui, dispatch] = useReducer(reduce, undefined, initialState);
  const [input, setInput] = useState<InputState>(emptyInput());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>();
  const [quitHint, setQuitHint] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const lastCtrlC = useRef(0);

  useEffect(() => {
    bridge.ask = (call, tool) => new Promise<Answer>((resolve) => setPending({ call, tool, resolve }));
    return () => {
      bridge.ask = undefined;
    };
  }, [bridge]);

  const interrupt = () => {
    abort.current?.abort();
    pending?.resolve("deny");
    setPending(undefined);
  };

  async function submit(line: string) {
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const cmd = await runCommand(rt, line, controller.signal);
      if (cmd) {
        if (cmd.clear) {
          stdout.write("\x1b[2J\x1b[3J\x1b[H");
          dispatch({ kind: "reset" });
        }
        if (cmd.output) dispatch({ kind: "info", text: cmd.output });
        if (cmd.exit) return exit();
      } else {
        dispatch({ kind: "user", text: line });
        await rt.send(line, {
          signal: controller.signal,
          onEvent: (event) => dispatch({ kind: "event", event, now: Date.now() }),
        });
      }
    } catch (error) {
      if (isAbort(error)) dispatch({ kind: "interrupt" });
      else dispatch({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      abort.current = undefined;
      setBusy(false);
    }
  }

  useInput(
    (char, key) => {
      if (key.ctrl && char === "c") {
        if (busy) return interrupt();
        if (input.value) return setInput(emptyInput(input.history));
        if (Date.now() - lastCtrlC.current < 2000) return exit();
        lastCtrlC.current = Date.now();
        setQuitHint(true);
        setTimeout(() => setQuitHint(false), 2000);
        return;
      }
      if (busy) {
        if (key.escape) interrupt();
        return;
      }
      const { state, submit: line } = editInput(input, char, key);
      setInput(state);
      if (line) void submit(line);
    },
    { isActive: !pending },
  );

  const answer = (a: Answer) => {
    pending?.resolve(a);
    setPending(undefined);
  };

  const running = ui.running.map((r) => r.call.name).join(", ");
  const fill = rt.contextFill;
  const status = [
    rt.provider.name,
    rt.model,
    ...(rt.contextWindow ? [`ctx ${Math.round(fill * 100)}%`] : []),
    `in ${formatTokens(rt.usage.input)} out ${formatTokens(rt.usage.output)}`,
    shortPath(process.cwd(), homedir()),
  ];

  const banner = {
    provider: rt.provider.name,
    model: rt.model,
    cwd: shortPath(process.cwd(), homedir()),
    resumed: rt.resumed ? rt.messages.length : 0,
  };

  return (
    <Box flexDirection="column">
      <Static key={ui.epoch} items={ui.items}>
        {(item) => (
          <Box key={item.id} flexDirection="column">
            <ItemView item={item} banner={banner} />
          </Box>
        )}
      </Static>

      {ui.streaming ? (
        <Box marginTop={1}>
          <Text>{ui.streaming}</Text>
        </Box>
      ) : null}
      {ui.running.map((r) => (
        <Text key={r.call.id} color="cyan">
          ● {r.call.name} <Text dimColor>running…</Text>
        </Text>
      ))}

      {pending ? <PermissionPanel call={pending.call} tool={pending.tool} onAnswer={answer} /> : null}
      {busy && !pending ? (
        <Box marginTop={1}>
          <Spinner label={running ? `running ${running}` : ui.streaming ? "writing" : "thinking"} />
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor={busy ? "gray" : "cyan"} paddingX={1} marginTop={1}>
        <Text color={busy ? "gray" : "cyan"}>› </Text>
        {busy || pending ? (
          <Text dimColor>{pending ? "waiting for your answer…" : "working…"}</Text>
        ) : (
          <Text>
            {input.value.slice(0, input.cursor)}
            <Text inverse>{input.value[input.cursor] ?? " "}</Text>
            {input.value.slice(input.cursor + 1)}
          </Text>
        )}
      </Box>

      <StatusBar
        parts={status}
        warn={fill >= rt.cfg.compactAt}
        right={quitHint ? "press ctrl+c again to quit" : busy ? "esc interrupt" : "/help"}
      />
    </Box>
  );
}
