"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Check, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import { taskInputSchema, type Task, type TaskInput } from "@/lib/contracts";
import { savedTaskSchema, type CreateTaskResult, type GuideCreateTask, type TaskGuideDriver } from "@/lib/task-actions";
import styles from "./TaskComposer.module.css";

export type TaskComposerHandle = { create: (request: GuideCreateTask, driver: TaskGuideDriver) => Promise<CreateTaskResult>; busy: () => boolean };
const empty: TaskInput = { title: "", description: "", stage: "Brief" };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// Creating and moving are mutually exclusive: `locked` disables New task while the
// other task tool is in use, and `isLocked` is its synchronous check for guide requests.
export function TaskComposer({ onCreated, composerRef, actions, children, locked = false, isLocked, onActiveChange }: {
  onCreated: (task: Task) => void;
  composerRef?: Ref<TaskComposerHandle>;
  actions?: ReactNode;
  children?: ReactNode;
  locked?: boolean;
  isLocked?: () => boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TaskInput>(empty);
  const [saving, setSaving] = useState(false);
  const [guided, setGuided] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState("");
  const openRef = useRef(false);
  const savingRef = useRef(false);
  const guidedRef = useRef(false);
  const draftRef = useRef<TaskInput>(empty);
  const requestIdRef = useRef("");
  const saveRef = useRef<Promise<CreateTaskResult> | null>(null);
  const lastResultRef = useRef<CreateTaskResult | null>(null);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const receiptCache = useRef(new Map<string, { body: string; result: CreateTaskResult }>());
  const publishDraft = (value: TaskInput) => { draftRef.current = value; setDraft(value); };
  const close = () => { openRef.current = false; setOpen(false); setGuided(false); guidedRef.current = false; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onActiveChange?.(open || saving || guided); }, [open, saving, guided, onActiveChange]);

  const openForm = (manual: boolean) => {
    if (openRef.current || savingRef.current || isLocked?.()) return;
    openRef.current = true;
    requestIdRef.current = crypto.randomUUID();
    saveRef.current = null; lastResultRef.current = null;
    publishDraft(empty); setError(""); setUncertain(false); setSuccess(""); setFinished(false); setOpen(true);
    if (manual) void frame().then(() => titleRef.current?.focus());
  };

  const save = (): Promise<CreateTaskResult> => {
    if (savingRef.current && saveRef.current) return saveRef.current;
    const requestId = requestIdRef.current;
    const failure = (error: "invalid_request" | "save_failed" | "outcome_unknown"): CreateTaskResult => ({ version: 1, requestId, applied: false, error });
    const parsed = taskInputSchema.safeParse(draftRef.current);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Check the task details.");
      setFinished(true);
      const result = failure("invalid_request"); lastResultRef.current = result;
      return Promise.resolve(result);
    }
    savingRef.current = true; setSaving(true); setError(""); setFinished(false);
    const promise = (async (): Promise<CreateTaskResult> => {
      let result: CreateTaskResult;
      try {
        const response = await fetch("/api/tasks", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...parsed.data, requestId }), signal: AbortSignal.timeout(8000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          // A lost/5xx response may follow a commit. Keep the same request ID and
          // fields for a safe retry instead of silently creating another task.
          const unknown = response.status >= 500 || response.status === 408;
          if (mounted.current) { setUncertain(unknown); setError(unknown ? "The save could not be confirmed. Retry this task safely, or refresh to check your project." : typeof payload?.error === "string" ? payload.error : "The task could not be saved. Try again."); }
          result = failure(unknown ? "outcome_unknown" : "save_failed");
        } else {
          const task = savedTaskSchema.safeParse(payload?.task);
          if (!task.success || task.data.title !== parsed.data.title || task.data.stage !== parsed.data.stage || task.data.description !== parsed.data.description) throw new Error("Invalid save receipt");
          onCreated(task.data);
          result = { version: 1, requestId, applied: true, task: { id: task.data.id, title: task.data.title, stage: task.data.stage } };
          if (mounted.current) {
            setUncertain(false); setSuccess(`Added “${task.data.title}” to ${task.data.stage}.`);
            if (!guidedRef.current) { close(); newButtonRef.current?.focus(); }
          }
        }
      } catch {
        if (mounted.current) { setUncertain(true); setError("The save could not be confirmed. Retry this task safely, or refresh to check your project."); }
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

  useImperativeHandle(composerRef, () => ({
    busy: () => guidedRef.current || openRef.current || savingRef.current,
    create: async (request, driver) => {
      const failure = (error: "busy" | "interrupted" | "unavailable" | "invalid_request"): CreateTaskResult => ({ version: 1, requestId: request.requestId, applied: false, error });
      const body = JSON.stringify({ title: request.title, description: request.description, stage: request.stage });
      const cached = receiptCache.current.get(request.requestId);
      if (cached) return cached.body === body ? cached.result : failure("invalid_request");
      if (guidedRef.current || openRef.current || savingRef.current || isLocked?.()) return failure("busy");
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
        const opened = await driver.activate("task-new");
        if (!opened.applied || cancelled()) return failure(cancelled() ? "interrupted" : "unavailable");
        requestIdRef.current = request.requestId;
        publishDraft({ title: request.title, description: request.description, stage: request.stage });
        await frame();
        if (cancelled()) return failure("interrupted");
        const clicked = await driver.activate("task-save");
        // Once the real Save handler has sent a request, interruption cannot
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

  const change = (patch: Partial<TaskInput>) => {
    publishDraft({ ...draftRef.current, ...patch }); setError(""); setFinished(false);
    // Editing after a definitive rejection is a new request, never a conflicting retry.
    if (lastResultRef.current && !uncertain) requestIdRef.current = crypto.randomUUID();
    lastResultRef.current = null; saveRef.current = null;
  };

  return <div className={styles.composer}>
    <div className={styles.heading}><p>{success ? <><Check size={15} /> <span role="status">{success}</span></> : <><Sparkles size={15} /> <span>Add a task yourself, or ask your guide.</span></>}</p>{actions}<button ref={newButtonRef} type="button" className="button button-primary" data-guide-target="task-new" data-guide-label="New task" data-guide-active={open ? "true" : "false"} disabled={saving || locked} onClick={event => openForm(event.isTrusted)}><Plus size={16} /> New task</button></div>
    {open && <form className={`${styles.form} ${guided ? styles.guided : ""}`} aria-label="New task" noValidate aria-busy={saving} onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === "Escape" && !saving) { event.stopPropagation(); close(); newButtonRef.current?.focus(); } }}>
      <div className={styles.formTitle}><h2>{guided ? <><Sparkles size={15} /> Your guide is adding a task</> : "New task"}</h2><button type="button" className="icon-button" aria-label="Close new task" disabled={saving} onClick={() => { close(); newButtonRef.current?.focus(); }}><X size={16} /></button></div>
      <div className={styles.fields}><div className={styles.name}><label htmlFor={`${id}-title`}>Task name</label><input ref={titleRef} id={`${id}-title`} value={draft.title} disabled={saving || uncertain} onChange={event => change({ title: event.target.value })} placeholder="What needs to be done?" aria-describedby={error ? `${id}-error` : undefined} /></div><div><label htmlFor={`${id}-stage`}>Stage</label><select id={`${id}-stage`} value={draft.stage} disabled={saving || uncertain} onChange={event => change({ stage: event.target.value as TaskInput["stage"] })}>{["Brief", "Build", "Review", "Handoff"].map(stage => <option key={stage}>{stage}</option>)}</select></div></div>
      <label htmlFor={`${id}-description`}>Description</label><textarea id={`${id}-description`} value={draft.description} disabled={saving || uncertain} rows={2} onChange={event => change({ description: event.target.value })} placeholder="Optional — add a little context…" />
      {error && <p className="form-error" id={`${id}-error`} role="alert">{error}</p>}
      <div className={styles.footer}><span>{guided ? "Requested by you · Adding to this project" : "Only your account can access this task"}</span><button type="button" className="button button-outline" disabled={saving} onClick={() => { close(); newButtonRef.current?.focus(); }}>Cancel</button><button type="button" className="button button-primary" data-guide-target="task-save" data-guide-label="Add task" data-guide-active={finished ? "true" : "false"} disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{saving ? "Adding…" : uncertain ? "Retry save" : "Add task"}</button></div>
    </form>}
    {children}
  </div>;
}
