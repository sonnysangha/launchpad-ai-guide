import { z } from "zod";

export const GUIDE_ACTION_METHOD = "launchpad.perform_action";
export const GUIDE_ACTION_MAX_BYTES = 2048;

const envelope = { version: z.literal(1), actionId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) };
export const guideActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...envelope, kind: z.literal("navigate"), target: z.enum(["overview", "workflow", "roles", "handbook"]) }).strict(),
  z.object({ ...envelope, kind: z.literal("stage"), target: z.enum(["brief", "build", "review", "handoff"]) }).strict(),
  z.object({ ...envelope, kind: z.literal("role"), target: z.enum(["owner", "contributor", "reviewer"]) }).strict(),
  z.object({ ...envelope, kind: z.literal("faq"), target: z.enum(["workflow", "roles", "handoff"]) }).strict(),
]);

export type GuideAction = z.infer<typeof guideActionSchema>;
export type GuideActionError = "cancelled" | "invalid_action" | "target_unavailable" | "state_not_applied" | "busy" | "unauthorized";
export type GuideActionResult = { version: 1; actionId: string; applied: true } | { version: 1; actionId: string; applied: false; error: GuideActionError };

export function parseGuideAction(payload: string): GuideAction | null {
  if (new TextEncoder().encode(payload).byteLength > GUIDE_ACTION_MAX_BYTES) return null;
  try {
    const parsed = guideActionSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function guideActionMarker(action: GuideAction): string {
  return `${action.kind === "navigate" ? "nav" : action.kind}-${action.target}`;
}

// Fixed local controls outside the read-only registry. A manual click on one still
// takes over from the guide; launchpad.perform_action can never target them.
const localControlMarkers = new Set(["project-home", "task-search-clear", "task-new", "task-save", "task-move", "task-move-save",
  "task-move-to-brief", "task-move-to-build", "task-move-to-review", "task-move-to-handoff"]);

export function isGuideActionMarker(marker: string): boolean {
  if (localControlMarkers.has(marker)) return true;
  const [kind, target, ...extra] = marker.split("-");
  return extra.length === 0 && guideActionSchema.safeParse({ version: 1, actionId: "manual", kind: kind === "nav" ? "navigate" : kind, target }).success;
}

export function guideActionTab(action: GuideAction): "overview" | "workflow" | "roles" | "handbook" {
  if (action.kind === "navigate") return action.target;
  return action.kind === "stage" ? "workflow" : action.kind === "role" ? "roles" : "handbook";
}
