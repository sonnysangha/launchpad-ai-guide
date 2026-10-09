import { requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/config";
import { moveTaskSchema } from "@/lib/contracts";
import { getStore } from "@/lib/db";
import { apiError, privateJson } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, appOrigin());
    const userId = await requireUser();
    const input = await readJson(request, moveTaskSchema);
    return privateJson(getStore().moveTaskStage(userId, input));
  } catch (error) { return apiError(error); }
}
