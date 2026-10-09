import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";
import { AppError } from "./errors";
import { getStore } from "./db";
import type { RoomConfig } from "./room-token";
import { closeRoomResources } from "./room-cleanup";

export function getRoomConfig(): RoomConfig {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const agentSecret = process.env.LAUNCHPAD_AGENT_SECRET?.trim();
  if (!url || !apiKey || !apiSecret || !agentSecret || agentSecret.length < 32) {
    throw new AppError("SETUP_REQUIRED", "The avatar connection is not configured yet. Complete the LiveKit and agent setup first.", 503);
  }
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new AppError("SETUP_REQUIRED", "The LiveKit server address needs to be configured.", 503); }
  if (parsed.protocol !== "wss:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError("SETUP_REQUIRED", "The LiveKit server must use a secure wss:// address.", 503);
  }
  return { url, apiKey, apiSecret, agentSecret };
}

export async function endOwnedRoom(ownerId: string, expectedRoomName?: string): Promise<void> {
  const store = getStore();
  if (!store.getRoom(ownerId)) return;
  const config = getRoomConfig();
  const room = store.beginEndRoom(ownerId, expectedRoomName);
  if (!room) return;
  const client = new RoomServiceClient(config.url.replace(/^wss:/, "https:"), config.apiKey, config.apiSecret, { requestTimeout: 8 });
  await closeRoomResources(client, room);
  store.finishEndRoom(ownerId, room.roomName);
}
