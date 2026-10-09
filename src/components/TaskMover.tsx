"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowRightLeft, Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { stageSchema, type Stage, type Task } from "@/lib/contracts";
import { moveTaskReceiptSchema, resolveMoveTask, type GuideMoveTask, type MoveTaskError, type MoveTaskReply, type TaskGuideDriver } from "@/lib/task-actions";
import styles from "./TaskMover.module.css";

export type TaskMoverHandle = { move: (request: GuideMoveTask, driver: TaskGuideDriver) => Promise<MoveTaskReply>; openFor: (task: Task) => void; busy: () => boolean };
type MoveDraft = { taskId: string; stage: Stage | "" };
const empty: MoveDraft = { taskId: "", stage: "" };
const stages = stageSchema.options;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// The trigger sits beside New task and the panel below it; `children` places both.
// Like TaskComposer, `locked` disables the trigger while the other task tool is in
// use, and `isLocked` is its synchronous check for guide requests.
export function TaskMover({ tasks, onMoved, moverRef, locked = false, isLocked, children }: {
  tasks: Task[];
  onMoved: (task: Task) => void;
  moverRef?: Ref<TaskMoverHandle>;
  locked?: boolean;
  isLocked?: () => boolean;
  children: (parts: { trigger: ReactNode; panel: ReactNode; active: boolean }) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MoveDraft>(empty);
  const [saving, setSaving] = useState(false);
  const [guided, setGuided] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState("");
  const openRef = useRef(false);
  const savingRef = useRef(false);
  const guidedRef = useRef(false);
  const draftRef = useRef<MoveDraft>(empty);
  const requestIdRef = useRef("");
  const saveRef = useRef<Promise<MoveTaskReply> | null>(null);
  const lastResultRef = useRef<MoveTaskReply | null>(null);
  const mounted = useRef(true);
  const selectRef = useRef<HTMLSelectElement>(null);
  const stagesRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const receiptCache = useRef(new Map<string, { body: string; result: MoveTaskReply }>());
  const publishDraft = (value: MoveDraft) => { draftRef.current = value; setDraft(value); };
  const close = () => { openRef.current = false; setOpen(false); setGuided(false); guidedRef.current = false; };
  const focusStages = () => void frame().then(() => stagesRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const openPanel = (focus: "select" | "stage" | null, taskId = "") => {
    if (openRef.current || savingRef.current || isLocked?.()) return;
    openRef.current = true;
    requestIdRef.current = crypto.randomUUID();
    saveRef.current = null; lastResultRef.current = null;
    publishDraft({ taskId, stage: "" }); setError(""); setUncertain(false); setSuccess(""); setFinished(false); setOpen(true);
    if (focus === "select") void frame().then(() => selectRef.current?.focus());
    if (focus === "stage") focusStages();
  };

  const save = (): Promise<MoveTaskReply> => {
    if (savingRef.current && saveRef.current) return saveRef.current;
    const requestId = requestIdRef.current;
    const failure = (error: "invalid_request" | "save_failed" | "outcome_unknown"): MoveTaskReply => ({ version: 1, requestId, applied: false, error });
    const { taskId, stage } = draftRef.current;
    const task = tasks.find(item => item.id === taskId);
    const problem = !task ? "Choose a task to move." : !stage ? "Choose the stage to move this task to." : task.stage === stage ? `This task is already in ${stage}.` : "";
    if (!task || !stage || problem) {
      setError(problem);
      setFinished(true);
      const result = failure("invalid_request"); lastResultRef.current = result;
      return Promise.resolve(result);
    }
    // fromStage is the stage this browser shows. The server applies the move only
    // if the task is still there, so a stale board can never overwrite a change.
    const sent = { requestId, taskId, fromStage: task.stage, stage };
    savingRef.current = true; setSaving(true); setError(""); setFinished(false);
    const promise = (async (): Promise<MoveTaskReply> => {
      let result: MoveTaskReply;
      try {
        const response = await fetch("/api/tasks/stage", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sent), signal: AbortSignal.timeout(8000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          // A lost/5xx response may follow a commit. Keep the same request ID and
          // fields for a safe retry instead of reporting a move that may not exist.
          const unknown = response.status >= 500 || response.status === 408;
          if (mounted.current) { setUncertain(unknown); setError(unknown ? "The move could not be confirmed. Retry this move safely, or refresh to check your project." : typeof payload?.error === "string" ? payload.error : "The task could not be moved. Try again."); }
          result = failure(unknown ? "outcome_unknown" : "save_failed");
        } else {
          const receipt = moveTaskReceiptSchema.safeParse(payload);
          if (!receipt.success || receipt.data.task.id !== sent.taskId || receipt.data.task.stage !== sent.stage || receipt.data.fromStage !== sent.fromStage) throw new Error("Invalid move receipt");
          const moved = receipt.data.task;
          onMoved(moved);
          result = { version: 1, requestId, applied: true, task: { id: moved.id, title: moved.title, fromStage: receipt.data.fromStage, stage: moved.stage } };
          if (mounted.current) {
            setUncertain(false); setSuccess(`Moved “${moved.title}” from ${receipt.data.fromStage} to ${moved.stage}.`);
            // The trigger re-enables only after this save settles.
            if (!guidedRef.current) { close(); void frame().then(() => triggerRef.current?.focus()); }
          }
        }
      } catch {
        if (mounted.current) { setUncertain(true); setError("The move could not be confirmed. Retry this move safely, or refresh to check your project."); }
        result = failure("outcome_unknown");
      } finally {
        savingRef.current = false;
        if (mounted.current) { setSaving(false); setFinished(true); }
      }
      lastResultRef.current = result;
      return result;
    })();
    saveRef.current = promise;
    return promise;
  };

  const change = (patch: Partial<MoveDraft>) => {
    publishDraft({ ...draftRef.current, ...patch }); setError(""); setFinished(false);
    // Changing a move after a definitive rejection is a new request, never a conflicting retry.
    if (lastResultRef.current && !uncertain) requestIdRef.current = crypto.randomUUID();
    lastResultRef.current = null; saveRef.current = null;
  };

  useImperativeHandle(moverRef, () => ({
    busy: () => guidedRef.current || openRef.current || savingRef.current,
    openFor: task => {
      if (guidedRef.current || savingRef.current || isLocked?.()) return;
      if (!openRef.current) openPanel("stage", task.id);
      else { if (!uncertain) change({ taskId: task.id, stage: "" }); focusStages(); }
    },
    move: async (request, driver) => {
      const failure = (error: Exclude<MoveTaskError, "ambiguous">): MoveTaskReply => ({ version: 1, requestId: request.requestId, applied: false, error });
      const body = JSON.stringify({ title: request.title, fromStage: request.fromStage, stage: request.stage });
      const cached = receiptCache.current.get(request.requestId);
      if (cached) return cached.body === body ? cached.result : failure("invalid_request");
      // Never take over a person's open form, panel, or task details.
      if (guidedRef.current || openRef.current || savingRef.current || isLocked?.() || document.querySelector("dialog[open]")) return failure("busy");
      // Resolve before any click: a missing, ambiguous, or already-placed task
      // changes nothing on screen and sends no request.
      const resolution = resolveMoveTask(tasks, request);
      if (!resolution.ok) return resolution.error === "ambiguous" ? { version: 1, requestId: request.requestId, applied: false, error: "ambiguous", stages: resolution.stages } : failure(resolution.error);
      guidedRef.current = true; setGuided(true);
      let userTookOver = false;
      const takeOver = (event: Event) => { if (event.isTrusted && !savingRef.current) userTookOver = true; };
      document.addEventListener("pointerdown", takeOver, true);
      document.addEventListener("keydown", takeOver, true);
      const cancelled = () => driver.signal.aborted || userTookOver || !mounted.current;
      try {
        if (cancelled()) return failure("interrupted");
        const navigation = await driver.navigate({ version: 1, actionId: request.requestId, kind: "navigate", target: "overview" });
        if (!navigation.applied || cancelled()) return failure(cancelled() ? "interrupted" : "unavailable");
        const opened = await driver.activate("task-move");
        if (!opened.applied || cancelled()) return failure(cancelled() ? "interrupted" : "unavailable");
        requestIdRef.current = request.requestId;
        publishDraft({ taskId: resolution.task.id, stage: "" });
        await frame();
        if (cancelled()) return failure("interrupted");
        const chosen = await driver.activate(`task-move-to-${request.stage.toLowerCase() as Lowercase<Stage>}`);
        if (!chosen.applied || cancelled()) return failure(cancelled() ? "interrupted" : "unavailable");
        const clicked = await driver.activate("task-move-save");
        // Once the real Move handler has sent a request, interruption cannot
        // retract that write. Its durable receipt takes precedence over animation.
        const result = saveRef.current ? await saveRef.current : lastResultRef.current;
        if (result) {
          receiptCache.current.set(request.requestId, { body, result });
          if (receiptCache.current.size > 100) receiptCache.current.delete(receiptCache.current.keys().next().value!);
          if (result.applied && mounted.current) { close(); await frame(); }
          return result;
        }
        return failure(cancelled() || !clicked.applied && clicked.error === "cancelled" ? "interrupted" : "unavailable");
      } finally {
        document.removeEventListener("pointerdown", takeOver, true);
        document.removeEventListener("keydown", takeOver, true);
        guidedRef.current = false;
        if (mounted.current) setGuided(false);
      }
    },
  }));

  const selected = tasks.find(task => task.id === draft.taskId);
  const dismiss = () => { close(); triggerRef.current?.focus(); };
  const trigger = <button ref={triggerRef} type="button" className={`button button-outline ${styles.trigger}`} aria-label="Move task" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} title="Move a task to another stage" data-guide-target="task-move" data-guide-label="Move task" data-guide-active={open ? "true" : "false"} disabled={saving || locked || tasks.length === 0} onClick={event => openPanel(event.isTrusted ? "select" : null)}><ArrowRightLeft size={15} /><span>Move task</span></button>;
  const panel = <>
    {open && <form id={`${id}-panel`} className={`${styles.panel} ${guided ? styles.guided : ""}`} aria-label="Move task" noValidate aria-busy={saving} onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === "Escape" && !saving) { event.stopPropagation(); dismiss(); } }}>
      <div className={styles.title}><h2>{guided ? <><Sparkles size={15} /> Your guide is moving a task</> : <><ArrowRightLeft size={15} /> Move task</>}</h2><button type="button" className="icon-button" aria-label="Close move task" disabled={saving} onClick={dismiss}><X size={16} /></button></div>
      <label htmlFor={`${id}-task`}>Task</label>
      <select ref={selectRef} id={`${id}-task`} value={draft.taskId} disabled={saving || uncertain} aria-describedby={`${id}-current`} onChange={event => { const next = tasks.find(task => task.id === event.target.value); change({ taskId: event.target.value, stage: next?.stage === draftRef.current.stage ? "" : draftRef.current.stage }); }}>
        <option value="" disabled>Choose a task…</option>
        {tasks.map((task, index) => <option key={task.id} value={task.id}>{`LP-${String(index + 1).padStart(2, "0")} · ${task.title}`}</option>)}
      </select>
      <p id={`${id}-current`} className={styles.current}>{selected ? `Currently in ${selected.stage}` : "Choose a task to see its stage."}</p>
      <p id={`${id}-stages`} className={styles.label}>Move to</p>
      <div ref={stagesRef} className={styles.stages} role="group" aria-labelledby={`${id}-stages`}>{stages.map(stage => <button type="button" key={stage} aria-pressed={draft.stage === stage} disabled={saving || uncertain || !selected || selected.stage === stage} data-guide-target={`task-move-to-${stage.toLowerCase()}`} data-guide-label={`Move to ${stage}`} data-guide-active={draft.stage === stage ? "true" : "false"} onClick={() => change({ stage })}>{stage}{selected?.stage === stage && <small>Current</small>}</button>)}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.footer}><span>{guided ? "Requested by you · Moving within this project" : "Its name, details, and reference stay the same"}</span><button type="button" className="button button-outline" disabled={saving} onClick={dismiss}>Cancel</button><button type="button" className="button button-primary" data-guide-target="task-move-save" data-guide-label="Move task" data-guide-active={finished ? "true" : "false"} disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15} /> : <ArrowRightLeft size={15} />}{saving ? "Moving…" : uncertain ? "Retry move" : "Move task"}</button></div>
    </form>}
    {!open && success && <p className={styles.status}><Check size={15} /> <span role="status">{success}</span></p>}
  </>;
  return children({ trigger, panel, active: open || saving || guided });
}
