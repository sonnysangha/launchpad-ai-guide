// Test-only entry point: bundles the actual UI and controller without auth,
// a Next server, a LiveKit room, or any product debug hooks.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LaunchpadTabs } from "../../src/components/LaunchpadTabs";
import { ProjectTasks } from "../../src/components/ProjectTasks";
import { getPreviewTasks } from "../../src/lib/sample-tasks";
import { GuideActionOverlay, useGuideActions } from "../../src/components/GuideActions";
import { AvatarGuide } from "../../src/components/AvatarGuide";
import { TaskComposer, type TaskComposerHandle } from "../../src/components/TaskComposer";
import { TaskMover, type TaskMoverHandle } from "../../src/components/TaskMover";
import type { DemoTab, GuideExperience, Task } from "../../src/lib/contracts";
import type { GuideActionResult } from "../../src/lib/guide-actions";
import type { CreateTaskResult, GuideMoveTask, MoveTaskReply } from "../../src/lib/task-actions";
import "../../src/app/globals.css";

const tasks = getPreviewTasks("client_delivery");
// Saved tasks carry server-style UUIDs; a move never accepts a preview ID.
const savedTasks: Task[] = tasks.map((task, index) => ({ ...task, id: `5d8f2a6e-3c1b-4f7a-9e2d-00000000000${index + 1}` }));
const similarTasks: Task[] = [
  { id: "5d8f2a6e-3c1b-4f7a-9e2d-000000000007", title: "Design Home-page!", stage: "Review", description: "" },
  { id: "5d8f2a6e-3c1b-4f7a-9e2d-000000000008", title: "design homepage", stage: "Brief", description: "" },
];
const defaultMove: GuideMoveTask = { version: 1, requestId: "3f0d7b52-8a51-4c3e-b7c4-2f4f1c9e8a10", title: "Gather brand references", fromStage: null, stage: "Review" };

function Fixture() {
  const saved = document.getElementById("fixture-root")?.dataset.saved === "true";
  const [activeTab, setActiveTab] = useState<DemoTab>("handbook");
  const [result, setResult] = useState<GuideActionResult | null>(null);
  const [clicks, setClicks] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const count = useRef(0);
  const modalRef = useRef<HTMLDialogElement>(null);
  const { perform, visual } = useGuideActions();
  useEffect(() => {
    const record = (event: MouseEvent) => {
      if (event.isTrusted || !(event.target instanceof Element)) return;
      const marker = event.target.closest<HTMLElement>("button[data-guide-target]")?.dataset.guideTarget;
      if (marker) setClicks(previous => [...previous, marker]);
    };
    document.addEventListener("click", record, true);
    return () => document.removeEventListener("click", record, true);
  }, []);
  useEffect(() => { if (visual) setLabels(previous => previous.includes(visual.label) ? previous : [...previous, visual.label]); }, [visual]);
  const demonstrate = async () => {
    setResult(null); setClicks([]); setLabels([]);
    setResult(await perform({ version: 1, actionId: `fixture-${++count.current}`, kind: "stage", target: "review" }));
  };
  const taskView = <ProjectTasks tasks={tasks} projectName="Atlas project" view={activeTab === "workflow" ? "list" : "board"} />;
  return <>
    <div style={{ display: "flex", gap: 12, alignItems: "center", minHeight: 64, padding: "10px 20px", borderBottom: "1px solid #ddd" }}>
      <button type="button" className="button button-outline" onClick={() => void demonstrate()}>Demonstrate Review</button>
      <button type="button" className="button button-outline" onClick={() => modalRef.current?.showModal()}>Open modal</button>
      <output data-testid="action-result">{JSON.stringify(result)}</output>
      <output data-testid="action-clicks" hidden>{JSON.stringify(clicks)}</output>
      <output data-testid="action-labels" hidden>{JSON.stringify(labels)}</output>
    </div>
    <dialog ref={modalRef} aria-label="Modal interaction fixture" style={{ margin: "auto", padding: 24 }}>
      <button type="button" className="button button-outline" onClick={() => void demonstrate()}>Demonstrate Review behind dialog</button>
      <button type="button" className="button button-outline" onClick={() => modalRef.current?.close()}>Close modal</button>
    </dialog>
    <LaunchpadTabs activeTab={activeTab} onTabChange={setActiveTab} saved={saved} workspaceName="Fixture workspace" projectName="Atlas project" onOpenGuide={() => undefined}
      secondaryContent={<ProjectTasks tasks={tasks} projectName="Atlas project" view="list" preview onReturnToSetup={() => setActiveTab("overview")} />}>
      {saved ? taskView : <p>Unsaved setup form</p>}
    </LaunchpadTabs>
    <GuideActionOverlay visual={visual} />
  </>;
}

function WidgetFixture() {
  const [experience, setExperience] = useState<GuideExperience>("setup");
  return <><main style={{ height: 1600, padding: 24 }}>Scrollable widget geometry fixture</main><AvatarGuide experience={experience} onExperienceChange={setExperience} /></>;
}

function TaskFixture() {
  const root = document.getElementById("fixture-root")!;
  const [activeTab, setActiveTab] = useState<DemoTab>("handbook");
  const [projectTasks, setProjectTasks] = useState<Task[]>(() => root.dataset.similar === "true" ? [...savedTasks, ...similarTasks] : savedTasks);
  const [result, setResult] = useState<CreateTaskResult | null>(null);
  const [moveResult, setMoveResult] = useState<MoveTaskReply | null>(null);
  const [clicks, setClicks] = useState<string[]>([]);
  const [focusTask, setFocusTask] = useState<{ id: string; token: number } | null>(null);
  const [composerActive, setComposerActive] = useState(false);
  const composerRef = useRef<TaskComposerHandle>(null);
  const moverRef = useRef<TaskMoverHandle>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const moveControllerRef = useRef<AbortController | null>(null);
  const reveal = (id: string) => setFocusTask(previous => ({ id, token: (previous?.token ?? 0) + 1 }));
  const { perform, activateTaskControl, cancel, visual } = useGuideActions();
  useEffect(() => {
    const record = (event: MouseEvent) => {
      if (event.isTrusted || !(event.target instanceof Element)) return;
      const marker = event.target.closest<HTMLElement>("button[data-guide-target]")?.dataset.guideTarget;
      if (marker) setClicks(previous => [...previous, marker]);
    };
    document.addEventListener("click", record, true);
    return () => document.removeEventListener("click", record, true);
  }, []);
  const create = async () => {
    setResult(null); setClicks([]);
    const controller = new AbortController(); controllerRef.current = controller;
    const result = await composerRef.current?.create({ version: 1, requestId: "69949b99-57e8-4010-83ec-77a9ff6e80e1", title: "Design homepage", stage: "Build", description: "Create homepage" }, { navigate: perform, activate: activateTaskControl, signal: controller.signal });
    if (result) setResult(result);
  };
  const move = async () => {
    setMoveResult(null); setClicks([]);
    const controller = new AbortController(); moveControllerRef.current = controller;
    // A test may replace the default request through data-move-request before clicking.
    const request = { ...defaultMove, ...JSON.parse(root.dataset.moveRequest || "{}") } as GuideMoveTask;
    const result = await moverRef.current?.move(request, { navigate: perform, activate: activateTaskControl, signal: controller.signal });
    if (result) setMoveResult(result);
  };
  return <>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 12 }}>
      <button type="button" className="button button-outline" onClick={() => void create()}>Create via guide</button>
      <button type="button" className="button button-outline" onClick={() => { controllerRef.current?.abort(); cancel(); }}>Interrupt creation</button>
      <button type="button" className="button button-outline" onClick={() => void move()}>Move via guide</button>
      <button type="button" className="button button-outline" onClick={() => { moveControllerRef.current?.abort(); cancel(); }}>Interrupt move</button>
      <output data-testid="task-result" hidden>{JSON.stringify(result)}</output>
      <output data-testid="move-result" hidden>{JSON.stringify(moveResult)}</output>
      <output data-testid="task-clicks" hidden>{JSON.stringify(clicks)}</output>
    </div>
    <LaunchpadTabs activeTab={activeTab} onTabChange={setActiveTab} saved workspaceName="Fixture workspace" projectName="Atlas project" taskCount={projectTasks.length} onOpenGuide={() => undefined}>
      <TaskMover moverRef={moverRef} tasks={projectTasks} locked={composerActive} isLocked={() => composerRef.current?.busy() === true} onMoved={task => { setProjectTasks(previous => previous.map(item => item.id === task.id ? task : item)); reveal(task.id); }}>
        {mover => <TaskComposer composerRef={composerRef} actions={mover.trigger} locked={mover.active} isLocked={() => moverRef.current?.busy() === true} onActiveChange={setComposerActive} onCreated={task => { setProjectTasks(previous => [...previous.filter(item => item.id !== task.id), task]); reveal(task.id); }}>{mover.panel}</TaskComposer>}
      </TaskMover>
      <ProjectTasks tasks={projectTasks} focusTask={focusTask} projectName="Atlas project" view={activeTab === "workflow" ? "list" : "board"} onMoveTask={task => moverRef.current?.openFor(task)} moveDisabled={composerActive} />
    </LaunchpadTabs>
    <GuideActionOverlay visual={visual} />
  </>;
}

const fixtureRoot = document.getElementById("fixture-root")!;
createRoot(fixtureRoot).render(fixtureRoot.dataset.taskCreate === "true" ? <TaskFixture /> : fixtureRoot.dataset.widget === "true" ? <WidgetFixture /> : <Fixture />);
