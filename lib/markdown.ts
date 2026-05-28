export function normalizeMarkdownMath(markdown: string): string {
  return markdown.replace(
    /(^|\n)([ \t]*)\$\$([^\n]+?)\$\$[ \t]*(?=\n|$)/g,
    (_match, prefix: string, indent: string, body: string) => `${prefix}${indent}$$\n${body}\n${indent}$$`
  );
}
