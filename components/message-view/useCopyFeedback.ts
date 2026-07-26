import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "./helpers";

export function useCopyFeedback(text: string) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  const copy = useCallback(() => {
    void copyText(text).then(() => {
      setCopied(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setCopied(false);
      }, 1500);
    });
  }, [text]);

  return { copied, copy };
}
