import type { RoomServiceClient } from "livekit-server-sdk";
import { AppError } from "./errors";
import type { RoomSession } from "./store";

type CleanupClient = Pick<RoomServiceClient, "removeParticipant" | "deleteRoom">;

function isMissingRoom(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "not_found";
}

export async function closeRoomResources(client: CleanupClient, room: RoomSession, now = Math.floor(Date.now() / 1000)): Promise<void> {
  let failed = false;
  try {
    // On LiveKit Cloud the cutoff also revokes recently issued join tokens.
    await client.removeParticipant(room.roomName, room.participantIdentity, { revokeTokenTs: BigInt(now + 1) });
  } catch (error) { if (!isMissingRoom(error)) failed = true; }
  try {
    // Always attempt resource teardown, even when token revocation failed.
    await client.deleteRoom(room.roomName);
  } catch (error) { if (!isMissingRoom(error)) failed = true; }
  if (failed) {
    // The caller retains the 'ending' state so signed dispatches cannot restart
    // the avatar, and a later End safely retries any incomplete operation.
    throw new AppError("ROOM_END_FAILED", "The guide room could not be fully closed. Please try End again.", 502);
  }
}
