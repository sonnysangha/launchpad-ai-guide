import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createTaskSchema, defaultGuideExperience, draftSchema, guideExperienceSchema, moveTaskSchema, type CreateTaskInput, type Draft, type GuideExperience, type GuideMode, type MoveTaskInput, type MoveTaskResult, type Task, type Workspace } from "./contracts";
import { AppError } from "./errors";
import { sampleTaskTemplates } from "./sample-tasks";

export type RoomSession = {
  ownerId: string;
  roomName: string;
  participantIdentity: string;
  mode: GuideMode;
  experience: GuideExperience;
  createdAt: number;
  expiresAt: number;
  status: "active" | "ending";
};

type WorkspaceRow = Draft & { id: string; tasksJson: string; createdAt: string };

function sampleTasks(workflow: Draft["workflow"]): Task[] {
  return sampleTaskTemplates[workflow].map(task => ({ ...task, id: randomUUID() }));
}

export class LaunchpadStore {
  private readonly db: DatabaseSync;
  private readonly maxTaskMoves: number;

  constructor(path: string, { maxTaskMoves = 1000 }: { maxTaskMoves?: number } = {}) {
    this.maxTaskMoves = maxTaskMoves;
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL UNIQUE,
        workspace_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        workflow TEXT NOT NULL CHECK(workflow IN ('client_delivery', 'campaign')),
        tasks_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_sessions (
        owner_id TEXT PRIMARY KEY,
        room_name TEXT NOT NULL UNIQUE,
        participant_identity TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('onboarding', 'help')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'ending'))
      );
      CREATE TABLE IF NOT EXISTS room_requests (
        owner_id TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('token', 'new_room'))
      );
      CREATE INDEX IF NOT EXISTS room_requests_owner_time ON room_requests(owner_id, requested_at);
      CREATE TABLE IF NOT EXISTS task_creation_requests (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        task_json TEXT NOT NULL,
        PRIMARY KEY (owner_id, workspace_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS task_stage_requests (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        PRIMARY KEY (owner_id, workspace_id, request_id)
      );
    `);
    // Preserve pre-experience local sessions; old Help sessions are read-only Q&A.
    const columns = this.db.prepare("PRAGMA table_info(room_sessions)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "experience")) {
      this.transaction(() => {
        this.db.exec("ALTER TABLE room_sessions ADD COLUMN experience TEXT NOT NULL DEFAULT 'setup' CHECK(experience IN ('setup', 'tour', 'qa'))");
        this.db.exec("UPDATE room_sessions SET experience = 'qa' WHERE mode = 'help'");
      });
    }
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getWorkspace(ownerId: string): Workspace | null {
    const row = this.db.prepare(`SELECT id, workspace_name AS workspaceName, project_name AS projectName,
      workflow, tasks_json AS tasksJson, created_at AS createdAt FROM workspaces WHERE owner_id = ?`).get(ownerId) as WorkspaceRow | undefined;
    if (!row) return null;
    const { tasksJson, ...workspace } = row;
    return { ...workspace, tasks: JSON.parse(tasksJson) as Task[] };
  }

  createWorkspace(ownerId: string, input: Draft): { workspace: Workspace; created: boolean } {
    const draft = draftSchema.parse(input);
    return this.transaction(() => {
      const existing = this.getWorkspace(ownerId);
      if (existing) return { workspace: existing, created: false };
      const workspace: Workspace = { ...draft, id: randomUUID(), createdAt: new Date().toISOString(), tasks: sampleTasks(draft.workflow) };
      this.db.prepare(`INSERT INTO workspaces(id, owner_id, workspace_name, project_name, workflow, tasks_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(workspace.id, ownerId, workspace.workspaceName,
        workspace.projectName, workspace.workflow, JSON.stringify(workspace.tasks), workspace.createdAt);
      return { workspace, created: true };
    });
  }

  resetWorkspace(ownerId: string): void {
    this.db.prepare("DELETE FROM workspaces WHERE owner_id = ?").run(ownerId);
  }

  createTask(ownerId: string, input: CreateTaskInput): { task: Task; created: boolean } {
    const { requestId, title, description, stage } = createTaskSchema.parse(input);
    const payloadJson = JSON.stringify({ title, description, stage });
    return this.transaction(() => {
      const workspace = this.getWorkspace(ownerId);
      if (!workspace) throw new AppError("WORKSPACE_NOT_FOUND", "Create a workspace before adding tasks.", 404);
      const previous = this.db.prepare(`SELECT payload_json AS payloadJson, task_json AS taskJson
        FROM task_creation_requests WHERE owner_id = ? AND workspace_id = ? AND request_id = ?`)
        .get(ownerId, workspace.id, requestId) as { payloadJson: string; taskJson: string } | undefined;
      if (previous) {
        if (previous.payloadJson !== payloadJson) {
          throw new AppError("TASK_REQUEST_CONFLICT", "This request was already used for a different task. Start a new task.", 409);
        }
        return { task: JSON.parse(previous.taskJson) as Task, created: false };
      }
      if (this.hasStageRequest(ownerId, workspace.id, requestId)) {
        throw new AppError("TASK_REQUEST_CONFLICT", "This request was already used for a different change. Start a new task.", 409);
      }
      if (workspace.tasks.length >= 100) {
        throw new AppError("TASK_LIMIT_REACHED", "This project has reached its limit of 100 tasks.", 409);
      }
      const task: Task = { id: randomUUID(), title, description, stage };
      this.db.prepare("UPDATE workspaces SET tasks_json = ? WHERE owner_id = ? AND id = ?")
        .run(JSON.stringify([...workspace.tasks, task]), ownerId, workspace.id);
      this.db.prepare(`INSERT INTO task_creation_requests (owner_id, workspace_id, request_id, payload_json, task_json)
        VALUES (?, ?, ?, ?, ?)`).run(ownerId, workspace.id, requestId, payloadJson, JSON.stringify(task));
      return { task, created: true };
    });
  }

  private hasStageRequest(ownerId: string, workspaceId: string, requestId: string): boolean {
    return this.db.prepare("SELECT 1 FROM task_stage_requests WHERE owner_id = ? AND workspace_id = ? AND request_id = ?")
      .get(ownerId, workspaceId, requestId) !== undefined;
  }

  // Moves one existing task in place, so board order and task references stay
  // stable. A committed requestId replays its stored result and never re-applies.
  moveTaskStage(ownerId: string, input: MoveTaskInput): MoveTaskResult {
    const { requestId, taskId, fromStage, stage } = moveTaskSchema.parse(input);
    const payloadJson = JSON.stringify({ taskId, fromStage, stage });
    return this.transaction(() => {
      const workspace = this.getWorkspace(ownerId);
      if (!workspace) throw new AppError("WORKSPACE_NOT_FOUND", "Create a workspace before moving tasks.", 404);
      const previous = this.db.prepare(`SELECT payload_json AS payloadJson, result_json AS resultJson
        FROM task_stage_requests WHERE owner_id = ? AND workspace_id = ? AND request_id = ?`)
        .get(ownerId, workspace.id, requestId) as { payloadJson: string; resultJson: string } | undefined;
      if (previous) {
        if (previous.payloadJson !== payloadJson) {
          throw new AppError("TASK_REQUEST_CONFLICT", "This request was already used for a different move. Start a new move.", 409);
        }
        const result = JSON.parse(previous.resultJson) as Omit<MoveTaskResult, "replayed">;
        return { task: result.task, fromStage: result.fromStage, replayed: true };
      }
      const creation = this.db.prepare("SELECT 1 FROM task_creation_requests WHERE owner_id = ? AND workspace_id = ? AND request_id = ?")
        .get(ownerId, workspace.id, requestId);
      if (creation) {
        throw new AppError("TASK_REQUEST_CONFLICT", "This request was already used for a different change. Start a new move.", 409);
      }
      const moves = this.db.prepare("SELECT COUNT(*) AS count FROM task_stage_requests WHERE owner_id = ? AND workspace_id = ?")
        .get(ownerId, workspace.id) as { count: number };
      if (moves.count >= this.maxTaskMoves) {
        throw new AppError("TASK_MOVE_LIMIT_REACHED", `This project has reached its limit of ${this.maxTaskMoves} task moves.`, 409);
      }
      const index = workspace.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw new AppError("TASK_NOT_FOUND", "This task could not be found. Refresh the board and try again.", 404);
      if (workspace.tasks[index].stage !== fromStage) {
        throw new AppError("TASK_STAGE_CHANGED", "This task has moved since you last saw it. Refresh the board and try again.", 409);
      }
      const task: Task = { ...workspace.tasks[index], stage };
      this.db.prepare("UPDATE workspaces SET tasks_json = ? WHERE owner_id = ? AND id = ?")
        .run(JSON.stringify(workspace.tasks.map((item, position) => position === index ? task : item)), ownerId, workspace.id);
      this.db.prepare(`INSERT INTO task_stage_requests (owner_id, workspace_id, request_id, payload_json, result_json)
        VALUES (?, ?, ?, ?, ?)`).run(ownerId, workspace.id, requestId, payloadJson, JSON.stringify({ task, fromStage }));
      return { task, fromStage, replayed: false };
    });
  }

  getRoom(ownerId: string): RoomSession | null {
    return this.db.prepare(`SELECT owner_id AS ownerId, room_name AS roomName,
      participant_identity AS participantIdentity, mode, experience, created_at AS createdAt,
      expires_at AS expiresAt, status FROM room_sessions WHERE owner_id = ?`).get(ownerId) as RoomSession | undefined ?? null;
  }

  acquireRoom(ownerId: string, mode: GuideMode, identities: { roomName: string; participantIdentity: string }, now = Math.floor(Date.now() / 1000), experience: GuideExperience = defaultGuideExperience(mode)): RoomSession {
    guideExperienceSchema.parse(experience);
    return this.transaction(() => {
      this.db.prepare("DELETE FROM room_requests WHERE owner_id = ? AND requested_at < ?").run(ownerId, now - 3600);
      const tokens = this.db.prepare("SELECT COUNT(*) AS count FROM room_requests WHERE owner_id = ? AND kind = 'token' AND requested_at > ?").get(ownerId, now - 60) as { count: number };
      if (tokens.count >= 20) throw new AppError("RATE_LIMITED", "Please wait a minute before starting the guide again.", 429);
      const existing = this.getRoom(ownerId);
      if (existing && existing.status === "ending") throw new AppError("ROOM_ENDING", "The previous guide session is ending. Try End again before restarting.", 409);
      if (existing && existing.expiresAt <= now) throw new AppError("ROOM_EXPIRED", "End the previous guide session before starting a new one.", 409);
      if (existing && existing.mode !== mode) throw new AppError("ROOM_MODE_CHANGED", "End the current guide session before switching guide modes.", 409);
      if (existing && existing.experience !== experience) throw new AppError("ROOM_EXPERIENCE_CHANGED", "End the current guide session before switching experiences.", 409);
      if (existing) {
        this.db.prepare("INSERT INTO room_requests VALUES (?, ?, 'token')").run(ownerId, now);
        return existing;
      }
      const starts = this.db.prepare("SELECT COUNT(*) AS count FROM room_requests WHERE owner_id = ? AND kind = 'new_room'").get(ownerId) as { count: number };
      if (starts.count >= 12) throw new AppError("RATE_LIMITED", "The guide session limit has been reached. Try again later.", 429);
      const session: RoomSession = { ownerId, ...identities, mode, experience, createdAt: now, expiresAt: now + 900, status: "active" };
      this.db.prepare("INSERT INTO room_sessions (owner_id, room_name, participant_identity, mode, created_at, expires_at, status, experience) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)").run(ownerId, session.roomName, session.participantIdentity, mode, now, session.expiresAt, experience);
      this.db.prepare("INSERT INTO room_requests VALUES (?, ?, 'new_room'), (?, ?, 'token')").run(ownerId, now, ownerId, now);
      return session;
    });
  }

  beginEndRoom(ownerId: string, expectedRoomName?: string): RoomSession | null {
    return this.transaction(() => {
      const room = this.getRoom(ownerId);
      if (!room) return null;
      if (expectedRoomName && room.roomName !== expectedRoomName) {
        throw new AppError("ROOM_MISMATCH", "This guide session does not belong to this request.", 409);
      }
      this.db.prepare("UPDATE room_sessions SET status = 'ending' WHERE owner_id = ?").run(ownerId);
      return { ...room, status: "ending" };
    });
  }

  finishEndRoom(ownerId: string, roomName: string): void {
    this.db.prepare("DELETE FROM room_sessions WHERE owner_id = ? AND room_name = ? AND status = 'ending'").run(ownerId, roomName);
  }

  close() { this.db.close(); }
}
