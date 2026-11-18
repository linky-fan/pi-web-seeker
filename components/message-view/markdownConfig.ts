import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { markdownMathOptions } from "@/lib/markdown";
import { containsMath } from "@/lib/markdown-math";

export { containsMath };

export const MESSAGE_REMARK_PLUGINS: NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [
  remarkGfm,
  [remarkMath, markdownMathOptions],
];

const REMARK_PLUGINS_WITHOUT_MATH: NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [
  remarkGfm,
];

/** remark-math is only worth running when the text can contain math at all. */
export function remarkPluginsFor(text: string): NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> {
  return containsMath(text) ? MESSAGE_REMARK_PLUGINS : REMARK_PLUGINS_WITHOUT_MATH;
}