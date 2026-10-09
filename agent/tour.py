"""Short, grounded walkthrough with visible actions and interruptible speech."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Callable, Protocol

from guide_core import GuideTools, ValidationError


class SpeechPlayback(Protocol):
    id: str
    interrupted: bool

    async def wait_for_playout(self) -> None: ...
    def exception(self) -> BaseException | None: ...
    def interrupt(self, *, force: bool = False): ...


@dataclass(frozen=True)
class TourSection:
    tab: str
    kind: str
    target: str
    query: str
    narration: str
    onboarding_narration: str | None = None

    def narration_for(self, mode: str) -> str:
        return self.onboarding_narration if mode == "onboarding" and self.onboarding_narration else self.narration


TOUR_SECTIONS = (
    TourSection("overview", "navigate", "overview", "How do Setup Preview Board and List show the first sample project?",
                "I'll show you around. Board groups your project's tasks by stage. Ask a question anytime.",
                "I'll show you around. Setup names your workspace and project. Preview lets you inspect sample tasks."),
    TourSection("workflow", "stage", "review", "How do Review and Handoff work in Client Delivery and Campaign?",
                "List now shows Review tasks from the same project. Use these filters to focus on each stage.",
                "Preview now shows sample Review tasks from your chosen workflow. These are unsaved examples."),
    TourSection("roles", "role", "reviewer", "What are the Owner, Contributor and Reviewer roles?",
                "People lists your account. This inspector explains the example Reviewer role: checking work before handoff."),
    TourSection("handbook", "faq", "handoff", "How does the Handoff board stage work?",
                "Help center has searchable answers. This explains Handoff. What would you like to explore next?"),
)


class _TourStopped(Exception):
    pass


async def _until_stopped(operation, stop: asyncio.Event):
    """Cancel pending RPC/playout promptly on speech, End, or disconnect."""
    task = asyncio.ensure_future(operation)
    stopped = asyncio.create_task(stop.wait())
    try:
        await asyncio.wait((task, stopped), return_when=asyncio.FIRST_COMPLETED)
        if stop.is_set():
            raise _TourStopped()
        return await task
    finally:
        for pending in (task, stopped):
            if not pending.done():
                pending.cancel()
        await asyncio.gather(task, stopped, return_exceptions=True)


async def run_feature_tour(operations: GuideTools, say: Callable[..., SpeechPlayback],
                           stop: asyncio.Event, *, start_index: int = 0,
                           observe: Callable[..., None] = lambda *_a, **_k: None,
                           progress: Callable[[int], None] = lambda _index: None) -> dict:
    completed = []
    handle = None
    index = start_index
    try:
        for index in range(start_index, len(TOUR_SECTIONS)):
            section = TOUR_SECTIONS[index]
            if stop.is_set():
                raise _TourStopped()
            observe("tour_step_started", tab=section.tab)
            await _until_stopped(operations.perform_demo_action(section.kind, section.target), stop)
            await _until_stopped(operations.lookup_product_docs(section.query), stop)
            started = time.monotonic()
            # No new LLM turn per step. Chat history preserves context for this
            # same agent's natural follow-up questions after the walkthrough.
            handle = say(section.narration_for(operations.mode), allow_interruptions=True, add_to_chat_ctx=True)
            observe("tour_narration_requested", tab=section.tab, speech_id=handle.id,
                    monotonic_s=round(started, 3))
            await _until_stopped(handle.wait_for_playout(), stop)
            if handle.exception() is not None:
                raise ValidationError("The tour narration could not finish.")
            if handle.interrupted or stop.is_set():
                raise _TourStopped()
            completed.append(section.tab)
            progress(index + 1)
            observe("tour_step_completed", tab=section.tab, speech_id=handle.id,
                    elapsed_ms=round((time.monotonic() - started) * 1000, 2))
            handle = None
        return {"status": "completed", "completed_tabs": completed, "next_index": len(TOUR_SECTIONS)}
    except _TourStopped:
        return {"status": "interrupted", "completed_tabs": completed, "next_index": index}
    finally:
        if handle is not None and not handle.interrupted:
            handle.interrupt(force=True)
        if handle is not None and handle.interrupted:
            observe("tour_narration_interrupted", tab=TOUR_SECTIONS[index].tab,
                    speech_id=handle.id, monotonic_s=round(time.monotonic(), 3))


class TourController:
    """One walkthrough per room; speech stops it and explicit continuation resumes it."""
    def __init__(self, operations: GuideTools, say: Callable[..., SpeechPlayback], *,
                 observe: Callable[..., None] = lambda *_a, **_k: None):
        self.operations = operations
        self.say = say
        self.observe = observe
        self.stop_event = asyncio.Event()
        self.active = False
        self.next_index = 0

    def stop(self) -> None:
        self.stop_event.set()

    async def run(self, start_from: str = "continue") -> dict:
        if self.active:
            return {"status": "already_running"}
        if start_from == "continue":
            index = self.next_index
        else:
            tabs = [section.tab for section in TOUR_SECTIONS]
            if start_from not in tabs:
                raise ValidationError("Choose an available tour section.")
            index = tabs.index(start_from)
        if index == len(TOUR_SECTIONS):
            return {"status": "already_completed"}
        self.active = True
        self.next_index = index
        self.stop_event = asyncio.Event()
        def progress(next_index: int) -> None:
            self.next_index = next_index
        try:
            result = await run_feature_tour(self.operations, self.say, self.stop_event,
                                            start_index=index, observe=self.observe, progress=progress)
            self.next_index = result["next_index"]
            return result
        finally:
            self.active = False
