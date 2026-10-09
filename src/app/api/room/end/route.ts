import { requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/config";
import { endRoomSchema } from "@/lib/contracts";
import { apiError, privateJson } from "@/lib/errors";
import { endOwnedRoom } from "@/lib/livekit";
import { assertSameOrigin, readJson } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, appOrigin());
    const userId = await requireUser();
    const { roomName } = await readJson(request, endRoomSchema);
    await endOwnedRoom(userId, roomName);
    return privateJson({ ended: true });
  } catch (error) { return apiError(error); }
}
