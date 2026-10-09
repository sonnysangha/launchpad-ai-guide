"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRightLeft, BookOpen, Check, Circle, Search, ShieldCheck, X } from "lucide-react";
import type { Stage, Task } from "@/lib/contracts";
import styles from "./ProjectTasks.module.css";

const stages: Stage[] = ["Brief", "Build", "Review", "Handoff"];

// focusTask gets a new token after every create or move, so the same task can be revealed again.
export function ProjectTasks({ tasks, projectName, view, preview = false, onReturnToSetup, focusTask, onMoveTask, moveDisabled = false }: {
  tasks: Task[];
  focusTask?: { id: string; token: number } | null;
  onMoveTask?: (task: Task) => void;
  moveDisabled?: boolean;
  projectName: string;
  view: "board" | "list";
  preview?: boolean;
  onReturnToSetup?: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<Stage | "All stages">("All stages");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const detailRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selectedTask) detailRef.current?.showModal(); }, [selectedTask]);
  useEffect(() => {
    if (!focusTask) return;
    setQuery(""); setStageFilter("All stages");
    const timer = window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(focusTask.id)}"]`);
      element?.scrollIntoView({ block: "nearest", behavior: "instant" });
      // A list row stays mounted across a move; restart its highlight animation.
      if (element) { element.style.animation = "none"; void element.offsetWidth; element.style.animation = ""; }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusTask]);
  const filteredTasks = tasks.filter(task => (stageFilter === "All stages" || task.stage === stageFilter) && `${task.title} ${task.description || ""} ${task.tag || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const taskReference = (task: Task) => `${preview ? "PREVIEW" : "LP"}-${String(tasks.findIndex(item => item.id === task.id) + 1).padStart(2, "0")}`;
  const closeDetail = () => { detailRef.current?.close(); setSelectedTask(null); };
  const moveSelected = (task: Task) => { closeDetail(); onMoveTask?.(task); };
  const clearFilters = () => { setQuery(""); setStageFilter("All stages"); searchRef.current?.focus(); };

  return <div className={styles.taskWorkspace}>
    {preview && <div className={styles.previewNotice}><div><span className={styles.previewBadge}>Not saved</span><p>These sample tasks will be added when you create your workspace.</p></div>{onReturnToSetup && <button type="button" className="button button-outline" onClick={onReturnToSetup}>Back to setup</button>}</div>}
    <div className={styles.toolbar}><div className={styles.taskCount}><strong>{filteredTasks.length}</strong> {filteredTasks.length === 1 ? "task" : "tasks"}{query || stageFilter !== "All stages" ? <span>of {tasks.length}</span> : null}</div><div className={styles.controls}><div className="search-field"><Search size={15} /><input ref={searchRef} aria-label="Search tasks" type="search" placeholder="Search tasks…" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" aria-label="Clear task search" data-guide-target="task-search-clear" data-guide-label="Clear task search" data-guide-active={query ? "false" : "true"} disabled={!query} onClick={event => { setQuery(""); if (event.isTrusted) searchRef.current?.focus(); }}><X size={14} /></button></div>{view === "board" && <select className={styles.stageSelect} aria-label="Filter tasks by stage" value={stageFilter} onChange={event => setStageFilter(event.target.value as Stage | "All stages")}><option>All stages</option>{stages.map(stage => <option key={stage}>{stage}</option>)}</select>}</div></div>

    {view === "list" && <div className={styles.stageFilters} role="group" aria-label="Filter tasks by stage"><button type="button" aria-pressed={stageFilter === "All stages"} onClick={() => setStageFilter("All stages")}>All tasks <span>{tasks.length}</span></button>{stages.map(stage => <button type="button" key={stage} aria-pressed={stageFilter === stage} data-guide-target={`stage-${stage.toLowerCase()}`} data-guide-label={stage} data-guide-active={stageFilter === stage ? "true" : "false"} onClick={() => setStageFilter(stage)}><span className={`${styles.stageDot} ${styles[stage.toLowerCase()]}`} />{stage}<span>{tasks.filter(task => task.stage === stage).length}</span></button>)}</div>}

    {view === "board" ? <section className="project-board" aria-label="Project tasks by stage">{stages.filter(stage => stageFilter === "All stages" || stage === stageFilter).map(stage => { const stageTasks = filteredTasks.filter(task => task.stage === stage); return <section key={stage} className={`board-column board-column-${stage.toLowerCase()}`} aria-labelledby={`${id}-stage-${stage}`}><header className="column-heading"><div><span className="stage-symbol">{stage === "Handoff" ? <Check size={11} /> : <Circle size={10} />}</span><h2 id={`${id}-stage-${stage}`}>{stage}</h2><span className="stage-count">{stageTasks.length}</span></div></header><div className={styles.boardTasks}>{stageTasks.map(task => <button type="button" className="task-card" data-task-id={task.id} data-new-task={task.id === focusTask?.id ? "true" : undefined} key={task.id} onClick={() => setSelectedTask(task)} aria-label={`Open task: ${task.title}`}><span className="task-card-top"><span className={`task-tag tag-${stage.toLowerCase()}`}>{task.tag || stage}</span><span className="task-number">{taskReference(task)}</span></span><strong className="task-title">{task.title}</strong>{task.description && <span className="task-description">{task.description}</span>}<span className="task-footer"><span className="sample-task"><Circle size={10} /> {task.tag ? "Sample task" : "Task"}</span><span className={styles.inspectLabel}>View details</span></span></button>)}{stageTasks.length === 0 && <div className="empty-stage"><Circle size={18} /><p>{query ? "No matching tasks" : `No tasks in ${stage.toLowerCase()}`}</p></div>}</div></section>; })}</section> : <div className={styles.listFrame}><table className={styles.taskTable}><caption className="sr-only">{preview ? "Unsaved sample task preview" : "Project task list"}</caption><thead><tr><th scope="col">Task name</th><th scope="col">Stage</th><th scope="col">Label</th><th scope="col" className={styles.referenceColumn}>Reference</th></tr></thead><tbody>{filteredTasks.map(task => <tr key={task.id} data-task-id={task.id} data-new-task={task.id === focusTask?.id ? "true" : undefined}><td><button type="button" className={styles.taskNameButton} aria-label={`Open task: ${task.title}`} onClick={() => setSelectedTask(task)}><Circle size={13} /><span><strong>{task.title}</strong>{task.description && <small>{task.description}</small>}</span></button></td><td><span className={styles.stageValue}><span className={`${styles.stageDot} ${styles[task.stage.toLowerCase()]}`} />{task.stage}</span></td><td><span className={`task-tag tag-${task.stage.toLowerCase()}`}>{task.tag || task.stage}</span></td><td className={styles.referenceColumn}><span className={styles.taskReference}>{taskReference(task)}</span></td></tr>)}</tbody></table>{filteredTasks.length === 0 && <div className={styles.noResults} role="status"><Search size={20} /><h2>No matching tasks</h2><p>Try another search or stage.</p><button type="button" className="text-button" onClick={clearFilters}>Clear search and filter</button></div>}</div>}
    {view === "board" && filteredTasks.length === 0 && (query || stageFilter !== "All stages") && <div className="board-no-results" role="status"><p>No tasks match your search and filter.</p><button type="button" className="text-button" onClick={clearFilters}>Clear search and filter</button></div>}
    <p className={styles.scopeNote}><BookOpen size={13} />{preview ? "Unsaved preview · Switch back to Setup to review and create." : "Your tasks are saved automatically when added or moved. Ask the guide to create or move one for you."}</p>

    <dialog className="task-dialog" ref={detailRef} aria-labelledby={`${id}-task-detail-title`} onCancel={() => setSelectedTask(null)} onClose={() => setSelectedTask(null)}>{selectedTask && <><div className="task-dialog-top"><span>{taskReference(selectedTask)} <span>/</span> {preview ? "Unsaved preview" : "Task details"}</span><button type="button" className="icon-button" onClick={closeDetail} aria-label="Close task details"><X size={18} /></button></div><div className="task-dialog-body"><span className={`task-tag tag-${selectedTask.stage.toLowerCase()}`}>{selectedTask.tag || selectedTask.stage}</span><h2 id={`${id}-task-detail-title`}>{selectedTask.title}</h2><dl><div><dt>Stage</dt><dd><Circle size={12} />{selectedTask.stage}</dd></div><div><dt>Project</dt><dd>{projectName}</dd></div><div><dt>Status</dt><dd>{preview ? "Unsaved sample preview" : "Saved task"}</dd></div></dl><h3>Description</h3><p>{selectedTask.description || (selectedTask.tag ? "An example task for this project’s workflow." : "No description added.")}</p><div className="task-detail-note"><ShieldCheck size={16} /><p>{preview ? "Nothing has been saved. Review the setup form and select Create to save your workspace and sample project." : "This task is saved in your private project. You can move it to another stage yourself or ask the guide. Renaming, editing, deleting, assigning, and reordering tasks aren’t supported."}</p></div></div><div className="task-dialog-footer"><button type="button" className="button button-outline" onClick={closeDetail}>Back to {preview ? "preview" : view}</button>{!preview && onMoveTask && <button type="button" className="button button-outline" disabled={moveDisabled} onClick={() => moveSelected(selectedTask)}><ArrowRightLeft size={15} /> Move to another stage</button>}</div></>}</dialog>
  </div>;
}
