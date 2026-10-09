import { z } from "zod";
import { createTaskSchema, stageSchema, taskInputSchema, type Stage, type Task } from "./contracts";
import type { GuideAction, GuideActionResult } from "./guide-actions";

export const CREATE_TASK_METHOD = "launchpad.create_task";
export const MOVE_TASK_METHOD = "launchpad.move_task";
export const guideCreateTaskSchema = createTaskSchema.extend({ version: z.literal(1) }).strict();
// The agent names a task by title; only the browser resolves it to an owned task ID.
export const guideMoveTaskSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), title: taskInputSchema.shape.title, fromStage: stageSchema.nullable(), stage: stageSchema,
}).strict();
export type GuideCreateTask = z.infer<typeof guideCreateTaskSchema>;
export type GuideMoveTask = z.infer<typeof guideMoveTaskSchema>;
export type CreateTaskError = "invalid_request" | "unavailable" | "busy" | "interrupted" | "blocked" | "save_failed" | "outcome_unknown";
export type CreateTaskResult = { version: 1; requestId: string; applied: true; task: Pick<Task, "id" | "title" | "stage"> }
  | { version: 1; requestId: string; applied: false; error: CreateTaskError };
export type MoveTaskError = "invalid_request" | "unavailable" | "busy" | "interrupted" | "blocked" | "not_found" | "ambiguous" | "already_in_stage" | "save_failed" | "outcome_unknown";
export type MoveTaskReply = { version: 1; requestId: string; applied: true; task: { id: string; title: string; fromStage: Stage; stage: Stage } }
  | { version: 1; requestId: string; applied: false; error: Exclude<MoveTaskError, "ambiguous"> }
  | { version: 1; requestId: string; applied: false; error: "ambiguous"; stages: Stage[] };
export type TaskControlTarget = "task-new" | "task-save" | "task-move" | `task-move-to-${Lowercase<Stage>}` | "task-move-save";
export type TaskGuideDriver = {
  navigate: (action: GuideAction) => Promise<GuideActionResult>;
  activate: (target: TaskControlTarget) => Promise<GuideActionResult>;
  signal: AbortSignal;
};
const savedTextSchema = (max: number) => z.string().refine(value => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && [...value].length <= max);
// Sample tasks carry a short display tag; a created task never does.
export const savedTaskSchema = taskInputSchema.extend({ id: z.uuid(), tag: savedTextSchema(40).optional() }).strict();
// A move receipt echoes the whole stored task, so its stage is never defaulted.
export const moveTaskReceiptSchema = z.object({
  task: savedTaskSchema.extend({ stage: stageSchema }).strict(), fromStage: stageSchema, replayed: z.boolean(),
}).strict();

function parseBounded<T>(schema: z.ZodType<T>, payload: string): T | null {
  if (new TextEncoder().encode(payload).byteLength > 4096) return null;
  try { const result = schema.safeParse(JSON.parse(payload)); return result.success ? result.data : null; }
  catch { return null; }
}
export const parseCreateTask = (payload: string): GuideCreateTask | null => parseBounded(guideCreateTaskSchema, payload);
export const parseMoveTask = (payload: string): GuideMoveTask | null => parseBounded(guideMoveTaskSchema, payload);

// Spoken titles vary in case, spacing, and punctuation. The agent uses the same key.
export const taskReferenceKey = (value: string) => [...value.normalize("NFKC").toLowerCase()].filter(character => /[\p{L}\p{N}]/u.test(character)).join("");

export type MoveResolution = { ok: true; task: Task } | { ok: false; error: "not_found" | "already_in_stage" } | { ok: false; error: "ambiguous"; stages: Stage[] };
export function resolveMoveTask(tasks: readonly Task[], request: Pick<GuideMoveTask, "title" | "fromStage" | "stage">): MoveResolution {
  const key = taskReferenceKey(request.title);
  // A title with no letters or digits would match every such task.
  if (!key) return { ok: false, error: "not_found" };
  const candidates = tasks.filter(task => taskReferenceKey(task.title) === key && (request.fromStage === null || task.stage === request.fromStage));
  if (candidates.length === 0) return { ok: false, error: "not_found" };
  if (candidates.length > 1) return { ok: false, error: "ambiguous", stages: stageSchema.options.filter(stage => candidates.some(task => task.stage === stage)) };
  return candidates[0].stage === request.stage ? { ok: false, error: "already_in_stage" } : { ok: true, task: candidates[0] };
}
