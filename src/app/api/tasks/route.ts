import { requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/config";
import { createTaskSchema } from "@/lib/contracts";
import { getStore } from "@/lib/db";
import { apiError, privateJson } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, appOrigin());
    const userId = await requireUser();
    const input = await readJson(request, createTaskSchema);
    const result = getStore().createTask(userId, input);
    return privateJson(result, result.created ? 201 : 200);
  } catch (error) { return apiError(error); }
}
