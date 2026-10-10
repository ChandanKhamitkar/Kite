export type KeyInfo = {
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  escape?: boolean;
  tab?: boolean;
};

export type InputState = {
  value: string;
  cursor: number;
  /** Submitted lines, oldest first. */
  history: string[];
  /** Position while browsing history (null = editing a fresh line). */
  browsing: number | null;
  draft: string;
};

export const emptyInput = (history: string[] = []): InputState => ({
  value: "",
  cursor: 0,
  history,
  browsing: null,
  draft: "",
});

const setValue = (s: InputState, value: string, cursor = value.length): InputState => ({
  ...s,
  value,
  cursor,
});

/**
 * Apply one keypress. `submit` is set when the user pressed enter on a
 * non-empty line; the returned state is then already cleared.
 */
export function editInput(
  s: InputState,
  input: string,
  key: KeyInfo,
): { state: InputState; submit?: string } {
  if (key.return) {
    const line = s.value.trim();
    if (!line) return { state: s };
    const history = s.history.at(-1) === line ? s.history : [...s.history, line];
    return { state: emptyInput(history), submit: line };
  }

  if (key.ctrl) {
    if (input === "u") return { state: setValue(s, s.value.slice(s.cursor), 0) };
    if (input === "a") return { state: { ...s, cursor: 0 } };
    if (input === "e") return { state: { ...s, cursor: s.value.length } };
    if (input === "w") {
      const before = s.value.slice(0, s.cursor).replace(/\S*\s*$/, "");
      return { state: setValue(s, before + s.value.slice(s.cursor), before.length) };
    }
    return { state: s };
  }

  if (key.leftArrow) return { state: { ...s, cursor: Math.max(s.cursor - 1, 0) } };
  if (key.rightArrow) return { state: { ...s, cursor: Math.min(s.cursor + 1, s.value.length) } };

  if (key.upArrow) {
    if (!s.history.length) return { state: s };
    const idx = s.browsing === null ? s.history.length - 1 : Math.max(s.browsing - 1, 0);
    return {
      state: {
        ...setValue(s, s.history[idx]!),
        browsing: idx,
        draft: s.browsing === null ? s.value : s.draft,
      },
    };
  }
  if (key.downArrow) {
    if (s.browsing === null) return { state: s };
    const idx = s.browsing + 1;
    if (idx >= s.history.length) return { state: { ...setValue(s, s.draft), browsing: null } };
    return { state: { ...setValue(s, s.history[idx]!), browsing: idx } };
  }

  // Terminals send backspace as either "backspace" or "delete".
  if (key.backspace || key.delete) {
    if (s.cursor === 0) return { state: s };
    return {
      state: setValue(s, s.value.slice(0, s.cursor - 1) + s.value.slice(s.cursor), s.cursor - 1),
    };
  }

  if (key.meta || key.escape || key.tab || !input) return { state: s };

  // Typed or pasted text; newlines become spaces so one prompt stays one line.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const text = input.replace(/[\r\n]+/g, " ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  return {
    state: setValue(
      { ...s, browsing: null },
      s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor),
      s.cursor + text.length,
    ),
  };
}
