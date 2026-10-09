"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, CheckCircle2, Flag, FolderKanban, Layers3, LoaderCircle, PenLine, ShieldCheck, Users } from "lucide-react";
import { nameSchema, type DemoTab, type Draft, type GuideExperience } from "@/lib/contracts";
import { AppHeader } from "./AppChrome";
import { AvatarGuide, type AvatarGuideHandle, type GuideStep } from "./AvatarGuide";
import { LaunchpadTabs } from "./LaunchpadTabs";
import { ProjectTasks } from "./ProjectTasks";
import { getPreviewTasks } from "@/lib/sample-tasks";

const emptyDraft: Draft = { workspaceName: "", projectName: "", workflow: "client_delivery" };

export function Onboarding({ initialDraft, guideOnly = false }: { initialDraft?: Partial<Draft>; guideOnly?: boolean }) {
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, ...initialDraft });
  const [highlight, setHighlight] = useState<GuideStep>("workspace");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saving, setSaving] = useState(false);
  const [guideUpdate, setGuideUpdate] = useState("");
  const [activeTab, setActiveTab] = useState<DemoTab>("overview");
  const [experience, setExperience] = useState<GuideExperience>("setup");
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const pendingRef = useRef(false);
  const savedRef = useRef(false);
  const draftRef = useRef(draft);
  const guideRef = useRef<AvatarGuideHandle>(null);
  const router = useRouter();
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { document.title = "Set up your workspace | Launchpad"; }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!savedRef.current && (draftRef.current.workspaceName || draftRef.current.projectName)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const updateDraft = useCallback((patch: Partial<Draft>) => {
    if (pendingRef.current || guideOnly) return;
    setDraft(previous => ({ ...previous, ...patch }));
    setGuideUpdate("Your guide updated the draft. Review the details before creating.");
    setFieldErrors({});
  }, [guideOnly]);
  const updateName = (field: "workspaceName" | "projectName", value: string) => {
    setDraft(previous => ({ ...previous, [field]: value }));
    setGuideUpdate("");
    if (nameSchema.safeParse(value).success) {
      setFieldErrors(previous => ({ ...previous, [field]: undefined }));
    }
  };
  const highlightStep = useCallback((step: GuideStep) => {
    setHighlight(step);
    if (experience !== "tour") setActiveTab("overview");
  }, [experience]);
  const openGuide = () => guideRef.current?.open();
  const chooseExperience = async (next: GuideExperience) => {
    if (pendingRef.current || switchingRef.current) return;
    if (next === experience) { openGuide(); return; }
    switchingRef.current = true; setSwitching(true);
    try {
      if (await guideRef.current?.end() !== true) { openGuide(); return; }
      setExperience(next);
      openGuide();
    } finally { switchingRef.current = false; setSwitching(false); }
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current || guideOnly) return;
    const fields: Partial<Record<keyof Draft, string>> = {};
    const workspaceName = nameSchema.safeParse(draft.workspaceName);
    const projectName = nameSchema.safeParse(draft.projectName);
    if (!workspaceName.success) fields.workspaceName = workspaceName.error.issues[0]?.message || "Use between 2 and 80 characters.";
    if (!projectName.success) fields.projectName = projectName.error.issues[0]?.message || "Use between 2 and 80 characters.";
    setFieldErrors(fields);
    if (Object.keys(fields).length) { document.getElementById(fields.workspaceName ? "workspaceName" : "projectName")?.focus(); return; }
    pendingRef.current = true; setSaving(true); setError(""); setHighlight("confirm");
    try {
      const closed = await guideRef.current?.end();
      if (closed !== true) throw new Error("Your guide session could not be closed. Your draft is still here and nothing has been saved. Select End conversation to retry, then create your workspace.");
      const response = await fetch("/api/workspace", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, workspaceName: draft.workspaceName.trim(), projectName: draft.projectName.trim(), confirmed: true }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Your workspace could not be created. Your draft is still here; please try again.");
      savedRef.current = true;
      router.push("/dashboard"); router.refresh();
    } catch (cause) { setError(cause instanceof Error && cause.name === "TimeoutError" ? "Saving took too long. Your draft is still here; try Create again to check or finish the saved workspace." : cause instanceof Error ? cause.message : "Could not create your workspace. Please try again."); pendingRef.current = false; setSaving(false); }
  };

  if (guideOnly) return <AvatarGuide mode="help" />;
  const completed = Number(nameSchema.safeParse(draft.workspaceName).success) + Number(nameSchema.safeParse(draft.projectName).success) + 1;
  return <div className="onboarding-page"><AppHeader onHelp={openGuide} /><main className="onboarding-main">
    <LaunchpadTabs activeTab={activeTab} onTabChange={setActiveTab} workspaceName={draft.workspaceName} projectName={draft.projectName} workflow={draft.workflow} onOpenGuide={openGuide} secondaryContent={<ProjectTasks tasks={getPreviewTasks(draft.workflow)} projectName={draft.projectName || "Your first project"} view="list" preview onReturnToSetup={() => setActiveTab("overview")} />}>
    <div className="setup-layout">
    <form className="draft-card onboarding-draft" onSubmit={create} noValidate aria-labelledby="draft-heading" aria-busy={saving}>
      <div className="draft-heading"><div><h2 id="draft-heading">Workspace details</h2><p>Review your details before creating.</p></div><span className="draft-label"><PenLine size={12} /> Not saved yet</span></div>
      <div className="draft-progress" role="progressbar" aria-label="Setup details filled" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={3}><span style={{ width: `${completed / 3 * 100}%` }} /></div>
      <div className="guide-update" role="status">{guideUpdate || "Edit these details anytime before you create."}</div>
      <fieldset data-guide-target="setup-workspace" className={`form-section ${highlight === "workspace" ? "is-highlighted" : ""}`} disabled={saving}><legend><span className="step-number">01</span> Your workspace</legend><label htmlFor="workspaceName">Business or workspace name</label><input id="workspaceName" name="workspaceName" value={draft.workspaceName} onChange={event => updateName("workspaceName", event.target.value)} onFocus={() => setHighlight("workspace")} placeholder="e.g. Studio North" maxLength={160} autoComplete="organization" aria-invalid={!!fieldErrors.workspaceName} aria-describedby="workspace-hint" /><p id="workspace-hint" className={fieldErrors.workspaceName ? "field-error" : "field-hint"}>{fieldErrors.workspaceName || "You’ll be the workspace Owner. Use a fictional name."}</p></fieldset>
      <fieldset data-guide-target="setup-project" className={`form-section ${highlight === "project" ? "is-highlighted" : ""}`} disabled={saving}><legend><span className="step-number">02</span> Your first project</legend><label htmlFor="projectName">Project name</label><input id="projectName" name="projectName" value={draft.projectName} onChange={event => updateName("projectName", event.target.value)} onFocus={() => setHighlight("project")} placeholder="e.g. Juniper brand refresh" maxLength={160} autoComplete="off" aria-invalid={!!fieldErrors.projectName} aria-describedby="project-hint" /><p id="project-hint" className={fieldErrors.projectName ? "field-error" : "field-hint"}>{fieldErrors.projectName || "Your first project will include sample tasks you can explore."}</p></fieldset>
      <fieldset data-guide-target="setup-workflow" className={`form-section workflow-section ${highlight === "workflow" ? "is-highlighted" : ""}`} disabled={saving}><legend><span className="step-number">03</span> Choose a workflow</legend><p className="workflow-question">Pick a starting point for your project.</p><div className="workflow-options"><label className={`workflow-option ${draft.workflow === "client_delivery" ? "selected" : ""}`}><input type="radio" name="workflow" value="client_delivery" checked={draft.workflow === "client_delivery"} onChange={() => { setDraft(previous => ({ ...previous, workflow: "client_delivery" })); setHighlight("workflow"); }} /><span className="workflow-icon"><FolderKanban size={20} /></span><strong>Client Delivery</strong><span>Creative work and<br />service deliverables.</span><span className="radio-indicator" aria-hidden="true">{draft.workflow === "client_delivery" && <Check size={11} />}</span></label><label className={`workflow-option ${draft.workflow === "campaign" ? "selected" : ""}`}><input type="radio" name="workflow" value="campaign" checked={draft.workflow === "campaign"} onChange={() => { setDraft(previous => ({ ...previous, workflow: "campaign" })); setHighlight("workflow"); }} /><span className="workflow-icon"><Flag size={20} /></span><strong>Campaign</strong><span>Marketing launches<br />and campaign assets.</span><span className="radio-indicator" aria-hidden="true">{draft.workflow === "campaign" && <Check size={11} />}</span></label></div></fieldset>
      <div data-guide-target="setup-roles" className={`roles-note ${highlight === "roles" ? "is-highlighted" : ""}`}><Users size={19} /><div><strong>You start as the Owner</strong><p>Contributors produce work; Reviewers check it. Their responsibilities are explained in People. Invitations aren’t available in this demo.</p></div></div>
      <div data-guide-target="setup-confirm" className={`draft-confirm ${highlight === "confirm" ? "is-highlighted" : ""}`}><div className="creation-summary"><Layers3 size={16} /><span>1 workspace · 1 project · a ready-to-explore board</span></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary create-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}<span>{saving ? "Creating your workspace…" : "Create my workspace"}</span>{!saving && <ArrowRight size={18} />}</button><p><ShieldCheck size={13} /> Nothing is saved until you select Create.</p></div>
    </form><aside className="setup-preview" aria-label="Setup summary"><div className="preview-heading"><span className="page-icon"><Layers3 size={19} /></span><span>Project summary</span></div><h2>{draft.projectName || "Your first project"}</h2><p>{draft.workspaceName || "Your workspace"} <span>·</span> {draft.workflow === "campaign" ? "Campaign" : "Client Delivery"}</p><div className="preview-stages">{["Brief", "Build", "Review", "Handoff"].map((stage, index) => <div key={stage}><span>{index === 3 ? <Check size={12} /> : index + 1}</span><div><strong>{stage}</strong><small>{["Define the work", "Create a first draft", "Refine the details", "Prepare the deliverable"][index]}</small></div>{index < 3 && <span className="preview-connector" />}</div>)}</div><div className="preview-included"><strong>Your workspace includes</strong><span><CheckCircle2 size={14} /> One saved sample project</span><span><CheckCircle2 size={14} /> A four-stage project board</span><span><CheckCircle2 size={14} /> A personal, interactive guide</span></div><div className="setup-help"><p>See the sample tasks before creating.</p><button type="button" className="text-button" onClick={() => setActiveTab("workflow")}>Preview project <ArrowRight size={14} /></button></div></aside></div></LaunchpadTabs></main><AvatarGuide mode="onboarding" experience={experience} onExperienceChange={chooseExperience} switching={switching} draft={draft} sessionRef={guideRef} onDraft={updateDraft} onHighlight={highlightStep} disabled={saving || switching} /></div>;
}

export default Onboarding;
