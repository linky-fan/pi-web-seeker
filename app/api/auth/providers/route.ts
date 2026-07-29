import { createAppModelRuntime } from "@/lib/model-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await createAppModelRuntime();
  const credentials = await runtime.listCredentials();
  const loggedInProviders = new Set(
    credentials.filter((credential) => credential.type === "oauth").map((credential) => credential.providerId),
  );
  const providers = runtime.getProviders().filter((provider) => provider.auth.oauth);

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.auth.oauth?.name ?? p.name,
          usesCallbackServer: false,
          loggedIn: loggedInProviders.has(p.id),
        };
      })
  );

  return Response.json({ providers: result });
}
