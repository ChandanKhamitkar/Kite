import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";

import { describeCall } from "../permissions/index.ts";
import type { Tool, ToolCallBlock } from "../types.ts";
import { formatMs, previewLines, summarizeCall, type Item } from "./state.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const spin = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    const clock = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(spin);
      clearInterval(clock);
    };
  }, []);
  return (
    <Text color="cyan">
      {FRAMES[frame]} {label} <Text dimColor>({seconds}s · esc to interrupt)</Text>
    </Text>
  );
}

export function Banner({
  provider,
  model,
  cwd,
  resumed,
}: {
  provider: string;
  model: string;
  cwd: string;
  resumed: number;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color="cyan" bold>
          ◢ kite
        </Text>
        <Text dimColor> terminal coding agent</Text>
      </Text>
      <Text dimColor>
        {provider} · {model} · {cwd}
      </Text>
      <Text dimColor>
        {resumed ? `resumed ${resumed} messages · ` : ""}/help for commands · enter to send · ctrl+c
        to quit
      </Text>
    </Box>
  );
}

function ToolCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const color = item.status === "done" ? "green" : item.status === "denied" ? "yellow" : "red";
  const { lines, more } = previewLines(item.result);
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>● </Text>
        <Text bold>{item.call.name}</Text>
        <Text> {summarizeCall(item.call)}</Text>
        <Text dimColor> {item.status === "denied" ? "denied" : formatMs(item.ms)}</Text>
      </Text>
      {item.status !== "done" || lines.length ? (
        <Box flexDirection="column" paddingLeft={2}>
          {lines.map((l, i) => (
            <Text
              key={i}
              dimColor={item.status === "done"}
              color={item.status === "done" ? undefined : color}
            >
              {i === 0 ? "╰ " : "  "}
              {l}
            </Text>
          ))}
          {more > 0 ? (
            <Text dimColor>
              {" "}
              … {more} more line{more === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export function ItemView({
  item,
  banner,
}: {
  item: Item;
  banner: React.ComponentProps<typeof Banner>;
}) {
  switch (item.kind) {
    case "banner":
      return <Banner {...banner} />;
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="cyan" bold>
            ›{" "}
          </Text>
          <Text bold>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Text>{item.text}</Text>
        </Box>
      );
    case "tool":
      return <ToolCard item={item} />;
    case "info":
      return <Text dimColor>· {item.text}</Text>;
    case "error":
      return <Text color="red">✖ {item.text}</Text>;
  }
}

const MAX_DIFF = 12;

function DiffLines({ text, sign, color }: { text: string; sign: string; color: string }) {
  const lines = text.split("\n");
  const shown = lines.slice(0, MAX_DIFF);
  return (
    <>
      {shown.map((l, i) => (
        <Text key={i} color={color}>
          {sign} {l}
        </Text>
      ))}
      {lines.length > MAX_DIFF ? (
        <Text dimColor> … {lines.length - MAX_DIFF} more lines</Text>
      ) : null}
    </>
  );
}

function CallPreview({ call }: { call: ToolCallBlock }) {
  const a = call.arguments;
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  if (call.name === "edit")
    return (
      <Box flexDirection="column">
        <Text bold>{str("path")}</Text>
        <DiffLines text={str("old_string")} sign="-" color="red" />
        <DiffLines text={str("new_string")} sign="+" color="green" />
      </Box>
    );
  if (call.name === "bash") return <Text>$ {str("command")}</Text>;
  if (call.name === "write")
    return (
      <Box flexDirection="column">
        <Text bold>{str("path")}</Text>
        <DiffLines text={str("content")} sign="+" color="green" />
      </Box>
    );
  return <Text>{describeCall(call).trim()}</Text>;
}

export type Answer = "allow" | "deny" | "allow_session";

export function PermissionPanel({
  call,
  tool,
  onAnswer,
}: {
  call: ToolCallBlock;
  tool: Tool;
  onAnswer: (answer: Answer) => void;
}) {
  useInput((input, key) => {
    const c = input.toLowerCase();
    if (c === "y" || key.return) onAnswer("allow");
    else if (c === "a") onAnswer("allow_session");
    else if (c === "n" || key.escape) onAnswer("deny");
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text color="yellow" bold>
        Allow {call.name}? <Text dimColor>({tool.risk ?? "exec"})</Text>
      </Text>
      <CallPreview call={call} />
      <Text>
        <Text color="green">[y]</Text> yes <Text color="red">[n]</Text> no{" "}
        <Text color="cyan">[a]</Text> always this session
      </Text>
    </Box>
  );
}

export function StatusBar({
  parts,
  right,
  warn,
}: {
  parts: string[];
  right: string;
  warn: boolean;
}) {
  return (
    <Box justifyContent="space-between">
      <Text dimColor color={warn ? "yellow" : undefined}>
        {parts.join(" · ")}
      </Text>
      <Text dimColor>{right}</Text>
    </Box>
  );
}
