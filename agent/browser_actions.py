"""Bound, allowlisted browser RPCs; acknowledgement is required before narration."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

from guide_core import STAGE_ORDER, TASK_STAGES, ValidationError, task_reference_key, validate_move, validate_task

METHOD = "launchpad.perform_action"
CREATE_TASK_METHOD = "launchpad.create_task"
MOVE_TASK_METHOD = "launchpad.move_task"
TASK_ERRORS = {
    "invalid_request": "The task details were rejected. Check the title and stage before trying again.",
    "unavailable": "Task creation is unavailable. Use New task in the saved project.",
    "busy": "Another dashboard action is running, or a form or task details window is open. Ask the user to finish or close it, then try again.",
    "interrupted": "Task creation stopped before saving because you took over the dashboard.",
    "blocked": "A dialog or other control is blocking task creation. Close it and use New task.",
    "save_failed": "The task was not saved. You can try again or use New task.",
    "outcome_unknown": "Task creation is unconfirmed. Check the dashboard before adding it again; I will not retry this write.",
}
MOVE_ERRORS = {
    "invalid_request": "The move was rejected. Check the task title and stage before trying again.",
    "unavailable": "Moving tasks is unavailable. Use Move task in the saved project.",
    "busy": "Another dashboard action is running, or a form, the Move task panel, or task details is open. Ask the user to finish or close it, then try again.",
    "interrupted": "The move stopped before saving because you took over the dashboard.",
    "blocked": "A dialog or other control is blocking the move. Close it and use Move task.",
    "not_found": "No task with that title was found, so nothing moved. Check the title on the board.",
    "ambiguous": "More than one task has that title, so nothing moved.",
    "already_in_stage": "That task is already in that stage, so nothing changed.",
    "save_failed": "The task was not moved. Check the board; you can try again or use Move task.",
    "outcome_unknown": "The move is unconfirmed. Check the board before moving it again; I will not retry this write.",
}
# Any unknown outcome blocks both write kinds until the user checks the dashboard.
UNCONFIRMED_WRITE = "An earlier task change is unconfirmed. Check the dashboard before adding or moving a task; I will not retry that write."
TARGETS = {
    "navigate": frozenset({"overview", "workflow", "roles", "handbook"}),
    "stage": frozenset({"brief", "build", "review", "handoff"}),
    "role": frozenset({"owner", "contributor", "reviewer"}),
    "faq": frozenset({"workflow", "roles", "handoff"}),
}
UI_TOPIC = "launchpad.ui"
# Trusted manual clicks only; none of these is a remote perform_action target.
MANUAL_TARGETS = frozenset({"project-home", "task-search-clear", "task-new", "task-save", "task-move", "task-move-save"}
                           | {f"task-move-to-{stage}" for stage in TARGETS["stage"]})
UI_TARGETS = frozenset(f"{'nav' if kind == 'navigate' else kind}-{target}"
                       for kind, targets in TARGETS.items() for target in targets) | MANUAL_TARGETS


def is_user_navigation(data: bytes, topic: str | None, sender: str | None, expected_sender: str) -> bool:
    if topic != UI_TOPIC or sender != expected_sender or len(data) > 2048:
        return False
    try:
        event = json.loads(data)
        return (isinstance(event, dict) and set(event) == {"type", "target"}
                and event["type"] == "user_navigation" and isinstance(event["target"], str)
                and event["target"] in UI_TARGETS)
    except (ValueError, UnicodeError):
        return False


def _is_uuid(value: Any) -> bool:
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


def _created_rejection(error: str, detail: dict, _request: dict) -> str:
    if detail:
        raise ValueError("unexpected rejection fields")
    return TASK_ERRORS[error]


def _bind_created(receipt: Any, request: dict) -> dict:
    if (not isinstance(receipt, dict) or set(receipt) != {"id", "title", "stage"}
            or receipt.get("title") != request["title"] or receipt.get("stage") != request["stage"]
            or not _is_uuid(receipt.get("id"))):
        raise ValueError("invalid committed task")
    return dict(receipt)


def _move_rejection(error: str, detail: dict, request: dict) -> str:
    if error != "ambiguous":
        if detail:
            raise ValueError("unexpected rejection fields")
        if error == "not_found" and request["fromStage"] is not None:
            return f"No task with that title is in {request['fromStage']}, so nothing moved. Check the title on the board."
        return MOVE_ERRORS[error]
    stages = detail.get("stages")
    if (set(detail) != {"stages"} or not isinstance(stages, list) or not stages
            or not all(isinstance(stage, str) and stage in TASK_STAGES for stage in stages)
            or len(set(stages)) != len(stages)
            or (request["fromStage"] is not None and stages != [request["fromStage"]])):
        raise ValueError("invalid ambiguous stages")
    names = [stage for stage in STAGE_ORDER if stage in stages]
    if request["fromStage"] is None and len(names) > 1:
        return (f"{MOVE_ERRORS['ambiguous']} They are in {' and '.join(names)}. Ask once which of those "
                "stages it is in now, then move it once with that current stage.")
    return f"{MOVE_ERRORS['ambiguous']} They are all in {names[0]}; use Move task in the dashboard to choose one."


def _bind_moved(receipt: Any, request: dict) -> dict:
    if (not isinstance(receipt, dict) or set(receipt) != {"id", "title", "fromStage", "stage"}
            or not _is_uuid(receipt["id"]) or receipt["stage"] != request["stage"]
            or not isinstance(receipt["fromStage"], str) or receipt["fromStage"] not in TASK_STAGES
            or receipt["fromStage"] == request["stage"] or request["fromStage"] not in (None, receipt["fromStage"])
            or not isinstance(receipt["title"], str) or len(receipt["title"]) > 120
            or task_reference_key(receipt["title"]) != task_reference_key(request["title"])):
        raise ValueError("invalid committed move")
    return dict(receipt)


class BrowserActions:
    def __init__(self, perform_rpc: Callable[..., Awaitable[str]], participant_identity: str,
                 is_present: Callable[[], bool], *, observe: Callable[..., None] = lambda *_a, **_k: None,
                 timeout: float = 8.0, task_timeout: float = 15.0):
        self.perform_rpc = perform_rpc
        self.participant_identity = participant_identity
        self.is_present = is_present
        self.observe = observe
        self.timeout = timeout
        self.task_timeout = task_timeout
        self._pending: set[str] = set()
        self._write_busy = False
        self._unconfirmed_write: str | None = None

    @property
    def in_flight(self) -> bool:
        # Only read-only controls are cancelled by speech/manual tour takeover.
        # A task write must finish with its own durable receipt or unknown outcome.
        return bool(self._pending)

    async def create_task(self, title: str, description: str = "", stage: str = "Brief") -> dict:
        task = validate_task(title, description, stage)
        request_id, receipt = await self._write(CREATE_TASK_METHOD, task, TASK_ERRORS, "task_create", "task_created",
                                                _created_rejection, _bind_created)
        return {"status": "created", "saved": True, "requestId": request_id, "task": receipt}

    async def move_task(self, title: str, stage: str, from_stage: str | None = None) -> dict:
        move = validate_move(title, stage, from_stage)
        fields = {"title": move["title"], "fromStage": move["from_stage"], "stage": move["stage"]}
        request_id, receipt = await self._write(MOVE_TASK_METHOD, fields, MOVE_ERRORS, "task_move", "task_moved",
                                                _move_rejection, _bind_moved)
        return {"status": "moved", "saved": True, "requestId": request_id, "task": receipt}

    async def _write(self, method: str, fields: dict, errors: dict[str, str], event: str, done: str,
                     reject: Callable[[str, dict, dict], str], bind: Callable[[Any, dict], dict]) -> tuple[str, dict]:
        # Creation and moving share one busy slot and one unknown-outcome lockout.
        if self._unconfirmed_write is not None:
            raise ValidationError(UNCONFIRMED_WRITE)
        if self._write_busy:
            raise ValidationError(errors["busy"])
        if not self.is_present():
            raise ValidationError("The signed-in participant has left this room.")
        request_id = str(uuid4())
        request = {"version": 1, "requestId": request_id, **fields}
        self._write_busy = True
        started = time.monotonic()
        self.observe(f"{event}_requested", request_id=request_id)
        try:
            # No automatic retry: a missing reply may follow a committed write.
            # The browser/server reuse this request ID for their idempotent save.
            raw = await asyncio.wait_for(self.perform_rpc(
                destination_identity=self.participant_identity, method=method,
                payload=json.dumps(request, ensure_ascii=False), response_timeout=self.task_timeout,
            ), timeout=self.task_timeout + 0.5)
            if not isinstance(raw, str) or len(raw.encode("utf-8")) > 2048:
                raise ValueError("invalid response")
            result = json.loads(raw)
            if (not isinstance(result, dict) or type(result.get("version")) is not int
                    or result["version"] != 1 or result.get("requestId") != request_id):
                raise ValueError("unbound task receipt")
            if result.get("applied") is False and "error" in result:
                error = result["error"]
                if not isinstance(error, str) or error not in errors:
                    raise ValueError("invalid task error")
                message = reject(error, {key: value for key, value in result.items()
                                         if key not in {"version", "requestId", "applied", "error"}}, request)
                if error == "outcome_unknown":
                    self._unconfirmed_write = request_id
                self.observe(f"{event}_rejected", request_id=request_id, code=error)
                raise ValidationError(message)
            if result.get("applied") is not True or set(result) != {"version", "requestId", "applied", "task"}:
                raise ValueError("task was not acknowledged")
            receipt = bind(result["task"], request)
        except asyncio.CancelledError:
            self._unconfirmed_write = request_id
            self.observe(f"{event}_unconfirmed", request_id=request_id, reason="cancelled")
            raise
        except ValidationError:
            raise
        except Exception as exc:
            self._unconfirmed_write = request_id
            self.observe(f"{event}_unconfirmed", request_id=request_id, reason=type(exc).__name__)
            raise ValidationError(errors["outcome_unknown"]) from None
        finally:
            self._write_busy = False
        # A receipt proves the commit even if the participant leaves immediately
        # afterwards. Do not turn that committed outcome back into a failure.
        self.observe(done, request_id=request_id, elapsed_ms=round((time.monotonic() - started) * 1000, 2))
        return request_id, receipt

    async def perform(self, kind: str, target: str) -> dict:
        if not isinstance(kind, str) or not isinstance(target, str) or target not in TARGETS.get(kind, ()):
            raise ValidationError("Choose an available project view, stage filter, permission example, or Help center answer.")
        if not self.is_present():
            raise ValidationError("The signed-in participant has left this room.")
        action_id = uuid4().hex
        request = {"version": 1, "actionId": action_id, "kind": kind, "target": target}
        started = time.monotonic()
        self.observe("guide_action_requested", action_id=action_id, kind=kind, target=target)
        self._pending.add(action_id)
        try:
            # Installed rtc SDK: response_timeout is seconds. Also cap total wall
            # time, including the transport's separate acknowledgement timeout.
            raw = await asyncio.wait_for(self.perform_rpc(
                destination_identity=self.participant_identity, method=METHOD,
                payload=json.dumps(request), response_timeout=self.timeout,
            ), timeout=self.timeout + 0.5)
            if not isinstance(raw, str) or len(raw.encode("utf-8")) > 2048:
                raise ValueError("invalid response")
            result = json.loads(raw)
            if (not isinstance(result, dict) or set(result) != {"version", "actionId", "applied"}
                    or type(result.get("version")) is not int or result["version"] != 1
                    or result.get("actionId") != action_id or result.get("applied") is not True):
                raise ValueError("action was not acknowledged")
            if not self.is_present():
                raise ValueError("participant left")
        except asyncio.CancelledError:
            self.observe("guide_action_cancelled", action_id=action_id, kind=kind, target=target)
            raise
        except Exception as exc:
            self.observe("guide_action_failed", action_id=action_id, kind=kind, target=target,
                         exception_type=type(exc).__name__)
            raise ValidationError("The browser did not confirm that action. Please select the control directly.") from None
        finally:
            self._pending.discard(action_id)
        self.observe("guide_action_applied", action_id=action_id, kind=kind, target=target,
                     elapsed_ms=round((time.monotonic() - started) * 1000, 2))
        return {"status": "applied", "kind": kind, "target": target, "saved": False}
