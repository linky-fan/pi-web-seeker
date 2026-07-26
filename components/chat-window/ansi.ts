import type { CSSProperties } from "react";

const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const ANSI_ESCAPE_AT_START_RE = /^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/;
const ANSI_SGR_RE = /\x1B\[([0-9;]*)m/g;
const ANSI_8_COLORS = ["#1f2937", "#dc2626", "#16a34a", "#d97706", "#2563eb", "#9333ea", "#0891b2", "#6b7280"];
const ANSI_BRIGHT_COLORS = ["#9ca3af", "#ef4444", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7", "#06b6d4", "#e5e7eb"];

export interface TerminalKeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface AnsiSegment {
  text: string;
  style: CSSProperties;
}

export function toTerminalKeyData(event: TerminalKeyLike): string | null {
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
    const character = event.key.toLowerCase();
    if (character >= "a" && character <= "z") return String.fromCharCode(character.charCodeAt(0) - 96);
  }
  const keys: Record<string, string> = {
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Enter: "\r",
    Escape: "\x1b",
    Backspace: "\x7f",
    Tab: "\t",
    " ": " ",
  };
  if (keys[event.key]) return keys[event.key];
  return !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 ? event.key : null;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

function visibleCharPositions(text: string): Array<{ start: number; end: number; char: string }> {
  const positions: Array<{ start: number; end: number; char: string }> = [];
  let index = 0;
  while (index < text.length) {
    if (text.charCodeAt(index) === 0x1b) {
      const match = text.slice(index).match(ANSI_ESCAPE_AT_START_RE);
      if (match) {
        index += match[0].length;
        continue;
      }
    }
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    positions.push({ start: index, end: index + char.length, char });
    index += char.length;
  }
  return positions;
}

function removeVisibleCharAt(text: string, index: number): string {
  const position = visibleCharPositions(text)[index];
  return position ? text.slice(0, position.start) + text.slice(position.end) : text;
}

function firstVisibleChar(text: string): string | undefined {
  return visibleCharPositions(text)[0]?.char;
}

function lastNonSpaceVisibleCharIndex(text: string): number {
  const positions = visibleCharPositions(text);
  for (let index = positions.length - 1; index >= 0; index--) {
    if (positions[index].char.trim() !== "") return index;
  }
  return -1;
}

function trimEndVisibleSpaces(text: string): string {
  let next = text;
  while (true) {
    const positions = visibleCharPositions(next);
    const last = positions[positions.length - 1];
    if (!last || last.char.trim() !== "") return next;
    next = next.slice(0, last.start) + next.slice(last.end);
  }
}

export function normalizeCustomPanelLines(lines: string[]): string[] {
  const horizontalFrameLine = /^[┌├└╭╰][─┬┴┼]+[┐┤┘╮╯]$/;
  const normalized: string[] = [];
  for (const rawLine of lines) {
    if (horizontalFrameLine.test(stripAnsi(rawLine).trimEnd())) continue;
    let line = rawLine;
    const first = firstVisibleChar(line);
    if (first === "│" || first === "┃") {
      line = removeVisibleCharAt(line, 0);
      if (firstVisibleChar(line) === " ") line = removeVisibleCharAt(line, 0);
    }
    const rightBorderIndex = lastNonSpaceVisibleCharIndex(line);
    const rightBorder = rightBorderIndex >= 0 ? visibleCharPositions(line)[rightBorderIndex]?.char : undefined;
    if (rightBorder === "│" || rightBorder === "┃") line = removeVisibleCharAt(line, rightBorderIndex);
    normalized.push(trimEndVisibleSpaces(line));
  }
  while (normalized.length > 0 && stripAnsi(normalized[0]).trim() === "") normalized.shift();
  while (normalized.length > 0 && stripAnsi(normalized[normalized.length - 1]).trim() === "") normalized.pop();
  return normalized.length ? normalized : lines;
}

function ansi256Color(index: number): string | undefined {
  if (index >= 0 && index < 8) return ANSI_8_COLORS[index];
  if (index >= 8 && index < 16) return ANSI_BRIGHT_COLORS[index - 8];
  if (index >= 16 && index <= 231) {
    const value = index - 16;
    const scale = (part: number) => part === 0 ? 0 : 55 + part * 40;
    return `rgb(${scale(Math.floor(value / 36))}, ${scale(Math.floor((value % 36) / 6))}, ${scale(value % 6)})`;
  }
  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  return undefined;
}

function applyAnsiCodes(style: CSSProperties, codes: number[]): CSSProperties {
  const next = { ...style };
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];
    if (code === 0) {
      for (const key of Object.keys(next) as Array<keyof CSSProperties>) delete next[key];
    } else if (code === 1) next.fontWeight = 700;
    else if (code === 2) next.opacity = 0.65;
    else if (code === 3) next.fontStyle = "italic";
    else if (code === 4) next.textDecoration = "underline";
    else if (code === 22) {
      delete next.fontWeight;
      delete next.opacity;
    } else if (code === 23) delete next.fontStyle;
    else if (code === 24) delete next.textDecoration;
    else if (code === 39) delete next.color;
    else if (code === 49) delete next.backgroundColor;
    else if (code >= 30 && code <= 37) next.color = ANSI_8_COLORS[code - 30];
    else if (code >= 90 && code <= 97) next.color = ANSI_BRIGHT_COLORS[code - 90];
    else if (code >= 40 && code <= 47) next.backgroundColor = ANSI_8_COLORS[code - 40];
    else if (code >= 100 && code <= 107) next.backgroundColor = ANSI_BRIGHT_COLORS[code - 100];
    else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
      const [red, green, blue] = [codes[index + 2], codes[index + 3], codes[index + 4]];
      if ([red, green, blue].every((part) => typeof part === "number" && Number.isFinite(part))) {
        if (code === 38) next.color = `rgb(${red}, ${green}, ${blue})`;
        else next.backgroundColor = `rgb(${red}, ${green}, ${blue})`;
      }
      index += 4;
    } else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
      const color = ansi256Color(codes[index + 2]);
      if (color) {
        if (code === 38) next.color = color;
        else next.backgroundColor = color;
      }
      index += 2;
    }
  }
  return next;
}

export function parseAnsiLine(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: CSSProperties = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  ANSI_SGR_RE.lastIndex = 0;
  while ((match = ANSI_SGR_RE.exec(line)) !== null) {
    if (match.index > lastIndex) segments.push({ text: line.slice(lastIndex, match.index), style: { ...style } });
    style = applyAnsiCodes(style, match[1] ? match[1].split(";").map((part) => Number(part || "0")) : [0]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) segments.push({ text: line.slice(lastIndex), style: { ...style } });
  return segments;
}
