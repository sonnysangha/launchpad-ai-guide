"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { ArrowUpRight, ChevronRight, CircleHelp } from "lucide-react";

export function LaunchpadBrand() {
  return <Link className="brand" href="/" aria-label="Launchpad home"><span className="brand-mark" aria-hidden="true"><ArrowUpRight size={23} strokeWidth={2.4} /></span><span>launchpad<span className="brand-period">.</span></span></Link>;
}

export function AppHeader({ onHelp, workspaceName }: { onHelp?: () => void; workspaceName?: string }) {
  return <header className="app-header"><div className="header-inner"><div className="header-left"><LaunchpadBrand /><span className="header-divider" /><span className="header-section">Workspace</span><ChevronRight className="header-chevron" size={13} /><span className="header-current">{workspaceName ? "Projects" : "Getting started"}</span></div><div className="header-right"><span className="demo-badge">Fictional demo</span>{onHelp && <button className="button button-ghost header-help" onClick={onHelp}><CircleHelp size={17} /> Help</button>}<UserButton /></div></div></header>;
}
