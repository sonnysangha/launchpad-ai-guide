"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw } from "lucide-react";
import type { DemoTab, GuideExperience, Workspace } from "@/lib/contracts";
import { AppHeader } from "./AppChrome";
import { AvatarGuide, type AvatarGuideHandle } from "./AvatarGuide";
import { LaunchpadTabs } from "./LaunchpadTabs";
import { ProjectTasks } from "./ProjectTasks";
import { TaskComposer, type TaskComposerHandle } from "./TaskComposer";
import { TaskMover, type TaskMoverHandle } from "./TaskMover";

export function Dashboard({ workspace }: { workspace: Workspace }) {
  useEffect(() => { document.title = `${workspace.projectName} | Launchpad`; }, [workspace.projectName]);
  const [activeTab, setActiveTab] = useState<DemoTab>("overview");
  const [tasks, setTasks] = useState(workspace.tasks);
  const [focusTask, setFocusTask] = useState<{ id: string; token: number } | null>(null);
  const [composerActive, setComposerActive] = useState(false);
  const composerRef = useRef<TaskComposerHandle>(null);
  const moverRef = useRef<TaskMoverHandle>(null);
  const revealTask = (id: string) => setFocusTask(previous => ({ id, token: (previous?.token ?? 0) + 1 }));
  const [experience, setExperience] = useState<GuideExperience>("qa");
  const [switching, setSwitching] = useState(false);
  const [resetText, setResetText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const guideRef = useRef<AvatarGuideHandle>(null);
  const resettingRef = useRef(false);
  const switchingRef = useRef(false);
  const router = useRouter();
  const openHelp = () => guideRef.current?.open();
  const chooseExperience = async (next: GuideExperience) => {
    if (resettingRef.current || switchingRef.current) return;
    if (next === experience) { openHelp(); return; }
    switchingRef.current = true; setSwitching(true);
    try {
      if (await guideRef.current?.end() !== true) { openHelp(); return; }
      setExperience(next);
      openHelp();
    } finally { switchingRef.current = false; setSwitching(false); }
  };
  const resetWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resettingRef.current || resetText !== "RESET") return;
    resettingRef.current = true; setResetting(true); setResetError("");
    try {
      if (await guideRef.current?.end() !== true) throw new Error("Your guide session could not be closed. Select End conversation to retry before resetting your workspace.");
      const response = await fetch("/api/reset", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: resetText }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "The workspace could not be reset. Please try again.");
      router.replace("/onboarding"); router.refresh();
    } catch (cause) {
      setResetError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "The reset did not finish in time. Refresh to check your workspace before trying again.");
      resettingRef.current = false; setResetting(false);
    }
  };
  return <div className="dashboard-page"><AppHeader onHelp={openHelp} workspaceName={workspace.workspaceName} /><main className="dashboard-main">
    <LaunchpadTabs activeTab={activeTab} onTabChange={setActiveTab} workspaceName={workspace.workspaceName} projectName={workspace.projectName} workflow={workspace.workflow} taskCount={tasks.length} onOpenGuide={openHelp} saved>
      <TaskMover moverRef={moverRef} tasks={tasks} locked={composerActive} isLocked={() => composerRef.current?.busy() === true} onMoved={task => { setTasks(previous => previous.map(item => item.id === task.id ? task : item)); revealTask(task.id); }}>
        {mover => <TaskComposer composerRef={composerRef} actions={mover.trigger} locked={mover.active} isLocked={() => moverRef.current?.busy() === true} onActiveChange={setComposerActive} onCreated={task => { setTasks(previous => previous.some(item => item.id === task.id) ? previous : [...previous, task]); revealTask(task.id); }}>{mover.panel}</TaskComposer>}
      </TaskMover>
      <ProjectTasks tasks={tasks} focusTask={focusTask} projectName={workspace.projectName} view={activeTab === "workflow" ? "list" : "board"} onMoveTask={task => moverRef.current?.openFor(task)} moveDisabled={composerActive} />
    <details className="reset-panel"><summary><RotateCcw size={14} /> Reset demo workspace</summary><form onSubmit={resetWorkspace} noValidate aria-busy={resetting}><h2>Start this demo again</h2><p>This removes your workspace, project, and sample tasks, and ends your avatar session. Your account stays signed in. Other users’ workspaces are untouched.</p><label htmlFor="reset-confirmation">Type RESET to confirm</label><div className="reset-controls"><input id="reset-confirmation" value={resetText} onChange={event => setResetText(event.target.value)} autoComplete="off" spellCheck={false} disabled={resetting} aria-describedby="reset-hint" /><button className="button button-danger" type="submit" disabled={resetText !== "RESET" || resetting}>{resetting ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}{resetting ? "Resetting workspace…" : "Reset my demo workspace"}</button></div><p id="reset-hint" className="reset-hint">This cannot be undone. Available in the local demo only.</p>{resetError && <p className="form-error" role="alert">{resetError}</p>}</form></details>
    </LaunchpadTabs>
    </main><AvatarGuide mode="help" experience={experience} onExperienceChange={chooseExperience} switching={switching} sessionRef={guideRef} disabled={resetting || switching} onCreateTask={(request, driver) => {
      if (resettingRef.current || switchingRef.current || !composerRef.current) return Promise.resolve({ version: 1, requestId: request.requestId, applied: false, error: "unavailable" });
      return composerRef.current.create(request, driver);
    }} onMoveTask={(request, driver) => {
      if (resettingRef.current || switchingRef.current || !moverRef.current) return Promise.resolve({ version: 1, requestId: request.requestId, applied: false, error: "unavailable" });
      return moverRef.current.move(request, driver);
    }} /></div>;
}

export default Dashboard;
