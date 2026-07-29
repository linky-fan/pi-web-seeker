import {
  getQuickChatSearchConfig,
  QuickChatSearchError,
  removeQuickChatSearchApiKey,
  saveQuickChatSearchApiKey,
  validateQuickChatSearchApiKey,
} from "@/lib/quick-chat-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CONFIG_BYTES = 8 * 1024;

function errorResponse(error: unknown): Response {
  if (error instanceof QuickChatSearchError) {
    return Response.json({ error: error.message, code: error.code, source: error.source }, { status: error.status });
  }
  return Response.json({ error: "Unable to update Tavily configuration", code: "tavily_request_failed" }, { status: 500 });
}

export async function GET() {
  return Response.json(getQuickChatSearchConfig());
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CONFIG_BYTES) return Response.json({ error: "Request is too large" }, { status: 413 });
  try {
    const body = await req.json() as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 4_096) {
      throw new QuickChatSearchError("A valid Tavily API key is required", 400, "tavily_not_configured", "stored");
    }
    await validateQuickChatSearchApiKey(apiKey, req.signal, "stored");
    await saveQuickChatSearchApiKey(apiKey);
    return Response.json(getQuickChatSearchConfig());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    await removeQuickChatSearchApiKey();
    return Response.json(getQuickChatSearchConfig());
  } catch (error) {
    return errorResponse(error);
  }
}
