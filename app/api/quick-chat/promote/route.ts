import { existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { assertPathAllowed } from "@/lib/allowed-roots";
import {
  cacheSessionPath,
  invalidateSessionFileCache,
  invalidateSessionListCache,
} from "@/lib/session-reader";
import {
  parseQuickChatMessages,
  parseQuickChatModel,
  quickChatMessageTextForPromotion,
  QuickChatValidationError,
} from "@/lib/quick-chat";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function zeroUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; messages?: unknown; provider?: unknown; modelId?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) throw new QuickChatValidationError("cwd is required");
    if (!existsSync(cwd)) throw new QuickChatValidationError(`Directory does not exist: ${cwd}`);
    if (!statSync(cwd).isDirectory()) throw new QuickChatValidationError(`Path is not a directory: ${cwd}`);
    try {
      await assertPathAllowed(cwd);
    } catch {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const modelRef = parseQuickChatModel(body);
    const messages = parseQuickChatMessages(body.messages);
    const registry = ModelRegistry.create(AuthStorage.create());
    const model = registry.find(modelRef.provider, modelRef.modelId);
    if (!model) {
      return NextResponse.json({ error: `Model not found: ${modelRef.provider}/${modelRef.modelId}` }, { status: 404 });
    }

    const manager = SessionManager.create(cwd);
    manager.appendModelChange(model.provider, model.id);
    for (const message of messages) {
      if (message.role === "user") {
        manager.appendMessage({ role: "user", content: message.text, timestamp: message.timestamp });
      } else {
        manager.appendMessage({
          role: "assistant",
          content: [{ type: "text", text: quickChatMessageTextForPromotion(message) }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: zeroUsage(),
          stopReason: "stop",
          timestamp: message.timestamp,
        });
      }
    }

    const sessionFile = manager.getSessionFile();
    const header = manager.getHeader();
    if (!sessionFile || !header) throw new Error("Failed to persist quick chat session");

    cacheSessionPath(header.id, sessionFile);
    invalidateSessionFileCache(sessionFile);
    invalidateSessionListCache();
    const now = new Date().toISOString();
    const firstUserMessage = messages.find((message) => message.role === "user")?.text ?? "(no messages)";
    const session: SessionInfo = {
      path: sessionFile,
      id: header.id,
      cwd,
      created: header.timestamp || now,
      modified: now,
      messageCount: messages.length,
      firstMessage: firstUserMessage,
    };

    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof QuickChatValidationError ? error.status : 400 },
    );
  }
}
