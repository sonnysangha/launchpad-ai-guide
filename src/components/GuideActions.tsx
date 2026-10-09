"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MousePointer2, Sparkles } from "lucide-react";
import { guideActionMarker, guideActionTab, type GuideAction, type GuideActionError, type GuideActionResult } from "@/lib/guide-actions";
import type { TaskControlTarget } from "@/lib/task-actions";

type Bounds = { left: number; top: number; width: number; height: number };
type Visual = { actionId: string; marker: string; bounds: Bounds; x: number; y: number; label: string; phase: "moving" | "clicking" | "applied" };
type LocalTaskControl = { actionId: string; kind: "task_control"; target: TaskControlTarget };
class ActionError extends Error {
  constructor(readonly code: GuideActionError) { super(code); }
}

// Only schema-validated, fixed markers can reach this function. The matched
// element must be a regular button, never a form submit or a hidden control.
function findControl(marker: string, allowDisabled = false): HTMLButtonElement {
  const element = document.querySelector(`[data-guide-target="${marker}"]`);
  if (!(element instanceof HTMLButtonElement) || element.type !== "button" || (!allowDisabled && element.disabled) || element.closest("[hidden], [inert]") || !element.getClientRects().length || getComputedStyle(element).visibility !== "visible") throw new ActionError("target_unavailable");
  return element;
}

function boundsOf(element: HTMLElement): Bounds {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

function overlappingWidget(control: HTMLElement): DOMRect | null {
  const surface = document.querySelector<HTMLElement>(".guide-widget.is-expanded .guide-widget-panel, .guide-widget.is-collapsed .guide-widget-launcher");
  if (!surface || !surface.getClientRects().length) return null;
  const widget = surface.getBoundingClientRect();
  const target = control.getBoundingClientRect();
  return target.right > widget.left - 12 && target.left < widget.right + 12 && target.bottom > widget.top - 12 && target.top < widget.bottom + 12 ? widget : null;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ActionError("cancelled")); return; }
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { window.clearTimeout(timer); reject(new ActionError("cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Clear buttons disable themselves once applied; save buttons stay disabled while
// their request runs. Saves acknowledge only after the server receipt arrives.
const acknowledgedWhileDisabled = (marker: string) => marker === "handbook-clear" || marker === "task-search-clear" || marker === "task-save" || marker === "task-move-save";

async function waitForActive(marker: string, signal: AbortSignal) {
  const deadline = performance.now() + (marker === "task-save" || marker === "task-move-save" ? 10000 : 2000);
  while (performance.now() < deadline) {
    if (signal.aborted) throw new ActionError("cancelled");
    const control = findControl(marker, acknowledgedWhileDisabled(marker));
    if (control.dataset.guideActive === "true") { await pause(20, signal); return; }
    await pause(25, signal);
  }
  throw new ActionError("state_not_applied");
}

async function waitForControl(marker: string, signal: AbortSignal) {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new ActionError("cancelled");
    try { return findControl(marker); } catch (cause) {
      if (!(cause instanceof ActionError)) throw cause;
    }
    await pause(25, signal);
  }
  throw new ActionError("target_unavailable");
}

function controlLabel(control: HTMLButtonElement, verb: "Open" | "Select" | "") {
  const title = (control.dataset.guideLabel || control.getAttribute("aria-label") || control.innerText).trim().replace(/\s+/g, " ").slice(0, 90);
  return verb ? `${verb} ${title}` : title;
}

export function useGuideActions(clearTarget?: () => void) {
  const [visual, setVisual] = useState<Visual | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const hideRef = useRef<number | null>(null);
  const visualRef = useRef<Visual | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<{ id: string; promise: Promise<GuideActionResult> } | null>(null);

  const show = useCallback((next: Visual | null) => { visualRef.current = next; if (mountedRef.current) setVisual(next); }, []);
  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = null;
    if (hideRef.current) window.clearTimeout(hideRef.current);
    show(null);
  }, [show]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cancel(); };
  }, [cancel]);

  useEffect(() => {
    const reposition = () => {
      const current = visualRef.current;
      if (!current) return;
      try {
        const bounds = boundsOf(findControl(current.marker));
        show({ ...current, bounds, x: bounds.left + Math.min(bounds.width * .65, bounds.width - 14), y: bounds.top + bounds.height / 2 });
      } catch { show(null); }
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [show]);

  useEffect(() => {
    const takeOver = (event: Event) => { if (event.isTrusted && visualRef.current) cancel(); };
    document.addEventListener("pointerdown", takeOver, true);
    document.addEventListener("keydown", takeOver, true);
    return () => { document.removeEventListener("pointerdown", takeOver, true); document.removeEventListener("keydown", takeOver, true); };
  }, [cancel]);

  const perform = useCallback((action: GuideAction | LocalTaskControl): Promise<GuideActionResult> => {
    if (inFlightRef.current) {
      if (inFlightRef.current.id === action.actionId) return inFlightRef.current.promise;
      return Promise.resolve({ version: 1, actionId: action.actionId, applied: false, error: "busy" });
    }
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    if (hideRef.current) window.clearTimeout(hideRef.current);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const activate = async (marker: string, verb: "Open" | "Select" | "", onlyOpen = false) => {
      if (signal.aborted || generationRef.current !== generation) throw new ActionError("cancelled");
      let control = findControl(marker);
      const label = controlLabel(control, verb);
      const initial = control.getBoundingClientRect();
      const obstruction = overlappingWidget(control);
      if (obstruction && obstruction.top - initial.height - 20 >= 80) {
        // Keep the avatar visible by moving the real control into the clear
        // band above its panel. Recheck below because scroll can hit page limits.
        window.scrollBy({ top: initial.top - (obstruction.top - initial.height - 20), behavior: reduced ? "instant" : "smooth" });
        await pause(reduced ? 20 : 360, signal);
      } else if (initial.top < 80 || initial.bottom > window.innerHeight - 90 || initial.left < 0 || initial.right > window.innerWidth) {
        control.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center", inline: "nearest" });
        await pause(reduced ? 20 : 360, signal);
      }
      control = findControl(marker);
      // Short viewports or the end of the page may leave no clear scroll band.
      // Collapse only the presentation; room and media elements stay mounted.
      if (overlappingWidget(control)) clearTarget?.();
      const bounds = boundsOf(control);
      const x = bounds.left + Math.min(bounds.width * .65, bounds.width - 14);
      const y = bounds.top + bounds.height / 2;
      const previous = visualRef.current;
      show({ actionId: action.actionId, marker, bounds, x: previous?.x ?? window.innerWidth - 62, y: previous?.y ?? window.innerHeight - 65, label, phase: "moving" });
      await pause(reduced ? 0 : 20, signal);
      show({ actionId: action.actionId, marker, bounds, x, y, label, phase: "moving" });
      await pause(reduced ? 0 : 280, signal);
      // Re-read after animation so an intervening render cannot turn the target
      // into an unrelated control. click() invokes the real React handler and
      // deliberately leaves the user's keyboard focus where it is.
      control = findControl(marker);
      if (overlappingWidget(control)) throw new ActionError("target_unavailable");
      const clickBounds = boundsOf(control);
      const clickX = clickBounds.left + Math.min(clickBounds.width * .65, clickBounds.width - 14);
      const clickY = clickBounds.top + clickBounds.height / 2;
      // A modal makes the page inert without adding an [inert] attribute.
      // Require the visible pointer to reach this control, just as a real click would.
      const hit = document.elementFromPoint(clickX, clickY);
      if (!hit || !control.contains(hit)) throw new ActionError("target_unavailable");
      const alreadyOpen = onlyOpen && control.dataset.guideActive === "true";
      show({ actionId: action.actionId, marker, bounds: clickBounds, x: clickX, y: clickY, label, phase: alreadyOpen ? "applied" : "clicking" });
      if (!alreadyOpen) control.click();
      await waitForActive(marker, signal);
      if (!alreadyOpen && !reduced) await pause(110, signal);
      show({ actionId: action.actionId, marker, bounds: boundsOf(findControl(marker, acknowledgedWhileDisabled(marker))), x: clickX, y: clickY, label, phase: "applied" });
    };
    const promise = (async (): Promise<GuideActionResult> => {
      try {
        // Store inFlightRef before even a missing prerequisite can reject.
        await Promise.resolve();
        if (signal.aborted || generationRef.current !== generation) throw new ActionError("cancelled");
        if (action.kind === "task_control") {
          // Only the separate, validated create/move task paths call these local
          // controls. They are never accepted by launchpad.perform_action.
          await activate(action.target, "");
          hideRef.current = window.setTimeout(() => { if (generationRef.current === generation) show(null); }, 800);
          return { version: 1, actionId: action.actionId, applied: true };
        }
        const tab = guideActionTab(action);
        if (tab === "overview" || tab === "workflow") {
          let projectTabVisible = true;
          try { findControl(`nav-${tab}`); } catch { projectTabVisible = false; }
          if (!projectTabVisible) {
            await activate("project-home", "Open");
            await waitForControl(`nav-${tab}`, signal);
          }
        }
        if (action.kind !== "navigate" && findControl(`nav-${tab}`).dataset.guideActive !== "true") await activate(`nav-${tab}`, "Open");
        if (action.kind === "stage" && findControl("task-search-clear", true).dataset.guideActive !== "true") await activate("task-search-clear", "");
        // A previous handbook search may filter out this fixed FAQ. Use the
        // actual clear-search button before trying the requested answer.
        if (action.kind === "faq" && !document.querySelector(`[data-guide-target="${guideActionMarker(action)}"]`)) await activate("handbook-clear", "");
        await activate(guideActionMarker(action), action.kind === "navigate" || action.kind === "faq" ? "Open" : "Select", action.kind === "faq");
        hideRef.current = window.setTimeout(() => { if (generationRef.current === generation) show(null); }, 1400);
        return { version: 1, actionId: action.actionId, applied: true };
      } catch (cause) {
        if (generationRef.current === generation) show(null);
        return { version: 1, actionId: action.actionId, applied: false, error: cause instanceof ActionError ? cause.code : "target_unavailable" };
      } finally {
        if (generationRef.current === generation) { abortRef.current = null; inFlightRef.current = null; }
      }
    })();
    inFlightRef.current = { id: action.actionId, promise };
    return promise;
  }, [show, clearTarget]);

  const activateTaskControl = useCallback((target: LocalTaskControl["target"]) => perform({ actionId: crypto.randomUUID(), kind: "task_control", target }), [perform]);
  return { perform, activateTaskControl, cancel, visual };
}

export function GuideActionOverlay({ visual }: { visual: Visual | null }) {
  if (!visual) return null;
  const bounds = visual.bounds;
  return createPortal(<div className="guide-action-layer" data-guide-action-phase={visual.phase} data-guide-action-id={visual.actionId} data-guide-action-target={visual.marker}>
    <div className="guide-action-spotlight" aria-hidden="true" style={{ left: bounds.left - 5, top: bounds.top - 5, width: bounds.width + 10, height: bounds.height + 10 }} />
    <div className={`guide-action-cursor is-${visual.phase}`} aria-hidden="true" style={{ transform: `translate3d(${visual.x}px, ${visual.y}px, 0)` }}><span className="guide-action-click" /><MousePointer2 size={27} fill="currentColor" strokeWidth={1.5} /><span className="guide-action-name"><Sparkles size={11} /> Guide</span></div>
    <div className="guide-action-label" role="status" style={{ left: Math.max(12, Math.min(bounds.left, window.innerWidth - 220)), top: Math.max(12, bounds.top > 55 ? bounds.top - 39 : bounds.top + bounds.height + 12) }}><Sparkles size={13} />{visual.label}</div>
  </div>, document.body);
}
