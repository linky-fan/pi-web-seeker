import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { markdownMathOptions } from "@/lib/markdown";

export const MESSAGE_REMARK_PLUGINS: NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [
  remarkGfm,
  [remarkMath, markdownMathOptions],
];

export const MESSAGE_REHYPE_PLUGINS: NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]> = [
  rehypeKatex,
];
