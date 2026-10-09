import { requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/config";
import { createWorkspaceSchema } from "@/lib/contracts";
import { getStore } from "@/lib/db";
import { apiError, privateJson } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUser();
    return privateJson({ workspace: getStore().getWorkspace(userId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, appOrigin());
    const userId = await requireUser();
    const { confirmed: _confirmed, ...draft } = await readJson(request, createWorkspaceSchema);
    const result = getStore().createWorkspace(userId, draft);
    return privateJson(result, result.created ? 201 : 200);
  } catch (error) { return apiError(error); }
}
