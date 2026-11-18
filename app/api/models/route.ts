import { getModelsPayload } from "@/lib/models-payload";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getModelsPayload());
}