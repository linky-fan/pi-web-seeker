"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { apiPath } from "@/lib/api-path";
import { markdownMathOptions, normalizeMarkdownMath } from "@/lib/markdown";
import { useLocale } from "@/lib/i18n";
import type { QuickChatMessage, QuickChatSource } from "@/lib/quick-chat";
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
  webSearchEnabled: boolean;
}

interface SearchConfig {
  provider: "tavily";
  configured: boolean;
  source?: "environment" | "stored";
}

interface Props {
  activeCwd: string | null;
  modelsRefreshKey: number;
  onOpenModels: () => void;
  onPromoted: (session: SessionInfo) => void;
}

const STORAGE_KEY = "pi-web.quick-chat.v1";

function Icon({ children, size = 15 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function modelKey(model: SelectedModel): string {
  return `${model.provider}\u0000${model.modelId}`;
}

function normalizedClientSource(value: unknown): QuickChatSource | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<QuickChatSource>;
  if (typeof source.title !== "string" || typeof source.url !== "string" || typeof source.snippet !== "string") return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    const normalizedUrl = url.toString();
    if (normalizedUrl.length > 2_048) return null;
    return {
      title: source.title.replace(/\s+/g, " ").trim().slice(0, 240),
      url: normalizedUrl,
      snippet: source.snippet.replace(/\s+/g, " ").trim().slice(0, 1_200),
    };
  } catch {
    return null;
  }
}

function normalizedClientSources(value: unknown): QuickChatSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: QuickChatSource[] = [];
  for (const item of value) {
    const source = normalizedClientSource(item);
    if (!source?.title || seen.has(source.url)) continue;
    seen.add(source.url);
    sources.push(source);
    if (sources.length === 5) break;
  }
  return sources;
}

function readStoredState(): StoredQuickChat {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredQuickChat> | null;
    const messages = Array.isArray(parsed?.messages)
      ? parsed.messages.flatMap((message): QuickChatMessage[] => {
          if (!message || (message.role !== "user" && message.role !== "assistant") ||
              typeof message.text !== "string" || typeof message.timestamp !== "number") return [];
          const sources = message.role === "assistant"
            ? normalizedClientSources(message.sources)
            : undefined;
          return [{ role: message.role, text: message.text, timestamp: message.timestamp, ...(sources?.length ? { sources } : {}) }];
        })
      : [];
    const model = parsed?.model && typeof parsed.model.provider === "string" && typeof parsed.model.modelId === "string"
      ? parsed.model
      : null;
    return { messages, model, webSearchEnabled: parsed?.webSearchEnabled === true };
  } catch {
    return { messages: [], model: null, webSearchEnabled: false };
  }
}

function shortWorkspace(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() || cwd;
}

function SourceLinks({ sources, label }: { sources: QuickChatSource[]; label: string }) {
  if (sources.length === 0) return null;
  return (
    <div className="pi-quick-chat-sources">
      <span>{label}</span>
      <div>
        {sources.map((source, index) => (
          <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" title={source.snippet || source.url}>
            <b>{index + 1}</b>
            <span>{source.title}</span>
            <Icon size={11}><path d="M7 17 17 7" /><path d="M7 7h10v10" /></Icon>
          </a>
        ))}
      </div>
    </div>
  );
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
  const [streamingSources, setStreamingSources] = useState<QuickChatSource[]>([]);
  const [sending, setSending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null);
  const [searchConfigOpen, setSearchConfigOpen] = useState(false);
  const [searchApiKey, setSearchApiKey] = useState("");
  const [savingSearchKey, setSavingSearchKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteCwd, setPromoteCwd] = useState("");
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [promoting, setPromoting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshSearchConfig = useCallback(async () => {
    try {
      const response = await fetch(apiPath("quick-chat/search-config"), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSearchConfig(await response.json() as SearchConfig);
    } catch {
      setSearchConfig({ provider: "tavily", configured: false });
    }
  }, []);

  useEffect(() => {
    const stored = readStoredState();
    setMessages(stored.messages);
    setSelectedModel(stored.model);
    setWebSearchEnabled(stored.webSearchEnabled);
    setHydrated(true);
    void refreshSearchConfig();
  }, [refreshSearchConfig]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, model: selectedModel, webSearchEnabled }));
    } catch {
      // sessionStorage may be unavailable in restricted contexts.
    }
  }, [hydrated, messages, selectedModel, webSearchEnabled]);

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
      if (event.key !== "Escape") return;
      if (promoteOpen) setPromoteOpen(false);
      else if (searchConfigOpen) setSearchConfigOpen(false);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    const timer = !promoteOpen && !searchConfigOpen
      ? window.setTimeout(() => inputRef.current?.focus(), 40)
      : undefined;
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, promoteOpen, searchConfigOpen]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, streamingText, streamingSources, searching, open]);

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
    setStreamingSources([]);
    setSending(false);
    setSearching(false);
    setSearchResultCount(null);
    setError(null);
    setSearchFailed(false);
    setPromoteOpen(false);
    if (resetModel) {
      const preferred = models.find((model) => /deepseek.*v4.*flash/i.test(`${model.name} ${model.id}`)) ?? models[0];
      setSelectedModel(preferred ? { provider: preferred.provider, modelId: preferred.id } : null);
    }
  }, [models]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const saveSearchKey = useCallback(async () => {
    const apiKey = searchApiKey.trim();
    if (!apiKey || savingSearchKey) return;
    setSavingSearchKey(true);
    setError(null);
    try {
      const response = await fetch(apiPath("quick-chat/search-config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await response.json().catch(() => ({})) as SearchConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSearchConfig(data);
      setSearchApiKey("");
      setSearchConfigOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingSearchKey(false);
    }
  }, [savingSearchKey, searchApiKey]);

  const removeSearchKey = useCallback(async () => {
    setSavingSearchKey(true);
    setError(null);
    try {
      const response = await fetch(apiPath("quick-chat/search-config"), { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as SearchConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSearchConfig(data);
      setWebSearchEnabled(false);
      setSearchConfigOpen(false);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setSavingSearchKey(false);
    }
  }, []);

  const toggleWebSearch = useCallback(() => {
    const next = !webSearchEnabled;
    setWebSearchEnabled(next);
    setSearchFailed(false);
    if (next && searchConfig?.configured !== true) {
      setPromoteOpen(false);
      setSearchConfigOpen(true);
    }
  }, [searchConfig?.configured, webSearchEnabled]);

  const send = useCallback(async (searchOverride?: boolean) => {
    const text = input.trim();
    const useWebSearch = searchOverride ?? webSearchEnabled;
    if (!text || !selectedModel || sending) return;
    if (useWebSearch && searchConfig?.configured !== true) {
      setSearchConfigOpen(true);
      setError(t("quickChat.searchConfigureFirst"));
      setSearchFailed(false);
      return;
    }

    const userMessage: QuickChatMessage = { role: "user", text, timestamp: Date.now() };
    const requestMessages = [...messages, userMessage];
    setMessages(requestMessages);
    setInput("");
    setError(null);
    setSearchFailed(false);
    setStreamingText("");
    setStreamingSources([]);
    setSearchResultCount(null);
    setSearching(false);
    setSending(true);
    const controller = new AbortController();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    abortRef.current = controller;
    let assistantText = "";
    let responseSources: QuickChatSource[] = [];
    let streamError = "";
    let streamErrorStage: "search" | "model" = useWebSearch ? "search" : "model";

    try {
      const response = await fetch(apiPath("quick-chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          modelId: selectedModel.modelId,
          messages: requestMessages,
          webSearch: useWebSearch,
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
          const event = JSON.parse(dataLine.slice(6)) as {
            type?: string;
            delta?: string;
            error?: string;
            stage?: "search" | "model";
            sources?: QuickChatSource[];
          };
          if (event.type === "search_start") {
            setSearching(true);
            setSearchResultCount(null);
          } else if (event.type === "search_results") {
            responseSources = normalizedClientSources(event.sources);
            setStreamingSources(responseSources);
            setSearching(false);
            setSearchResultCount(responseSources.length);
            streamErrorStage = "model";
          } else if (event.type === "delta" && event.delta) {
            assistantText += event.delta;
            if (requestGenerationRef.current === requestGeneration) setStreamingText(assistantText);
          } else if (event.type === "error") {
            streamError = event.error ?? t("quickChat.requestFailed");
            streamErrorStage = event.stage ?? streamErrorStage;
          }
        }
        if (done) break;
      }
      if (streamError) throw new Error(streamError);
      if (requestGenerationRef.current === requestGeneration && assistantText.trim()) {
        setMessages((current) => [...current, {
          role: "assistant",
          text: assistantText,
          timestamp: Date.now(),
          ...(responseSources.length ? { sources: responseSources } : {}),
        }]);
      }
    } catch (requestError) {
      if (requestGenerationRef.current === requestGeneration && assistantText.trim()) {
        setMessages((current) => [...current, {
          role: "assistant",
          text: assistantText,
          timestamp: Date.now(),
          ...(responseSources.length ? { sources: responseSources } : {}),
        }]);
      }
      if (requestGenerationRef.current === requestGeneration && !controller.signal.aborted) {
        if (streamErrorStage === "search" && !assistantText.trim()) {
          setMessages(messages);
          setInput(text);
          setSearchFailed(true);
        }
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (requestGenerationRef.current === requestGeneration) {
        setStreamingText("");
        setStreamingSources([]);
        setSending(false);
        setSearching(false);
        setSearchResultCount(null);
      }
    }
  }, [input, messages, searchConfig?.configured, selectedModel, sending, t, webSearchEnabled]);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }, [send]);

  const openPromotion = useCallback(() => {
    setError(null);
    setSearchFailed(false);
    setSearchConfigOpen(false);
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
          <Icon size={13}><path d="m13 2-8 11h7l-1 9 8-12h-7l1-8Z" /></Icon>
          {t("quickChat.tab")}
        </button>
      )}

      {open && (
        <section className="pi-quick-chat-panel" aria-label={t("quickChat.title")}>
          <header className="pi-quick-chat-header">
            <div className="pi-quick-chat-heading">
              <Icon size={15}><path d="m13 2-8 11h7l-1 9 8-12h-7l1-8Z" /></Icon>
              <strong>{t("quickChat.title")}</strong>
              <select
                value={selectedModel ? modelKey(selectedModel) : ""}
                onChange={(event) => {
                  const [provider, modelId] = event.target.value.split("\u0000");
                  setSelectedModel(provider && modelId ? { provider, modelId } : null);
                }}
                disabled={models.length === 0 || sending}
                aria-label={t("quickChat.model")}
                title={selectedModelName}
              >
                {models.length === 0 && <option value="">{t("quickChat.noModels")}</option>}
                {models.map((model) => (
                  <option key={`${model.provider}:${model.id}`} value={modelKey({ provider: model.provider, modelId: model.id })}>
                    {model.name} · {model.provider}
                  </option>
                ))}
              </select>
            </div>
            <div className="pi-quick-chat-header-actions">
              <button type="button" onClick={() => clearConversation(true)} title={t("quickChat.new")} aria-label={t("quickChat.new")}>
                <Icon><path d="M12 5v14M5 12h14" /></Icon>
              </button>
              <button type="button" onClick={() => clearConversation(false)} disabled={messages.length === 0 && !sending} title={t("quickChat.clear")} aria-label={t("quickChat.clear")}>
                <Icon><path d="M4 7h16" /><path d="m9 7 1-3h4l1 3" /><path d="m6 7 1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></Icon>
              </button>
              <button type="button" onClick={openPromotion} disabled={messages.length === 0 || sending} title={t("quickChat.promote")} aria-label={t("quickChat.promote")}>
                <Icon><path d="M7 17 17 7" /><path d="M7 7h10v10" /></Icon>
              </button>
              <button type="button" onClick={() => setOpen(false)} title={t("quickChat.collapse")} aria-label={t("quickChat.collapse")}>
                <Icon><path d="M5 12h14" /></Icon>
              </button>
            </div>
          </header>

          {!preferredAvailable && models.length > 0 && (
            <div className="pi-quick-chat-notice">{t("quickChat.fallback", { model: selectedModelName })}</div>
          )}

          <div className="pi-quick-chat-messages" ref={messagesRef} aria-live="polite">
            {messages.length === 0 && !streamingText && !sending && (
              <div className="pi-quick-chat-empty">
                <span className="pi-quick-chat-empty-mark"><Icon size={18}><path d="m13 2-8 11h7l-1 9 8-12h-7l1-8Z" /></Icon></span>
                <strong>{t("quickChat.emptyTitle")}</strong>
                <span>{t("quickChat.emptyHint")}</span>
                {models.length === 0 && <button type="button" onClick={onOpenModels}>{t("quickChat.configure")}</button>}
              </div>
            )}
            {messages.map((message, index) => (
              <Fragment key={`${message.timestamp}:${index}`}>
                <article className={`pi-quick-chat-message pi-quick-chat-message-${message.role}`}>
                  {message.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, markdownMathOptions]]} rehypePlugins={[rehypeKatex]}>
                      {normalizeMarkdownMath(message.text)}
                    </ReactMarkdown>
                  ) : message.text}
                </article>
                {message.role === "assistant" && <SourceLinks sources={message.sources ?? []} label={t("quickChat.sources")} />}
              </Fragment>
            ))}
            {sending && (searching || searchResultCount !== null) && (
              <div className={`pi-quick-chat-search-progress${searching ? " is-searching" : ""}`}>
                <span aria-hidden="true" />
                {searching ? t("quickChat.searching") : t("quickChat.searchComplete", { count: searchResultCount ?? 0 })}
              </div>
            )}
            {sending && (
              <Fragment>
                <article className="pi-quick-chat-message pi-quick-chat-message-assistant pi-quick-chat-streaming">
                  {streamingText ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, markdownMathOptions]]} rehypePlugins={[rehypeKatex]}>
                      {normalizeMarkdownMath(streamingText)}
                    </ReactMarkdown>
                  ) : !searching && <span className="pi-quick-chat-typing"><i /><i /><i /></span>}
                </article>
                <SourceLinks sources={streamingSources} label={t("quickChat.sources")} />
              </Fragment>
            )}
          </div>

          {error && (
            <div className="pi-quick-chat-error" role="alert">
              <span>{error}</span>
              {searchFailed && (
                <button type="button" onClick={() => {
                  setWebSearchEnabled(false);
                  setError(null);
                  setSearchFailed(false);
                  void send(false);
                }}>{t("quickChat.retryWithoutSearch")}</button>
              )}
            </div>
          )}

          {searchConfigOpen && (
            <div className="pi-quick-chat-search-config">
              <div>
                <strong>{t("quickChat.searchConfigTitle")}</strong>
                <span>{searchConfig?.source === "environment" ? t("quickChat.searchManaged") : t("quickChat.searchConfigHint")}</span>
              </div>
              {searchConfig?.source === "environment" ? (
                <button type="button" onClick={() => setSearchConfigOpen(false)}>{t("common.close")}</button>
              ) : (
                <>
                  <input
                    type="password"
                    value={searchApiKey}
                    onChange={(event) => setSearchApiKey(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void saveSearchKey(); }}
                    placeholder={searchConfig?.configured ? t("quickChat.searchReplaceKey") : "tvly-…"}
                    aria-label={t("quickChat.searchApiKey")}
                    autoComplete="off"
                    autoFocus
                  />
                  <div className="pi-quick-chat-search-config-actions">
                    {searchConfig?.source === "stored" && (
                      <button type="button" onClick={() => void removeSearchKey()} disabled={savingSearchKey}>{t("quickChat.searchDisconnect")}</button>
                    )}
                    <button type="button" onClick={() => setSearchConfigOpen(false)}>{t("common.cancel")}</button>
                    <button className="primary" type="button" onClick={() => void saveSearchKey()} disabled={!searchApiKey.trim() || savingSearchKey}>
                      {savingSearchKey ? t("quickChat.searchSaving") : t("quickChat.searchSave")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

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
            <div className="pi-quick-chat-composer-toolbar">
              <div>
                <button
                  className={`pi-quick-chat-search-toggle${webSearchEnabled ? " is-active" : ""}`}
                  type="button"
                  onClick={toggleWebSearch}
                  aria-pressed={webSearchEnabled}
                  title={t("quickChat.searchToggleHint")}
                >
                  <Icon size={14}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></Icon>
                  <span className="pi-quick-chat-search-dot" aria-hidden="true" />
                  {t("quickChat.webSearch")}
                </button>
                <button className="pi-quick-chat-search-settings" type="button" onClick={() => {
                  setPromoteOpen(false);
                  setSearchConfigOpen((current) => !current);
                }} title={t("quickChat.searchSettings")} aria-label={t("quickChat.searchSettings")}>
                  <Icon size={13}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Icon>
                </button>
              </div>
              <span>{t("quickChat.temporary")}</span>
              <button
                className={sending ? "pi-quick-chat-stop" : "pi-quick-chat-send"}
                type="button"
                onClick={sending ? stop : () => void send()}
                disabled={!sending && (!input.trim() || !selectedModel)}
                aria-label={sending ? t("quickChat.stop") : t("quickChat.send")}
                title={sending ? t("quickChat.stop") : t("quickChat.send")}
              >
                {sending
                  ? <Icon size={13}><rect x="7" y="7" width="10" height="10" rx="1" /></Icon>
                  : <Icon size={16}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon>}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
