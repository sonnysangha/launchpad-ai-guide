import { requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/config";
import { roomRequestSchema } from "@/lib/contracts";
import { getStore } from "@/lib/db";
import { apiError, AppError, privateJson } from "@/lib/errors";
import { getRoomConfig } from "@/lib/livekit";
import { assertSameOrigin, readJson } from "@/lib/request-security";
import { issueRoomToken, makeRoomIdentities } from "@/lib/room-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, appOrigin());
    const userId = await requireUser();
    const input = await readJson(request, roomRequestSchema);
    const config = getRoomConfig();
    const store = getStore();
    const workspace = store.getWorkspace(userId);
    if (input.mode === "help" && !workspace) {
      throw new AppError("ONBOARDING_REQUIRED", "Create your workspace before opening the workspace guide.", 409);
    }
    if (input.mode === "onboarding" && workspace) {
      throw new AppError("ALREADY_ONBOARDED", "Your workspace is ready. Open Help to speak with the guide.", 409);
    }
    const draft = input.mode === "help" && workspace ? {
      workspaceName: workspace.workspaceName, projectName: workspace.projectName, workflow: workspace.workflow,
    } : input.draft;
    const session = store.acquireRoom(userId, input.mode, makeRoomIdentities(userId, config.agentSecret), undefined, input.experience);
    return privateJson(await issueRoomToken(session, draft, config));
  } catch (error) { return apiError(error); }
}
