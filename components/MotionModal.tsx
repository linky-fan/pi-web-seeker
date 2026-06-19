"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { animateModalIn, animateModalOut } from "@/lib/motion";

const modalStack: symbol[] = [];

interface MotionModalProps {
  children: ReactNode | ((close: () => void) => ReactNode);
  onClose: () => void;
  overlayStyle?: CSSProperties;
  panelStyle?: CSSProperties;
  closeOnOverlay?: boolean;
  closeSignal?: unknown;
}

export function MotionModal({
  children,
  onClose,
  overlayStyle,
  panelStyle,
  closeOnOverlay = true,
  closeSignal,
}: MotionModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(Symbol("motion-modal"));
  const closingRef = useRef(false);
  const previousCloseSignalRef = useRef(closeSignal);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const tween = animateModalOut(overlayRef.current, panelRef.current, onClose);
    if (!tween) return;
  }, [onClose]);

  useLayoutEffect(() => {
    const tween = animateModalIn(overlayRef.current, panelRef.current);
    return () => { tween?.kill(); };
  }, []);

  useEffect(() => {
    const id = idRef.current;
    modalStack.push(id);
    return () => {
      const index = modalStack.lastIndexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  useEffect(() => {
    if (Object.is(previousCloseSignalRef.current, closeSignal)) {
      return;
    }
    previousCloseSignalRef.current = closeSignal;
    requestClose();
  }, [closeSignal, requestClose]);

  return (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        ...overlayStyle,
      }}
      onClick={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: 860,
          height: "78vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
          willChange: "transform, opacity",
          ...panelStyle,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {typeof children === "function" ? children(requestClose) : children}
      </div>
    </div>
  );
}
