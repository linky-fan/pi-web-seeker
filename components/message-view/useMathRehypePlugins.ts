"use client";

import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { containsMath, remarkPluginsFor } from "./markdownConfig";

type RehypePlugins = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
type RemarkPlugins = NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;

/**
 * Loads rehype-katex only when the text contains math, keeping the KaTeX pipeline out
 * of the bundle for conversations that never use it.
 */
export function useMathRehypePlugins(text: string): {
  remarkPlugins: RemarkPlugins;
  rehypePlugins: RehypePlugins;
} {
  const needsMath = containsMath(text);
  const [rehypePlugins, setRehypePlugins] = useState<RehypePlugins>([]);

  useEffect(() => {
    if (!needsMath) {
      setRehypePlugins((current) => (current.length === 0 ? current : []));
      return;
    }
    let cancelled = false;
    void import("rehype-katex").then(({ default: rehypeKatex }) => {
      if (!cancelled) setRehypePlugins([rehypeKatex]);
    }).catch(() => { /* Math renders as plain text if the chunk fails. */ });
    return () => { cancelled = true; };
  }, [needsMath]);

  return { remarkPlugins: remarkPluginsFor(text), rehypePlugins };
}