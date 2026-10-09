import { requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/config";
import { resetSchema } from "@/lib/contracts";
import { getStore } from "@/lib/db";
import { apiError, AppError, privateJson } from "@/lib/errors";
import { endOwnedRoom } from "@/lib/livekit";
import { assertSameOrigin, readJson } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, appOrigin());
    const hostname = new URL(appOrigin()).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
      throw new AppError("LOCAL_ONLY", "Reset is available only for the local demo workspace.", 403);
    }
    const userId = await requireUser();
    await readJson(request, resetSchema);
    await endOwnedRoom(userId);
    getStore().resetWorkspace(userId);
    return privateJson({ reset: true });
  } catch (error) { return apiError(error); }
}
