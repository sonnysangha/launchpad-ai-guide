"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { BookOpen, Check, ChevronUp, CircleHelp, LoaderCircle, Mic, MicOff, Minus, PhoneOff, Radio, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant, type RemoteTrackPublication } from "livekit-client";
import { nameSchema, type DemoTab, type Draft, type GuideExperience, type RoomCredentials } from "@/lib/contracts";
import { GUIDE_ACTION_METHOD, isGuideActionMarker, parseGuideAction, type GuideActionResult } from "@/lib/guide-actions";
import { GuideActionOverlay, useGuideActions } from "./GuideActions";
import { CREATE_TASK_METHOD, MOVE_TASK_METHOD, parseCreateTask, parseMoveTask, type CreateTaskResult, type GuideCreateTask, type GuideMoveTask, type MoveTaskReply, type TaskGuideDriver } from "@/lib/task-actions";

export type GuideStep = "workspace" | "project" | "workflow" | "roles" | "confirm";
type Phase = "idle" | "connecting" | "waiting" | "live" | "reconnecting" | "ending" | "ended" | "error";
type Source = { id: string; title: string; version: string; excerpt: string };
type Caption = { id: string; text: string; speaker: "You" | "Guide" };
export type AvatarGuideHandle = { end: () => Promise<boolean>; open: () => void; collapse: () => void };
class GuideSetupError extends Error {}

export interface AvatarGuideProps {
  onCreateTask?: (request: GuideCreateTask, driver: TaskGuideDriver) => Promise<CreateTaskResult>;
  onMoveTask?: (request: GuideMoveTask, driver: TaskGuideDriver) => Promise<MoveTaskReply>;
  onDraft?: (patch: Partial<Draft>) => void;
  onHighlight?: (step: GuideStep) => void;
  onExperienceChange?: (experience: GuideExperience) => void | Promise<void>;
  switching?: boolean;
  experience?: GuideExperience;
  mode?: "onboarding" | "help";
  draft?: Partial<Draft>;
  sessionRef?: Ref<AvatarGuideHandle>;
  disabled?: boolean;
}

const validSteps: GuideStep[] = ["workspace", "project", "workflow", "roles", "confirm"];
const validTabs: DemoTab[] = ["overview", "workflow", "roles", "handbook"];
const experienceLabels: Record<GuideExperience, string> = { setup: "Guided setup", tour: "Feature tour", qa: "Product Q&A" };
const statusText: Record<Phase, string> = { idle: "Ready when you are", connecting: "Connecting your guide", waiting: "Waiting for avatar video", live: "Avatar connected", reconnecting: "Reconnecting", ending: "Ending your conversation", ended: "Conversation ended", error: "Guide unavailable" };

function safeDraft(value: unknown): Partial<Draft> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const patch: Partial<Draft> = {};
  const workspaceName = nameSchema.safeParse(data.workspaceName);
  const projectName = nameSchema.safeParse(data.projectName);
  if (workspaceName.success) patch.workspaceName = workspaceName.data;
  if (projectName.success) patch.projectName = projectName.data;
  if (data.workflow === "client_delivery" || data.workflow === "campaign") patch.workflow = data.workflow;
  return Object.keys(patch).length ? patch : null;
}

export function AvatarGuide({ onDraft, onHighlight, onCreateTask, onMoveTask, onExperienceChange, switching = false, mode = "onboarding", experience = mode === "onboarding" ? "setup" : "qa", draft, sessionRef, disabled = false }: AvatarGuideProps) {
  const [expanded, setExpanded] = useState(false);
  const taskAbortRef = useRef<AbortController | null>(null);
  const clearTarget = useCallback(() => setExpanded(false), []);
  const { perform: performAction, activateTaskControl, cancel: cancelReadActions, visual: actionVisual } = useGuideActions(clearTarget);
  const cancelActions = useCallback(() => { cancelReadActions(); taskAbortRef.current?.abort(); }, [cancelReadActions]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(true);
  const [micBusy, setMicBusy] = useState(false);
  const [needsAudio, setNeedsAudio] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [timing, setTiming] = useState<{ connection?: number; video?: number }>({});
  const [sessionExperience, setSessionExperience] = useState(experience);
  const panelId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const attemptRef = useRef(0);
  const startingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const videoCountRef = useRef(0);
  const startTimeRef = useRef(0);
  const roomNameRef = useRef<string | null>(null);
  const roomRequestRef = useRef<Promise<RoomCredentials> | null>(null);
  const endingRef = useRef(false);
  const removeTakeoverListenerRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onDraft, onHighlight, onCreateTask, onMoveTask });
  useEffect(() => { callbacksRef.current = { onDraft, onHighlight, onCreateTask, onMoveTask }; }, [onDraft, onHighlight, onCreateTask, onMoveTask]);
  const open = useCallback(() => {
    if (!expanded) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      setExpanded(true);
    }
  }, [expanded]);
  const collapse = useCallback(() => {
    setExpanded(false);
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current;
      if (target?.isConnected && !target.closest(".guide-widget-panel")) target.focus({ preventScroll: true });
      if (!target || document.activeElement !== target || target.closest(".guide-widget-panel")) launcherRef.current?.focus({ preventScroll: true });
    });
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const focusHeading = () => {
      const heading = panelHeadingRef.current;
      if (!heading) return;
      // Visibility can still be hidden at the first frame of the opening transition.
      if (window.getComputedStyle(heading).visibility !== "visible") {
        focusFrame = window.requestAnimationFrame(focusHeading);
        return;
      }
      heading.focus({ preventScroll: true });
    };
    let focusFrame = window.requestAnimationFrame(focusHeading);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); collapse(); } };
    document.addEventListener("keydown", escape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded, collapse]);

  const release = useCallback((cancelPending = true) => {
    cancelActions();
    removeTakeoverListenerRef.current?.();
    removeTakeoverListenerRef.current = null;
    attemptRef.current += 1;
    startingRef.current = false;
    if (cancelPending) abortRef.current?.abort();
    abortRef.current = null;
    const room = roomRef.current;
    roomRef.current = null;
    videoCountRef.current = 0;
    if (room) {
      room.removeAllListeners();
      room.unregisterRpcMethod(GUIDE_ACTION_METHOD);
      room.unregisterRpcMethod(CREATE_TASK_METHOD);
      room.unregisterRpcMethod(MOVE_TASK_METHOD);
      room.unregisterTextStreamHandler("lk.transcription");
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) publication.track?.detach().forEach(element => element.remove());
      }
      void room.disconnect(true);
    }
    videoRef.current?.replaceChildren();
    audioRef.current?.replaceChildren();
  }, [cancelActions]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; release(); };
  }, [release]);

  const active = phase === "connecting" || phase === "waiting" || phase === "live" || phase === "reconnecting";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = window.setTimeout(() => setError("The room is connected, but avatar video has not arrived. You can end the session and try again, or continue with the form."), 30000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const end = useCallback(async (): Promise<boolean> => {
    if (endingRef.current) return false;
    if (!roomRef.current && !roomNameRef.current && !roomRequestRef.current && !startingRef.current) return true;
    endingRef.current = true;
    const pendingRequest = roomRequestRef.current;
    let roomName = roomNameRef.current;
    release(false);
    setPhase("ending");
    setMuted(true);
    setNeedsAudio(false);
    setError("");
    try {
      // An explicit End waits for an in-flight token request so it can close
      // that exact room instead of racing a new room acquisition.
      if (pendingRequest) {
        try { roomName = (await pendingRequest).roomName; } catch { /* Close any owned room if token delivery failed. */ }
      }
      if (roomName || pendingRequest) {
        const response = await fetch("/api/room/end", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roomName ? { roomName } : {}), signal: AbortSignal.timeout(15000), keepalive: true });
        if (!response.ok) throw new Error("Unable to close the room.");
      }
      roomNameRef.current = null;
      roomRequestRef.current = null;
      if (mountedRef.current) setPhase("ended");
      return true;
    } catch {
      if (mountedRef.current) { setPhase("ending"); setError("Your microphone is off, but the session could not be closed. Select End again to retry."); }
      return false;
    } finally { endingRef.current = false; }
  }, [release]);

  useImperativeHandle(sessionRef, () => ({ end, open, collapse }), [end, open, collapse]);

  const start = async () => {
    if (disabled || switching || startingRef.current || roomRef.current || roomNameRef.current || roomRequestRef.current || endingRef.current || phase === "ending") return;
    release();
    const attempt = attemptRef.current;
    const current = () => mountedRef.current && attemptRef.current === attempt;
    startingRef.current = true;
    startTimeRef.current = performance.now();
    setPhase("connecting"); setError(""); setCaptions([]); setSource(null); setElapsed(0); setTiming({}); setMuted(true); setNeedsAudio(false); setSessionExperience(experience);
    const abort = new AbortController();
    abortRef.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    try {
      const request = (async () => {
        const response = await fetch("/api/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, experience, draft: safeDraft(draft) ?? {} }), credentials: "same-origin", signal: abort.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new GuideSetupError(typeof payload?.error === "string" ? payload.error : response.status === 401 ? "Your session expired. Sign in again to start the guide." : "The guide could not start. Please try again.");
        const result = payload as RoomCredentials;
        if (!result.token || !result.serverUrl || !result.agentIdentity || !result.roomName) throw new GuideSetupError("The guide connection is incomplete. Please try again after setup is finished.");
        return result;
      })();
      roomRequestRef.current = request;
      const credentials = await request;
      if (!current()) return;
      roomNameRef.current = credentials.roomName;
      window.clearTimeout(timeout);
      const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
      roomRef.current = room;
      const avatarIdentity = credentials.avatarIdentity || "launchpad-avatar";
      const isGuide = (identity: string) => identity === credentials.agentIdentity || identity === avatarIdentity;

      const takeOverNavigation = (event: MouseEvent | KeyboardEvent) => {
        if (!current() || !event.isTrusted || !(event.target instanceof Element)) return;
        const control = event.target.closest<HTMLButtonElement>("button[data-guide-target]");
        const target = control?.dataset.guideTarget;
        if (!control || control.type !== "button" || control.disabled || !target || !isGuideActionMarker(target)) return;
        cancelActions();
        if (room.state !== "connected") return;
        void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "user_navigation", target })), { reliable: true, topic: "launchpad.ui", destinationIdentities: [credentials.agentIdentity] }).catch(() => {
          // A transport failure must not undo the user's manual navigation.
        });
      };
      const takeOverTabKey = (event: KeyboardEvent) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !(event.target instanceof Element) || event.target.closest("button")?.getAttribute("role") !== "tab") return;
        takeOverNavigation(event);
      };
      document.addEventListener("click", takeOverNavigation, true);
      document.addEventListener("keydown", takeOverTabKey, true);
      removeTakeoverListenerRef.current = () => {
        document.removeEventListener("click", takeOverNavigation, true);
        document.removeEventListener("keydown", takeOverTabKey, true);
      };

      // Register before connect: the agent may request a UI action immediately
      // after joining. Only the server-assigned agent can invoke these actions.
      room.registerRpcMethod(GUIDE_ACTION_METHOD, async invocation => {
        const action = parseGuideAction(invocation.payload);
        const failure = (error: "unauthorized" | "invalid_action" | "cancelled"): GuideActionResult => ({ version: 1, actionId: action?.actionId ?? "invalid", applied: false, error });
        if (invocation.callerIdentity !== credentials.agentIdentity) return JSON.stringify(failure("unauthorized"));
        if (!current()) return JSON.stringify(failure("cancelled"));
        if (!action) return JSON.stringify(failure("invalid_action"));
        // Make the destination visible on small screens without moving focus,
        // disconnecting the room, or remounting its video/audio elements.
        if (window.innerWidth < 760) setExpanded(false);
        const result = await performAction(action);
        return JSON.stringify(current() ? result : failure("cancelled"));
      });

      room.registerRpcMethod(CREATE_TASK_METHOD, async invocation => {
        const request = parseCreateTask(invocation.payload);
        const failure = (error: "blocked" | "invalid_request" | "interrupted" | "unavailable" | "busy"): CreateTaskResult => ({ version: 1, requestId: request?.requestId ?? "invalid", applied: false, error });
        if (invocation.callerIdentity !== credentials.agentIdentity || mode !== "help") return JSON.stringify(failure("blocked"));
        if (!current()) return JSON.stringify(failure("interrupted"));
        if (!request) return JSON.stringify(failure("invalid_request"));
        if (!callbacksRef.current.onCreateTask) return JSON.stringify(failure("unavailable"));
        if (taskAbortRef.current) return JSON.stringify(failure("busy"));
        cancelReadActions();
        const controller = new AbortController();
        taskAbortRef.current = controller;
        if (window.innerWidth < 760) setExpanded(false);
        try {
          const result = await callbacksRef.current.onCreateTask(request, { navigate: performAction, activate: activateTaskControl, signal: controller.signal });
          // A committed task remains committed even if End was selected during
          // its POST. Never turn a durable save receipt into a cancellation.
          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ version: 1, requestId: request.requestId, applied: false, error: "outcome_unknown" } satisfies CreateTaskResult);
        } finally { if (taskAbortRef.current === controller) taskAbortRef.current = null; }
      });

      // Moving shares creation's guards and its single in-flight slot, so the
      // guide can never run both task requests at once.
      room.registerRpcMethod(MOVE_TASK_METHOD, async invocation => {
        const request = parseMoveTask(invocation.payload);
        const failure = (error: "blocked" | "invalid_request" | "interrupted" | "unavailable" | "busy"): MoveTaskReply => ({ version: 1, requestId: request?.requestId ?? "invalid", applied: false, error });
        if (invocation.callerIdentity !== credentials.agentIdentity || mode !== "help") return JSON.stringify(failure("blocked"));
        if (!current()) return JSON.stringify(failure("interrupted"));
        if (!request) return JSON.stringify(failure("invalid_request"));
        if (!callbacksRef.current.onMoveTask) return JSON.stringify(failure("unavailable"));
        if (taskAbortRef.current) return JSON.stringify(failure("busy"));
        cancelReadActions();
        const controller = new AbortController();
        taskAbortRef.current = controller;
        if (window.innerWidth < 760) setExpanded(false);
        try {
          // A committed move remains committed even if End was selected during its POST.
          return JSON.stringify(await callbacksRef.current.onMoveTask(request, { navigate: performAction, activate: activateTaskControl, signal: controller.signal }));
        } catch {
          return JSON.stringify({ version: 1, requestId: request.requestId, applied: false, error: "outcome_unknown" } satisfies MoveTaskReply);
        } finally { if (taskAbortRef.current === controller) taskAbortRef.current = null; }
      });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!current() || !isGuide(participant.identity)) return;
        if (track.kind === Track.Kind.Video && participant.identity === avatarIdentity) {
          const element = track.attach() as HTMLVideoElement;
          element.autoplay = true;
          (element as HTMLVideoElement).playsInline = true;
          element.setAttribute("aria-label", "Live avatar guide");
          const markVideoReady = () => {
            if (!current()) return;
            videoCountRef.current += 1;
            setPhase("live"); setError("");
            setTiming(previous => ({ ...previous, video: previous.video ?? Math.round(performance.now() - startTimeRef.current) }));
          };
          element.addEventListener("loadeddata", markVideoReady, { once: true });
          videoRef.current?.appendChild(element);
        } else if (track.kind === Track.Kind.Audio && participant.identity === avatarIdentity) {
          const element = track.attach();
          audioRef.current?.appendChild(element);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        track.detach().forEach(element => element.remove());
        if (current() && track.kind === Track.Kind.Video && participant.identity === avatarIdentity) {
          videoCountRef.current = Math.max(0, videoCountRef.current - 1);
          if (!videoCountRef.current) setPhase("waiting");
        }
      });
      room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic) => {
        if (!current() || participant?.identity !== credentials.agentIdentity || topic !== "launchpad.guide" || bytes.byteLength > 8192) return;
        try {
          const message = JSON.parse(new TextDecoder().decode(bytes));
          if (message.type === "draft" && mode === "onboarding" && experience === "setup") { const patch = safeDraft(message.patch); if (patch) callbacksRef.current.onDraft?.(patch); }
          if (message.type === "highlight" && validSteps.includes(message.step)) callbacksRef.current.onHighlight?.(message.step);
          if (message.type === "navigate" && validTabs.includes(message.tab)) void performAction({ version: 1, actionId: `legacy-${crypto.randomUUID()}`, kind: "navigate", target: message.tab });
          if (message.type === "cancel_actions") cancelActions();
          if (message.type === "source" && [message.id, message.title, message.version, message.excerpt].every(value => typeof value === "string") && message.excerpt.length <= 2000) {
            setSource({ id: message.id, title: message.title.slice(0, 120), version: message.version.slice(0, 30), excerpt: message.excerpt });
          }
        } catch { /* Untrusted or malformed room messages are ignored. */ }
      });
      const updateCaption = (caption: Caption) => {
        if (!current() || !caption.text.trim()) return;
        setCaptions(previous => [...previous.filter(item => item.id !== caption.id), caption].slice(-6));
      };
      room.registerTextStreamHandler("lk.transcription", async (reader, participantInfo) => {
        if (!isGuide(participantInfo.identity) && participantInfo.identity !== credentials.participantIdentity) return;
        const id = reader.info.attributes?.["lk.segment_id"] || reader.info.id;
        const speaker = participantInfo.identity === credentials.participantIdentity ? "You" : "Guide";
        let text = "";
        try { for await (const chunk of reader) { text += chunk; updateCaption({ id, text: text.slice(0, 3000), speaker }); } }
        catch { /* Reconnection can interrupt a transcript; preserve received words. */ }
      });
      room.on(RoomEvent.Reconnecting, () => { if (current()) setPhase("reconnecting"); });
      room.on(RoomEvent.Reconnected, () => { if (current()) setPhase(videoCountRef.current ? "live" : "waiting"); });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (current()) setNeedsAudio(!room.canPlaybackAudio); });
      room.on(RoomEvent.Disconnected, () => {
        if (!current()) return;
        void end().then(closed => {
          if (mountedRef.current && closed) setError("The guide disconnected and its session was closed. Start a new conversation to rejoin.");
        });
      });
      await room.connect(credentials.serverUrl, credentials.token);
      if (!current()) { await room.disconnect(true); return; }
      setTiming(previous => ({ ...previous, connection: Math.round(performance.now() - startTimeRef.current) }));
      setPhase(videoCountRef.current ? "live" : "waiting");
      try { await room.localParticipant.setMicrophoneEnabled(true); if (current()) setMuted(false); }
      catch {
        if (current()) { setMuted(true); setError("Microphone access is off. Allow it in your browser’s site settings, then select Enable microphone. You can also finish the form yourself."); }
      }
      if (current()) { try { await room.startAudio(); } catch { setNeedsAudio(true); } }
    } catch (cause) {
      if (!current()) return;
      const message = cause instanceof GuideSetupError ? cause.message : cause instanceof Error && cause.name === "AbortError" ? "The guide took too long to connect. Check your connection and try again." : "The guide could not connect. Check your connection and try again, or continue with the form.";
      // Even a failed or incomplete response can follow room allocation. End
      // the owned room before offering another Start or allowing persistence.
      const closed = await end();
      if (mountedRef.current) {
        if (closed) setPhase("error");
        setError(closed ? message : `${message} Your microphone is off, but the session could not be closed. Select End conversation to retry.`);
      }
    } finally {
      window.clearTimeout(timeout);
      if (current()) startingRef.current = false;
    }
  };

  const toggleMicrophone = async () => {
    const room = roomRef.current;
    const attempt = attemptRef.current;
    if (!room || micBusy) return;
    setMicBusy(true);
    try { await room.localParticipant.setMicrophoneEnabled(muted); if (attemptRef.current === attempt) { setMuted(!muted); setError(""); } }
    catch { if (attemptRef.current === attempt) { setMuted(true); setError("Your microphone is unavailable. Allow microphone access in your browser’s site settings and try again."); } }
    finally { if (mountedRef.current) setMicBusy(false); }
  };

  const hasSession = active || phase === "ending";
  const microphoneOn = active && phase !== "connecting" && !muted;
  const selectedExperience = experienceLabels[hasSession ? sessionExperience : experience];
  const endButton = <button className="button button-end" onClick={() => { void end(); }} disabled={phase === "ending" && !error}>{phase === "ending" && !error ? <LoaderCircle className="spin" size={17} /> : <PhoneOff size={17} />}{phase === "ending" && !error ? "Ending…" : "End conversation"}</button>;

  return <><GuideActionOverlay visual={actionVisual} /><aside className={`guide-widget ${expanded ? "is-expanded" : "is-collapsed"} ${hasSession ? "has-session" : ""}`} aria-label="Launchpad guide widget">
    <div className="guide-widget-launcher" hidden={expanded}>
      <button ref={launcherRef} className="guide-widget-open" onClick={open} aria-expanded={expanded} aria-controls={panelId} aria-label="Open avatar guide">
        <span className={`guide-widget-mark ${hasSession ? "is-active" : ""}`} aria-hidden="true">{hasSession ? <Radio size={21} /> : <Sparkles size={21} />}</span>
        <span className="guide-widget-label"><strong>Launchpad guide</strong><span role="status">{actionVisual ? actionVisual.label : hasSession ? statusText[phase] : "Ask, explore, get things done"}</span></span><ChevronUp size={16} aria-hidden="true" />
      </button>
      {hasSession && <div className="guide-widget-session"><span className={`guide-widget-mic ${microphoneOn ? "is-on" : ""}`} role="status">{microphoneOn ? <Mic size={13} /> : <MicOff size={13} />}{microphoneOn ? "Microphone on" : "Microphone off"}</span>{endButton}</div>}
      {hasSession && error && <p className="guide-widget-alert" role="alert">{phase === "ending" ? "Room cleanup needs a retry. Select End conversation." : "Your guide needs attention. Open it for details."}</p>}
    </div>
    <section id={panelId} className="guide-card guide-widget-panel" aria-label="Avatar guide" aria-hidden={!expanded} inert={!expanded}>
    <div className="guide-heading"><div className="guide-heading-icon"><Sparkles size={17} /></div><div><h2 ref={panelHeadingRef} tabIndex={-1}>Launchpad guide</h2><p>{selectedExperience} · AI assistant</p></div><button className="button button-ghost guide-widget-collapse" onClick={collapse} aria-label="Collapse guide" aria-expanded={expanded} aria-controls={panelId} title="Collapse guide; conversation keeps running"><Minus size={19} /></button></div>
    {onExperienceChange && <div className="guide-widget-modes"><label htmlFor={`${panelId}-experience`}>Conversation type</label><select id={`${panelId}-experience`} value={experience} disabled={disabled || switching} aria-busy={switching} onChange={event => { const next = event.target.value; if (next === "setup" || next === "tour" || next === "qa") void onExperienceChange(next); }}><option value="setup">Guided setup</option><option value="tour">Feature tour</option><option value="qa">Q&A</option></select>{hasSession && <small>Changing type ends this conversation.</small>}</div>}
    <div className="guide-widget-scroll">
    <div className={`avatar-stage ${phase === "live" ? "avatar-stage-live" : ""}`}>
      <div className="avatar-video" ref={videoRef} />
      <div ref={audioRef} className="avatar-audio" />
      {phase !== "live" && <div className="avatar-placeholder"><div className={`guide-symbol ${active ? "guide-symbol-active" : ""}`} aria-hidden="true">{active ? <Radio size={30} strokeWidth={1.5} /> : <Sparkles size={30} strokeWidth={1.5} />}</div><h3>{phase === "connecting" ? "Connecting your guide…" : phase === "waiting" ? "Your guide is joining" : phase === "reconnecting" ? "Reconnecting…" : "Let’s take a look together."}</h3><p>{active ? "Your live avatar will appear here." : "Ask a question or say “show me around”."}</p></div>}
      <div className={`connection-badge ${phase === "live" ? "is-live" : ""}`} role="status"><span className="status-dot" />{statusText[phase]}</div>
      {active && <span className="session-clock" aria-label="Session duration">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
    </div>
    <div className="guide-body">
      <div className="caption-box" role="log" aria-label="Conversation captions" aria-live="polite" aria-relevant="text additions">{captions.length ? captions.slice(-1).map(caption => <p key={caption.id}><span>{caption.speaker}</span>{caption.text}</p>) : <p className="caption-placeholder"><Volume2 size={15} /> Conversation captions will appear here.</p>}</div>
      {error && <p className="guide-error" role="alert">{error}</p>}
      {needsAudio && <button className="button button-outline audio-enable" onClick={() => { void roomRef.current?.startAudio().then(() => setNeedsAudio(false)).catch(() => setError("Audio playback is blocked. Check your browser’s sound permissions.")); }}><Volume2 size={16} /> Enable guide audio</button>}
      <div className="guide-controls">{hasSession ? <><button className="button button-outline mic-button" disabled={phase === "connecting" || phase === "ending" || micBusy} onClick={toggleMicrophone} aria-pressed={muted}>{micBusy ? <LoaderCircle className="spin" size={17} /> : muted ? <MicOff size={17} /> : <Mic size={17} />}{muted ? "Enable microphone" : "Mute"}</button>{endButton}</> : <button className="button button-primary guide-start" onClick={start} disabled={disabled || switching}><Mic size={17} />{phase === "idle" ? "Start a conversation" : "Start again"}</button>}</div>
      <p className="guide-disclosure"><ShieldCheck size={13} /> Microphone starts when you connect. No camera needed.</p>
      {hasSession && <p className="guide-collapse-note">Collapsing keeps the conversation running. Use End conversation to stop.</p>}
      {source && <aside className="source-card"><div><BookOpen size={15} /><span>Launchpad handbook</span><span className="source-version">{source.version}</span></div><h3>{source.title}</h3><p className="source-preview">{source.excerpt}</p><details className="source-excerpt" key={source.id}><summary>Read source</summary><p>{source.excerpt}</p></details><span className="source-id">{source.id}</span></aside>}
      <details className="guide-details"><summary><CircleHelp size={14} /> About this guide</summary><p>Your guide can open sections, explain the handbook, and add a task to your saved project or move one to another stage when you ask. During setup it fills an unsaved draft for you to review and create.</p>{timing.connection !== undefined && <p className="connection-metrics"><Check size={13} /> Observed this session: room {timing.connection} ms{timing.video !== undefined ? ` · first video ${timing.video} ms` : " · awaiting first video"}.</p>}</details>
    </div>
    </div>
  </section></aside></>;
}

export default AvatarGuide;
