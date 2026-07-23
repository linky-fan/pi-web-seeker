"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { revealElement } from "@/lib/motion";

interface Options {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mentionPanelRef: RefObject<HTMLDivElement | null>;
  slashPanelRef: RefObject<HTMLDivElement | null>;
  closeMention: () => void;
  closeSlash: () => void;
}

export function useComposerMenusController(options: Options) {
  const { textareaRef, mentionPanelRef, slashPanelRef, closeMention, closeSlash } = options;
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [reviewerDropdownOpen, setReviewerDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [snippetDropdownOpen, setSnippetDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const reviewerDropdownRef = useRef<HTMLDivElement>(null);
  const reviewerDropdownPanelRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownPanelRef = useRef<HTMLDivElement>(null);
  const snippetDropdownRef = useRef<HTMLDivElement>(null);
  const snippetDropdownPanelRef = useRef<HTMLDivElement>(null);

  const updateModelDropdownRect = useCallback(() => {
    const rect = modelButtonRef.current?.getBoundingClientRect();
    if (rect) setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!modelDropdownOpen) return;
    updateModelDropdownRect();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateModelDropdownRect);
    window.addEventListener("scroll", updateModelDropdownRect, true);
    visualViewport?.addEventListener("resize", updateModelDropdownRect);
    visualViewport?.addEventListener("scroll", updateModelDropdownRect);
    return () => {
      window.removeEventListener("resize", updateModelDropdownRect);
      window.removeEventListener("scroll", updateModelDropdownRect, true);
      visualViewport?.removeEventListener("resize", updateModelDropdownRect);
      visualViewport?.removeEventListener("scroll", updateModelDropdownRect);
    };
  }, [modelDropdownOpen, updateModelDropdownRect]);

  useEffect(() => {
    if (!snippetDropdownOpen) return;
    const tween = revealElement(snippetDropdownPanelRef.current, { y: 5, scale: 0.99, duration: 0.16 });
    return () => { tween?.kill(); };
  }, [snippetDropdownOpen]);

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const tween = revealElement(modelDropdownPanelRef.current, { y: 5, scale: 0.99, duration: 0.16 });
    return () => { tween?.kill(); };
  }, [modelDropdownOpen]);

  useEffect(() => {
    if (!reviewerDropdownOpen) return;
    const tween = revealElement(reviewerDropdownPanelRef.current, { y: 5, scale: 0.99, duration: 0.16 });
    return () => { tween?.kill(); };
  }, [reviewerDropdownOpen]);

  useEffect(() => {
    if (!thinkingDropdownOpen) return;
    const tween = revealElement(thinkingDropdownPanelRef.current, { y: 5, scale: 0.99, duration: 0.16 });
    return () => { tween?.kill(); };
  }, [thinkingDropdownOpen]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!dropdownRef.current?.contains(target) && !modelDropdownPanelRef.current?.contains(target)) setModelDropdownOpen(false);
      if (!thinkingDropdownRef.current?.contains(target)) setThinkingDropdownOpen(false);
      if (!reviewerDropdownRef.current?.contains(target)) setReviewerDropdownOpen(false);
      if (!snippetDropdownRef.current?.contains(target)) setSnippetDropdownOpen(false);
      if (!mentionPanelRef.current?.contains(target) && !textareaRef.current?.contains(target)) closeMention();
      if (!slashPanelRef.current?.contains(target) && !textareaRef.current?.contains(target)) closeSlash();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [closeMention, closeSlash, mentionPanelRef, slashPanelRef, textareaRef]);

  return useMemo(() => ({
    modelDropdownOpen, modelDropdownRect, reviewerDropdownOpen, thinkingDropdownOpen, snippetDropdownOpen,
    dropdownRef, modelButtonRef, modelDropdownPanelRef, reviewerDropdownRef, reviewerDropdownPanelRef,
    thinkingDropdownRef, thinkingDropdownPanelRef, snippetDropdownRef, snippetDropdownPanelRef,
    setModelDropdownOpen, setModelDropdownRect, setReviewerDropdownOpen, setThinkingDropdownOpen, setSnippetDropdownOpen,
  }), [modelDropdownOpen, modelDropdownRect, reviewerDropdownOpen, snippetDropdownOpen, thinkingDropdownOpen]);
}

export type ComposerMenusController = ReturnType<typeof useComposerMenusController>;
