import { createAppModelRuntime } from "@/lib/model-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await createAppModelRuntime();
  const all = runtime.getModels();
  const oauthProviderIds = new Set(
    runtime.getProviders().filter((provider) => provider.auth.oauth).map((provider) => provider.id),
  );

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: {
    id: string;
    displayName: string;
    configured: boolean;
    source?: string;
    modelCount: number;
  }[] = [];

  for (const m of all) {
    if (seen.has(m.provider)) continue;
    seen.add(m.provider);
    if (oauthProviderIds.has(m.provider)) continue;
    const status = runtime.getProviderAuthStatus(m.provider);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;
    const displayName = runtime.getProvider(m.provider)?.name ?? m.provider;
    const modelCount = all.filter((x) => x.provider === m.provider).length;
    result.push({
      id: m.provider,
      displayName,
      configured: status.configured,
      source: status.source,
      modelCount,
    });
  }

  return Response.json({ providers: result });
}
