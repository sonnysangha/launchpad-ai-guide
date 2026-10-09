"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, ChevronDown, CircleHelp, Eye, Flag, FolderKanban, LayoutGrid, List, LockKeyhole, MessageCircle, Search, Settings2, ShieldCheck, Users, X } from "lucide-react";
import type { DemoTab, Workflow } from "@/lib/contracts";
import styles from "./LaunchpadTabs.module.css";

const roles = [
  { id: "owner", name: "Owner", description: "You own this workspace and its sample project. Only your signed-in account can access the saved data. You confirm setup and can reset your own demo workspace.", status: "Your current access" },
  { id: "contributor", name: "Contributor", description: "A Contributor would produce the project work. This is a conceptual role in the demo; no Contributor accounts can be added and selecting this explanation changes no permissions.", status: "Conceptual role · No members" },
  { id: "reviewer", name: "Reviewer", description: "A Reviewer would check the work before handoff. This is a conceptual role in the demo; it does not grant another person access or add a reviewer to your project.", status: "Conceptual role · No members" },
] as const;

const handbook = [
  { id: "handoff", title: "What happens at handoff?", answer: "Handoff is the final preparation stage of your sample project. A task here does not send a file, email a client, publish work, or charge anyone. You can add a task or move one to another stage yourself, or ask the guide. Renaming, editing, deleting, and sending tasks are not supported in this demo.", source: "Follow the project board", version: "1.2.0" },
  { id: "create", title: "What gets saved when I create a workspace?", answer: "Your workspace name, first project, selected workflow, and fictional sample tasks are saved for your signed-in account. You press Create in the browser to save initial setup. Once your project exists, an explicit request to add a task lets the guide save that new task for you.", source: "Create your first project", version: "1.1.0" },
  { id: "workflow", title: "How is Campaign different from Client Delivery?", answer: "Client Delivery models a creative or service deliverable. Campaign models a marketing launch. Both use Brief, Build, Review, and Handoff, with different example tasks.", source: "Choose a workflow", version: "1.0.0" },
  { id: "guide", title: "Can the guide edit my saved project?", answer: "Yes—ask the guide to add a task with a name and optionally a description or stage, or to move an existing task to another stage. It uses the visible New task form or Move task panel and saves to your private project. It cannot rename, edit, delete, assign, or reorder tasks. During onboarding, setup changes stay unsaved until you press Create.", source: "Follow the project board", version: "1.2.0" },
  { id: "roles", title: "Can I invite a teammate or client?", answer: "Invitations and shared accounts are not supported in this demo. Owner, Contributor, and Reviewer explain project responsibilities. Every signed-in user has isolated sample data.", source: "Understand the sample roles", version: "1.0.0" },
  { id: "return", title: "Will my workspace still be here when I return?", answer: "Yes. The saved sample project survives a refresh or another sign-in. If you have not finished setup, you return to onboarding.", source: "Name your workspace", version: "1.0.0" },
  { id: "limits", title: "What if my question is outside the demo?", answer: "The guide will say when a feature is unsupported or a fact is missing from the handbook. The demo does not send invitations, take payments, upload files, or publish work.", source: "Demo limits and unsupported features", version: "1.2.0" },
];

export function LaunchpadTabs({ activeTab, onTabChange, saved = false, workspaceName, projectName, workflow = "client_delivery", taskCount = 6, secondaryContent, onOpenGuide, children }: {
  activeTab: DemoTab;
  onTabChange: (tab: DemoTab) => void;
  saved?: boolean;
  workspaceName?: string;
  projectName?: string;
  workflow?: Workflow;
  taskCount?: number;
  secondaryContent?: ReactNode;
  onOpenGuide: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const [role, setRole] = useState(0);
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const isProject = activeTab === "overview" || activeTab === "workflow";
  const roleContent = roles[role];
  const views = saved
    ? [{ id: "overview" as const, label: "Board", icon: LayoutGrid }, { id: "workflow" as const, label: "List", icon: List }]
    : [{ id: "overview" as const, label: "Setup", icon: Settings2 }, { id: "workflow" as const, label: "Preview", icon: Eye }];
  const filteredHandbook = handbook.filter(item => `${item.title} ${item.answer}`.toLowerCase().includes(query.trim().toLowerCase()));
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") next = 1 - index;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    onTabChange(views[next].id);
    document.getElementById(`${id}-tab-${views[next].id}`)?.focus();
  };
  const sectionName = isProject ? "Projects" : activeTab === "roles" ? "People" : "Help center";

  return <div className={styles.workspace}>
    <aside className={styles.sidebar} aria-label="Workspace sidebar">
      <div className={styles.workspaceIdentity}><span className={styles.workspaceAvatar}>{workspaceName?.slice(0, 1).toUpperCase() || "L"}</span><div><strong>{workspaceName || "Your workspace"}</strong><small>{saved ? "Personal workspace" : "Setup in progress"}</small></div></div>
      <nav className={styles.primaryNavigation} aria-label="Workspace navigation">
        <div className={styles.projectGroup}><span className={styles.navLabel}>Projects <span>{saved ? "1" : "Draft"}</span></span><button type="button" className={`${styles.navButton} ${isProject ? styles.activeNav : ""}`} aria-current={isProject ? "page" : undefined} data-guide-target="project-home" data-guide-label={projectName || "New project"} data-guide-active={isProject ? "true" : "false"} onClick={() => onTabChange("overview")}><span className={styles.projectDot} /><span>{projectName || "New project"}</span>{!saved && <small>Draft</small>}</button></div>
        <div className={styles.peopleGroup}><span className={styles.navLabel}>Workspace</span><button type="button" className={`${styles.navButton} ${activeTab === "roles" ? styles.activeNav : ""}`} aria-current={activeTab === "roles" ? "page" : undefined} data-guide-target="nav-roles" data-guide-label="People" data-guide-active={activeTab === "roles" ? "true" : "false"} onClick={() => onTabChange("roles")}><Users size={17} /><span>People</span><small>1</small></button></div>
      </nav>
      <div className={styles.sidebarBottom}><button type="button" className={`${styles.navButton} ${activeTab === "handbook" ? styles.activeNav : ""}`} aria-current={activeTab === "handbook" ? "page" : undefined} data-guide-target="nav-handbook" data-guide-label="Help center" data-guide-active={activeTab === "handbook" ? "true" : "false"} onClick={() => onTabChange("handbook")}><CircleHelp size={17} /><span>Help center</span></button><div className={styles.sidebarNote}><LockKeyhole size={13} /><span>Private demo workspace</span></div></div>
    </aside>

    <div className={styles.content}>
      <div className={styles.contentBreadcrumb}><span>{workspaceName || "Workspace"}</span><span>/</span><strong>{sectionName}</strong>{isProject && <><span>/</span><span>{projectName || "New project"}</span></>}<span className={styles.privateLabel}><LockKeyhole size={12} /> Only you</span></div>
      <div className={styles.projectSection} hidden={!isProject}>
        <header className={styles.projectHeader}><div><div className={styles.projectTitle}><span className={styles.projectIcon}><FolderKanban size={19} /></span><h1>{projectName || (saved ? "Your project" : "Set up your workspace")}</h1></div><div className={styles.projectMeta}>{saved ? <><span className={styles.ownerInline}><span>Y</span>You, Owner</span><span>{taskCount} tasks</span></> : <><span className={styles.unsavedDot} /><span>Unsaved project</span><span>Only Create saves your workspace</span></>}</div></div><span className={styles.workflowBadge}>{workflow === "campaign" ? <Flag size={13} /> : <FolderKanban size={13} />}{workflow === "campaign" ? "Campaign" : "Client Delivery"}</span></header>
        {isProject && <div className={styles.viewBar}><div className={styles.viewTabs} role="tablist" aria-label="Project views">{views.map((view, index) => <button type="button" key={view.id} id={`${id}-tab-${view.id}`} role="tab" aria-selected={activeTab === view.id} aria-controls={saved ? `${id}-project-panel` : `${id}-panel-${view.id}`} tabIndex={activeTab === view.id ? 0 : -1} data-guide-target={`nav-${view.id}`} data-guide-label={view.label} data-guide-active={activeTab === view.id ? "true" : "false"} onClick={() => onTabChange(view.id)} onKeyDown={event => moveTab(event, index)}><view.icon size={15} />{view.label}</button>)}</div><span className={styles.viewHint}>{saved ? "Project views" : "Setup draft"}</span></div>}
      </div>

      {saved ? <section id={`${id}-project-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${activeTab === "workflow" ? "workflow" : "overview"}`} hidden={!isProject} className={styles.projectPanel}>{children}</section> : <><section id={`${id}-panel-overview`} role="tabpanel" aria-labelledby={`${id}-tab-overview`} hidden={activeTab !== "overview"} className={styles.projectPanel}>{children}</section><section id={`${id}-panel-workflow`} role="tabpanel" aria-labelledby={`${id}-tab-workflow`} hidden={activeTab !== "workflow"} className={styles.projectPanel}>{secondaryContent}</section></>}

      <section hidden={activeTab !== "roles"} className={styles.pagePanel} aria-labelledby={`${id}-people-title`}>
        <header className={styles.pageHeading}><div><h1 id={`${id}-people-title`}>People</h1><p>Members who can access this workspace.</p></div><span className={styles.countBadge}>1 member</span></header>
        <div className={styles.membersTable}><table><caption className="sr-only">Workspace members</caption><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Access</th></tr></thead><tbody><tr><td><span className={styles.memberIdentity}><span className={styles.memberAvatar}>Y</span><span><strong>You</strong><small>Signed-in account</small></span></span></td><td><span className={styles.ownerBadge}>Owner</span></td><td><span className={styles.memberAccess}><ShieldCheck size={14} />Personal workspace</span></td></tr></tbody></table></div>
        <p className={styles.memberNote}><LockKeyhole size={13} /> Only your account has access. Member invitations aren’t supported in this demo.</p>
        <section className={styles.accessInspector} aria-labelledby={`${id}-access-title`}><div className={styles.inspectorHeading}><h2 id={`${id}-access-title`}>About project access</h2><span>Role definitions</span></div><div className={styles.roleButtons} aria-label="Role definitions">{roles.map((item, index) => <button type="button" key={item.id} aria-pressed={role === index} data-guide-target={`role-${item.id}`} data-guide-label={item.name} data-guide-active={role === index ? "true" : "false"} onClick={() => setRole(index)}>{item.name}</button>)}</div><div className={styles.roleExplanation} aria-live="polite"><strong>{roleContent.status}</strong><p>{roleContent.description}</p></div></section>
      </section>

      <section hidden={activeTab !== "handbook"} className={styles.pagePanel} aria-labelledby={`${id}-help-title`}>
        <header className={styles.pageHeading}><div><h1 id={`${id}-help-title`}>Help center</h1><p>Find an answer about your workspace.</p></div><button type="button" className="button button-outline" onClick={onOpenGuide}><MessageCircle size={15} /> Ask your guide</button></header>
        <div className={styles.handbookToolbar}><div className="search-field handbook-search"><Search size={16} /><input id={`${id}-handbook-search`} type="search" aria-label="Search handbook" placeholder="Search help articles…" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" aria-label="Clear handbook search" data-guide-target="handbook-clear" data-guide-active={query ? "false" : "true"} disabled={!query} onClick={event => { setQuery(""); if (event.isTrusted) document.getElementById(`${id}-handbook-search`)?.focus(); }}><X size={14} /></button></div><span>{filteredHandbook.length} answers</span></div>
        <div className={styles.handbook}>{filteredHandbook.map(item => <article key={item.id}><h2><button type="button" aria-expanded={openFaq === item.id} aria-controls={`${id}-faq-${item.id}`} data-guide-target={`faq-${item.id}`} data-guide-label={item.title} data-guide-active={openFaq === item.id ? "true" : "false"} onClick={() => setOpenFaq(openFaq === item.id ? null : item.id)}>{item.title}<ChevronDown size={17} /></button></h2><div id={`${id}-faq-${item.id}`} hidden={openFaq !== item.id}><p>{item.answer}</p><small><BookOpen size={13} /> {item.source} · v{item.version}</small></div></article>)}{filteredHandbook.length === 0 && <div className={styles.noResults}><Search size={23} /><h2>No matching answers</h2><p>Try “workflow”, “roles”, or “workspace”.</p><button type="button" className="text-button" onClick={() => setQuery("")}>Clear search</button></div>}</div>
        <p className={styles.helpSourceNote}>Based on the Launchpad product handbook · Version 1.0.0</p>
      </section>
    </div>
  </div>;
}
