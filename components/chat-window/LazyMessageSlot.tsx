"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

const LAZY_ROOT_MARGIN_PX = 1600;

export function LazyMessageSlot({ children, eager, estimatedHeight, registerRef, scrollRoot }: {
  children: ReactNode;
  eager: boolean;
  estimatedHeight: number;
  registerRef?: (element: HTMLDivElement | null) => void;
  scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const [shouldRender, setShouldRender] = useState(eager);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const setSlotRef = useCallback((element: HTMLDivElement | null) => {
    slotRef.current = element;
    registerRef?.(element);
  }, [registerRef]);

  useEffect(() => {
    if (eager) {
      setShouldRender(true);
      return;
    }
    if (shouldRender) return;
    const element = slotRef.current;
    const root = scrollRoot.current;
    if (!element || !root || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setShouldRender(true);
        observer.disconnect();
      }
    }, { root, rootMargin: `${LAZY_ROOT_MARGIN_PX}px 0px`, threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, scrollRoot, shouldRender]);

  const style = shouldRender
    ? { contentVisibility: "auto", containIntrinsicSize: `${estimatedHeight}px` } as CSSProperties
    : {
        minHeight: estimatedHeight,
        contentVisibility: "auto",
        containIntrinsicSize: `${estimatedHeight}px`,
        contain: "layout style paint",
      } as CSSProperties;

  return <div ref={setSlotRef} style={style}>{shouldRender ? children : null}</div>;
}
