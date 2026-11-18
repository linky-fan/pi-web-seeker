/**
 * remark-math only recognises `$$` fences (block) and `$...$` (inline).
 * Backslash delimiters `\(...\)` and `\[...\]` are plain text to it, so they must
 * not trigger the KaTeX bundle. Inline `$` is disabled in markdownMathOptions,
 * which leaves `$$` as the only delimiter worth detecting.
 */
export function containsMath(text: string): boolean {
  return /(^|[^\\])\$\$/.test(text);
}