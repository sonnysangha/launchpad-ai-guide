---
version: alpha
colors:
  canvas: "#f7f8fb"
  surface: "#ffffff"
  ink: "#273249"
  muted: "#637086"
  primary: "#5b62d6"
  border: "#e5e8ef"
  danger: "#b8404b"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  utility:
    fontFamily: 'ui-monospace, monospace'
rounded:
  control: "6px"
  card: "9px"
spacing:
  compact: "8px"
  regular: "16px"
  section: "24px"
components:
  button:
    rounded: "6px"
  panel:
    rounded: "9px"
---

# Launchpad design

## Overview

Launchpad is a fictional project workspace for a local, authenticated product demonstration. The current user requested a substantial redesign: the earlier warm, serif editorial presentation has been replaced by a compact application workspace. The reference is a focused project-management tool: a named project in the sidebar, real Board/List views of the same task dataset, People as a workspace destination, Help center in the sidebar footer, and an assistant that demonstrates real controls.

Authenticated screens use the product register. They must feel like a place to work, with useful content visible on entry. No large promotional headings, decorative eyebrows, invented activity, unsupported deadlines, or fabricated team members. The public landing page is a separate marketing surface.

The information architecture separates destinations from views. Sidebar items are ordinary navigation actions, never a four-part tutorial tab sequence. Only the current project has tabs: Board and List after saving; Setup and Preview before saving. Guide modes are contained inside the avatar widget.

The single distinctive interaction is the live guide highlighting and activating the actual workspace controls. Keep surrounding decoration quiet. A placeholder must never imply that a real avatar is connected.

## Colors

The runtime source of truth is `src/app/globals.css`, with the documented values mirrored above. Tokens map directly: canvas → `--paper`, surface → `--surface`, ink → `--ink`, muted → `--muted`, primary → `--accent`, border → `--line`, danger → `--error`. Legacy `--teal` is an adapter to `--accent` for the retained guide component. `--teal-hover` is `#484fbe`; `--teal-soft` is `#eeeefc`.

Use white content surfaces, a barely tinted sidebar, slate text, and indigo for selected navigation and primary actions. Small metadata uses the shared muted token, which retains at least 4.5:1 contrast on the white and pale sidebar surfaces. Stage tag foregrounds are darkened within their existing color families to keep the labels readable on tinted backgrounds. Task stage colors identify stages without implying real task progress, deadlines, or completion. Danger is reserved for the existing workspace reset and actionable errors.

Scrollbar tokens are globally owned: thumb `#bcc3d2`, track `#f5f6fa`, hover `#929db2`, active `#7483a0`. Standards-based scrollbar styles and WebKit fallbacks apply to every application-owned scroll container. Forced colors use system colors.

## Typography

Use the platform sans serif for headings, content, and controls. Authenticated page headings are 24–26px, medium to semibold, with restrained negative tracking. Primary navigation is 13px, task titles are 14px, and task descriptions are 12px on desktop. Secondary metadata is generally 11px. Explanatory content uses generous line-height. Do not shrink primary task content into pale utility text to manufacture density. Monospace is limited to task references. No remote fonts or late font swaps.

## Layout

The header is 64px on desktop and 59px on narrow screens. A 224px desktop sidebar becomes 198px then 176px before becoming a compact mobile navigation row below 640px. The named project, People, and Help center remain reachable; no navigation item masquerades as a project tab. The primary content has 32px side padding, reducing to 18px on phones. The document owns vertical scrolling; no viewport-height clipping is applied to setup or tab panels.

Desktop Setup uses a primary form plus a quiet setup summary. The summary disappears when space is insufficient. Preview is a separate project view containing the actual read-only sample template rows, conspicuously labeled Not saved. The setup form stays mounted when another destination or view is open.

The saved Board uses four columns on desktop, two at tablet width, and one on mobile. List displays the same saved task objects in a semantic table; the same task detail dialog opens from either view. Search and selected stage live in one persistent ProjectTasks component and survive manual Board/List switches. Native stage selection is available on Board; real stage filter buttons are available on List/Preview. No editing, assignments, activity, due dates, or totals are invented. Search never calls a remote service. At 360px and below, task search gets its own full-width row so the native stage selector cannot squeeze the input.

## Elevation & Depth

Use subtle one-pixel borders and very small card shadows. The avatar widget and native task detail dialog may use stronger elevation because they are overlays. Avoid decorative gradients, exaggerated rounded containers, large illustrations, or marketing stat blocks.

## Shapes

Controls use a 6px radius; major cards use 8–9px; circular avatars are text initials that identify the signed-in owner or an explicitly conceptual role. Do not invent portraits or collaborators. Lucide provides a consistent, small stroke icon family.

## Components

`AppChrome.tsx` owns the brand and account header. `LaunchpadTabs.tsx` and its CSS module own the named-project sidebar, contextual project tabs, People member row and role inspector, and searchable Help center. `ProjectTasks.tsx` and its CSS module own shared Board/List data exploration, stage filters, and task inspection. `src/lib/sample-tasks.ts` holds the single sample-task template dataset used by unsaved Preview and confirmed server creation. `Onboarding.tsx` owns the unsaved form and explicit Create. `Dashboard.tsx` supplies the saved task dataset and owns scoped reset. The guide remains mounted outside the panels.

Task inspection uses an app-styled native `<dialog>` opened with `showModal`, with an accessible title, Close action, Escape behavior, inert background, and native focus restoration. It exposes no editing controls. Product forms use app validation and `noValidate`. The Board stage filter deliberately uses a native select; platform-owned popup geometry is acceptable. List/Preview use simple pressed-state buttons that actually filter the table rows. People contains exactly one member, the signed-in owner; Contributor and Reviewer remain conceptual definitions in a compact inspector, never fictional members.

## Do's and Don'ts

- Keep stage and role interactions reversible and visibly selected.
- Use safe `data-guide-target` markers only on controls the guide is allowed to activate. Create, reset, account controls, and saved-data mutations are never guide actions.
- Show actual saved user data and clearly labeled fictional sample tasks.
- Keep honest connection state, captions, and versioned source cards in the guide.
- Use restrained motion, respect reduced motion, and preserve visible keyboard focus.
- Do not add auth changes, invitations, integrations, delivery claims, billing, or persistence beyond the existing explicit Create and own-workspace reset.
