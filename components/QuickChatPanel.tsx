"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { apiPath } from "@/lib/api-path";
import { markdownMathOptions, normalizeMarkdownMath } from "@/lib/markdown";
import { useLocale } from "@/lib/i18n";
import type { QuickChatMessage } from "@/lib/quick-chat";
import type { SessionInfo } from "@/lib/types";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface SelectedModel {
  provider: string;
  modelId: string;
}

interface StoredQuickChat {
  messages: QuickChatMessage[];
  model: SelectedModel | null;
}

interface Props {
  activeCwd: string | null;
  modelsRefreshKey: number;
  onOpenModels: () => void;
  onPromoted: (session: SessionInfo) => void;
}

const STORAGE_KEY = "pi-web.quick-chat.v1";

function modelKey(model: SelectedModel): string {
  return `${model.provider}\u0000${model.modelId}`;
}

function readStoredState(): StoredQuickChat {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredQuickChat> | null;
    const messages = Array.isArray(parsed?.messages)
      ? parsed.messages.filter((message): message is QuickChatMessage => (
          !!message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.text === "string" &&
          typeof message.timestamp === "number"
        ))
      : [];
    const model = parsed?.model && typeof parsed.model.provider === "string" && typeof parsed.model.modelId === "string"
      ? parsed.model
      : null;
    return { messages, model };
  } catch {
    return { messages: [], model: null };
  }
}

function shortWorkspace(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() || cwd;
}

export function QuickChatPanel({ activeCwd, modelsRefreshKey, onOpenModels, onPromoted }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<QuickChatMessage[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [preferredAvailable, setPreferredAvailable] = useState(true);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteCwd, setPromoteCwd] = useState("");
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [promoting, setPromoting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = readStoredState();
    setMessages(stored.messages);
    setSelectedModel(stored.model);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, model: selectedModel }));
    } catch {
      // sessionStorage may be unavailable in restricted contexts.
    }
  }, [hydrated, messages, selectedModel]);

  useEffect(() => {
    let cancelled = false;
    fetch(apiPath("models"))
      .then((response) => response.json())
      .then((data: { modelList?: ModelOption[]; defaultModel?: SelectedModel | null }) => {
        if (cancelled) return;
        const nextModels = data.modelList ?? [];
        setModels(nextModels);
        const preferred = nextModels.find((model) => /deepseek.*v4.*flash/i.test(`${model.name} ${model.id}`));
        setPreferredAvailable(!!preferred);
        setSelectedModel((current) => {
          if (current && nextModels.some((model) => model.provider === current.provider && model.id === current.modelId)) return current;
          if (preferred) return { provider: preferred.provider, modelId: preferred.id };
          const configuredDefault = data.defaultModel && nextModels.find((model) => (
            model.provider === data.defaultModel?.provider && model.id === data.defaultModel.modelId
          ));
          const fallback = configuredDefault ?? nextModels[0];
          return fallback ? { provider: fallback.provider, modelId: fallback.id } : null;
        });
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => { cancelled = true; };
  }, [modelsRefreshKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPromoteOpen(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, streamingText, open]);

  const selectedModelName = useMemo(() => {
    if (!selectedModel) return "";
    return models.find((model) => model.provider === selectedModel.provider && model.id === selectedModel.modelId)?.name
      ?? selectedModel.modelId;
  }, [models, selectedModel]);

  const clearConversation = useCallback((resetModel: boolean) => {
    requestGenerationRef.current += 1;
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setStreamingText("");
    setSending(false);
    setError(null);
    setPromoteOpen(false);
    if (resetModel) {
      const preferred = models.find((model) => /deepseek.*v4.*flash/i.test(`${model.name} ${model.id}`)) ?? models[0];
      setSelectedModel(preferred ? { provider: preferred.provider, modelId: preferred.id } : null);
    }
  }, [models]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !selectedModel || sending) return;

    const userMessage: QuickChatMessage = { role: "user", text, timestamp: Date.now() };
    const requestMessages = [...messages, userMessage];
    setMessages(requestMessages);
    setInput("");
    setError(null);
    setStreamingText("");
    setSending(true);
    const controller = new AbortController();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    abortRef.current = controller;
    let assistantText = "";
    let streamError = "";

    try {
      const response = await fetch(apiPath("quick-chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          modelId: selectedModel.modelId,
          messages: requestMessages,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(6)) as { type?: string; delta?: string; error?: string };
          if (event.type === "delta" && event.delta) {
            assistantText += event.delta;
            if (requestGenerationRef.current === requestGeneration) setStreamingText(assistantText);
          } else if (event.type === "error") {
            streamError = event.error ?? t("quickChat.requestFailed");
          }
        }
        if (done) break;
      }
      if (streamError) throw new Error(streamError);
      if (requestGenerationRef.current === requestGeneration && assistantText.trim()) {
        setMessages((current) => [...current, { role: "assistant", text: assistantText, timestamp: Date.now() }]);
      }
    } catch (requestError) {
      if (requestGenerationRef.current === requestGeneration && assistantText.trim()) {
        setMessages((current) => [...current, { role: "assistant", text: assistantText, timestamp: Date.now() }]);
      }
      if (requestGenerationRef.current === requestGeneration && !controller.signal.aborted) {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (requestGenerationRef.current === requestGeneration) {
        setStreamingText("");
        setSending(false);
      }
    }
  }, [input, messages, selectedModel, sending, t]);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }, [send]);

  const openPromotion = useCallback(() => {
    setError(null);
    setPromoteCwd(activeCwd ?? "");
    setPromoteOpen(true);
    fetch(apiPath("sessions"))
      .then((response) => response.json())
      .then((data: { sessions?: SessionInfo[] }) => {
        const seen = new Set<string>();
        const cwds: string[] = [];
        for (const session of data.sessions ?? []) {
          if (session.cwd && !seen.has(session.cwd)) {
            seen.add(session.cwd);
            cwds.push(session.cwd);
          }
        }
        setRecentCwds(cwds.slice(0, 8));
        if (!activeCwd && cwds[0]) setPromoteCwd(cwds[0]);
      })
      .catch(() => setRecentCwds([]));
  }, [activeCwd]);

  const promote = useCallback(async () => {
    const cwd = promoteCwd.trim();
    if (!cwd || !selectedModel || messages.length === 0 || promoting) return;
    setPromoting(true);
    setError(null);
    try {
      const response = await fetch(apiPath("quick-chat/promote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          provider: selectedModel.provider,
          modelId: selectedModel.modelId,
          messages,
        }),
      });
      const data = await response.json().catch(() => ({})) as { session?: SessionInfo; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error ?? `HTTP ${response.status}`);
      setMessages([]);
      setInput("");
      setPromoteOpen(false);
      setOpen(false);
      try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      onPromoted(data.session);
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : String(promoteError));
    } finally {
      setPromoting(false);
    }
  }, [messages, onPromoted, promoteCwd, promoting, selectedModel]);

  return (
    <div className={`pi-quick-chat${open ? " pi-quick-chat-open" : ""}`}>
      {!open && (
        <button className="pi-quick-chat-launcher" type="button" onClick={() => setOpen(true)} aria-label={t("quickChat.open")}>
          <span className="pi-quick-chat-pulse" aria-hidden="true" />
          {t("quickChat.tab")}
        </button>
      )}

      {open && (
        <section className="pi-quick-chat-panel" aria-label={t("quickChat.title")}>
          <header className="pi-quick-chat-header">
            <div className="pi-quick-chat-heading">
              <span className="pi-quick-chat-status" aria-hidden="true" />
              <div>
                <strong>{t("quickChat.title")}</strong>
                <span>{t("quickChat.subtitle")}</span>
              </div>
            </div>
            <div className="pi-quick-chat-header-actions">
              <button type="button" onClick={() => clearConversation(true)} title={t("quickChat.new")}>{t("quickChat.new")}</button>
              <button type="button" onClick={() => setOpen(false)} title={t("quickChat.collapse")} aria-label={t("quickChat.collapse")}>−</button>
            </div>
          </header>

          <div className="pi-quick-chat-model-row">
            <select
              value={selectedModel ? modelKey(selectedModel) : ""}
              onChange={(event) => {
                const [provider, modelId] = event.target.value.split("\u0000");
                setSelectedModel(provider && modelId ? { provider, modelId } : null);
              }}
              disabled={models.length === 0 || sending}
              aria-label={t("quickChat.model")}
            >
              {models.length === 0 && <option value="">{t("quickChat.noModels")}</option>}
              {models.map((model) => (
                <option key={`${model.provider}:${model.id}`} value={modelKey({ provider: model.provider, modelId: model.id })}>
                  {model.name} · {model.provider}
                </option>
              ))}
            </select>
            <button type="button" onClick={onOpenModels}>{t("quickChat.configure")}</button>
          </div>

          {!preferredAvailable && models.length > 0 && (
            <div className="pi-quick-chat-notice">{t("quickChat.fallback", { model: selectedModelName })}</div>
          )}

          <div className="pi-quick-chat-messages" ref={messagesRef} aria-live="polite">
            {messages.length === 0 && !streamingText && (
              <div className="pi-quick-chat-empty">
                <strong>{t("quickChat.emptyTitle")}</strong>
                <span>{t("quickChat.emptyHint")}</span>
              </div>
            )}
            {messages.map((message, index) => (
              <article key={`${message.timestamp}:${index}`} className={`pi-quick-chat-message pi-quick-chat-message-${message.role}`}>
                {message.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, markdownMathOptions]]} rehypePlugins={[rehypeKatex]}>
                    {normalizeMarkdownMath(message.text)}
                  </ReactMarkdown>
                ) : message.text}
              </article>
            ))}
            {sending && (
              <article className="pi-quick-chat-message pi-quick-chat-message-assistant pi-quick-chat-streaming">
                {streamingText ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, markdownMathOptions]]} rehypePlugins={[rehypeKatex]}>
                    {normalizeMarkdownMath(streamingText)}
                  </ReactMarkdown>
                ) : <span className="pi-quick-chat-typing"><i /><i /><i /></span>}
              </article>
            )}
          </div>

          {error && <div className="pi-quick-chat-error" role="alert">{error}</div>}

          {promoteOpen && (
            <div className="pi-quick-chat-promote">
              <div className="pi-quick-chat-promote-title">{t("quickChat.chooseWorkspace")}</div>
              <input
                value={promoteCwd}
                onChange={(event) => setPromoteCwd(event.target.value)}
                list="pi-quick-chat-workspaces"
                placeholder={t("quickChat.workspacePlaceholder")}
                autoFocus
              />
              <datalist id="pi-quick-chat-workspaces">
                {recentCwds.map((cwd) => <option key={cwd} value={cwd}>{shortWorkspace(cwd)}</option>)}
              </datalist>
              <div className="pi-quick-chat-promote-actions">
                <button type="button" onClick={() => setPromoteOpen(false)}>{t("common.cancel")}</button>
                <button className="primary" type="button" onClick={() => void promote()} disabled={!promoteCwd.trim() || promoting}>
                  {promoting ? t("quickChat.promoting") : t("quickChat.promoteConfirm")}
                </button>
              </div>
            </div>
          )}

          <div className="pi-quick-chat-composer">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={models.length > 0 ? t("quickChat.placeholder") : t("quickChat.configureFirst")}
              disabled={models.length === 0}
              rows={2}
            />
            <button
              className={sending ? "stop" : "send"}
              type="button"
              onClick={sending ? stop : () => void send()}
              disabled={!sending && (!input.trim() || !selectedModel)}
            >
              {sending ? t("quickChat.stop") : t("quickChat.send")}
            </button>
          </div>

          <footer className="pi-quick-chat-footer">
            <span>{t("quickChat.temporary")}</span>
            <div>
              <button type="button" onClick={() => clearConversation(false)} disabled={messages.length === 0 && !sending}>{t("quickChat.clear")}</button>
              <button className="promote" type="button" onClick={openPromotion} disabled={messages.length === 0 || sending}>{t("quickChat.promote")}</button>
            </div>
          </footer>
        </section>
      )}
    </div>
  );
}
