import { AppError } from "./errors";
import { verifyGuideMetadata } from "./room-token";
import type { LaunchpadStore } from "./store";

/** Signed dispatches authorize only a still-active backend-owned session. */
export function validateActiveRoom(
  envelope: string,
  secret: string,
  store: Pick<LaunchpadStore, "getRoom">,
  now = Math.floor(Date.now() / 1000),
): { valid: true; sessionExpiresAt: number } {
  let metadata;
  try { metadata = verifyGuideMetadata(envelope, secret, now); }
  catch { throw new AppError("INVALID_DISPATCH", "This guide session is not authorized.", 403); }
  const room = store.getRoom(metadata.userId);
  if (!room || room.status !== "active" || room.expiresAt <= now ||
    room.roomName !== metadata.roomName || room.participantIdentity !== metadata.participantIdentity ||
    room.mode !== metadata.mode || room.experience !== metadata.experience) {
    throw new AppError("INACTIVE_SESSION", "This guide session is no longer active.", 403);
  }
  return { valid: true, sessionExpiresAt: room.expiresAt };
}
