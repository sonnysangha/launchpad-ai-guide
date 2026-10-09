import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AccessToken, RoomAgentDispatch, RoomConfiguration, TrackSource } from "livekit-server-sdk";
import { z } from "zod";
import { defaultGuideExperience, guideExperienceSchema, partialDraftSchema, type Draft, type RoomCredentials } from "./contracts";
import type { RoomSession } from "./store";

export type RoomConfig = { url: string; apiKey: string; apiSecret: string; agentSecret: string };

const metadataSchema = z.object({
  v: z.literal(1),
  userId: z.string().min(1),
  participantIdentity: z.string().min(1),
  roomName: z.string().min(1),
  expiresAt: z.number().int(),
  mode: z.enum(["onboarding", "help"]),
  experience: guideExperienceSchema.optional(),
  draft: partialDraftSchema,
}).strict().transform((input) => ({ ...input, experience: input.experience ?? defaultGuideExperience(input.mode) }));

// Old signed v1 envelopes may omit experience; new signatures always include it.
export type GuideMetadata = z.input<typeof metadataSchema>;

export function makeRoomIdentities(userId: string, secret: string) {
  const owner = createHmac("sha256", secret).update(userId).digest("hex").slice(0, 24);
  return { roomName: `launchpad-${owner}-${randomUUID()}`, participantIdentity: `member-${owner}` };
}

export function signGuideMetadata(metadata: GuideMetadata, secret: string): string {
  if (secret.length < 32) throw new Error("Agent signing key must contain at least 32 characters.");
  const payload = Buffer.from(JSON.stringify(metadataSchema.parse(metadata))).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return JSON.stringify({ payload, signature });
}

// Used for local verification and cross-language contract tests. The worker
// independently verifies the same envelope before accepting a dispatch.
export function verifyGuideMetadata(envelope: string, secret: string, now = Math.floor(Date.now() / 1000)): z.output<typeof metadataSchema> {
  if (secret.length < 32) throw new Error("Invalid signing key.");
  const { payload, signature } = z.object({ payload: z.string(), signature: z.string() }).strict().parse(JSON.parse(envelope));
  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("Invalid metadata signature.");
  const metadata = metadataSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (metadata.expiresAt <= now || metadata.expiresAt > now + 600) throw new Error("Invalid metadata expiry.");
  return metadata;
}

export async function issueRoomToken(session: RoomSession, draft: Partial<Draft>, config: RoomConfig): Promise<RoomCredentials> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(300, session.expiresAt - now);
  if (ttl <= 0 || session.status !== "active") throw new Error("Room session is not active.");
  const expiresAt = now + ttl;
  const metadata = signGuideMetadata({
    v: 1, userId: session.ownerId, participantIdentity: session.participantIdentity,
    roomName: session.roomName, expiresAt, mode: session.mode, experience: session.experience, draft,
  }, config.agentSecret);
  const token = new AccessToken(config.apiKey, config.apiSecret, { identity: session.participantIdentity, ttl });
  token.addGrant({
    roomJoin: true, room: session.roomName,
    canPublish: true, canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false,
    roomAdmin: false, roomCreate: false, roomList: false, roomRecord: false,
  });
  token.roomConfig = new RoomConfiguration({
    syncStreams: true,
    maxParticipants: 3,
    emptyTimeout: 60,
    departureTimeout: 20,
    agents: [new RoomAgentDispatch({ agentName: "launchpad-guide", metadata })],
  });
  return {
    token: await token.toJwt(), serverUrl: config.url, roomName: session.roomName,
    participantIdentity: session.participantIdentity, agentIdentity: "launchpad-guide",
    avatarIdentity: "launchpad-avatar", expiresAt,
  };
}
