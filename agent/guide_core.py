"""Key-free validation, retrieval, and draft operations for the voice guide."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

TOPIC = "launchpad.guide"
WORKFLOWS = frozenset({"client_delivery", "campaign"})
STEPS = frozenset({"workspace", "project", "workflow", "roles", "confirm"})
EXPERIENCES = frozenset({"setup", "tour", "qa"})
DEMO_TABS = frozenset({"overview", "workflow", "roles", "handbook"})
STAGE_ORDER = ("Brief", "Build", "Review", "Handoff")
TASK_STAGES = frozenset(STAGE_ORDER)
DOCS_PATH = Path(__file__).resolve().parent.parent / "docs" / "product"
UNKNOWN_ANSWER = "I don't have that information in the Launchpad docs."
UNSUPPORTED_ANSWER = "That feature is not supported in this Launchpad demo."


class ValidationError(ValueError):
    """A safe, human-readable validation failure that contains no credentials."""


def validate_task(title: Any, description: Any = "", stage: Any = "Brief") -> dict[str, str]:
    """One new task only: no IDs, owner, workflow, or existing-record patches."""
    values = {}
    for field, value, minimum, maximum in (("title", title, 2, 120), ("description", description, 0, 500)):
        if not isinstance(value, str):
            raise ValidationError(f"Task {field} must be text.")
        if any(unicodedata.category(char) in {"Cc", "Cf", "Cs"} for char in value):
            raise ValidationError(f"Task {field} cannot contain control characters.")
        value = value.strip()
        if not minimum <= len(value) <= maximum:
            raise ValidationError(f"Task {field} must contain {minimum} to {maximum} characters.")
        values[field] = value
    if not isinstance(stage, str) or stage not in TASK_STAGES:
        raise ValidationError("Choose Brief, Build, Review, or Handoff for the task stage.")
    return {**values, "stage": stage}


def task_reference_key(value: str) -> str:
    """Spoken-title matching key shared with the browser: NFKC, lowercase, letters and numbers."""
    return "".join(c for c in unicodedata.normalize("NFKC", value).lower() if c.isalnum())


def validate_move(title: Any, stage: Any, from_stage: Any = None) -> dict[str, str | None]:
    """One existing task by title, to another stage: no IDs, ordering, or other field patches."""
    clean = validate_task(title)["title"]
    if not task_reference_key(clean):
        # A title with no letters or digits would match every such task.
        raise ValidationError("Say the task's name as it appears on the board.")
    if not isinstance(stage, str) or stage not in TASK_STAGES:
        raise ValidationError("Choose Brief, Build, Review, or Handoff as the destination stage.")
    if from_stage is not None and (not isinstance(from_stage, str) or from_stage not in TASK_STAGES):
        raise ValidationError("Choose Brief, Build, Review, or Handoff for the task's current stage.")
    if from_stage == stage:
        raise ValidationError("The task's current stage and destination stage must differ.")
    return {"title": clean, "stage": stage, "from_stage": from_stage}


def validate_name(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be text.")
    value = value.strip()
    if not 2 <= len(value) <= 80:
        raise ValidationError(f"{field} must contain 2 to 80 characters.")
    if any(unicodedata.category(char) in {"Cc", "Cf"} for char in value):
        raise ValidationError(f"{field} cannot contain control characters.")
    return value


def validate_patch(patch: Any, *, allow_empty: bool = False) -> dict[str, str]:
    if not isinstance(patch, dict) or set(patch) - {"workspaceName", "projectName", "workflow"}:
        raise ValidationError("Draft has unsupported fields.")
    clean = {}
    for field, value in patch.items():
        if allow_empty and value in (None, ""):
            continue
        if field == "workflow":
            if not isinstance(value, str) or value not in WORKFLOWS:
                raise ValidationError("Choose Client Delivery or Campaign.")
            clean[field] = value
        else:
            clean[field] = validate_name(value, field)
    if not clean and not allow_empty:
        raise ValidationError("Provide at least one draft field.")
    return clean


def validate_step(step: Any) -> str:
    if not isinstance(step, str) or step not in STEPS:
        raise ValidationError("Choose workspace, project, workflow, roles, or confirm.")
    return step


def validate_experience(experience: Any, mode: str) -> str:
    if experience is None:
        return "setup" if mode == "onboarding" else "qa"
    if not isinstance(experience, str) or experience not in EXPERIENCES:
        raise ValidationError("Choose setup, tour, or qa.")
    return experience


def validate_tab(tab: Any) -> str:
    if not isinstance(tab, str) or tab not in DEMO_TABS:
        raise ValidationError("Choose overview, workflow, roles, or handbook.")
    return tab


def _b64decode(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValidationError("Invalid dispatch encoding.")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_dispatch(metadata: str, secret: str, room_name: str, *, now: int | None = None) -> dict:
    """Verify the server-signed room/user binding before creating paid resources."""
    if len(secret) < 32:
        raise ValidationError("LAUNCHPAD_AGENT_SECRET must contain at least 32 characters.")
    try:
        if not isinstance(metadata, str) or len(metadata) > 8192:
            raise ValidationError("Invalid dispatch metadata.")
        envelope = json.loads(metadata)
        if not isinstance(envelope, dict) or set(envelope) != {"payload", "signature"}:
            raise ValidationError("Invalid dispatch envelope.")
        payload, signature = envelope["payload"], envelope["signature"]
        if not isinstance(payload, str) or not isinstance(signature, str):
            raise ValidationError("Invalid dispatch signature.")
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature)):
            raise ValidationError("Invalid dispatch signature.")
        data = json.loads(_b64decode(payload))
        if not isinstance(data, dict) or type(data.get("v")) is not int or data.get("v") != 1:
            raise ValidationError("Invalid dispatch version.")
        required = {"v", "userId", "participantIdentity", "roomName", "expiresAt", "mode", "draft"}
        if not required.issubset(data) or set(data) - required - {"experience"}:
            raise ValidationError("Invalid dispatch fields.")
        expires = data.get("expiresAt")
        current = int(time.time()) if now is None else now
        if type(expires) is not int or not current < expires <= current + 600:
            raise ValidationError("Dispatch has expired or exceeds the allowed lifetime.")
        if data.get("roomName") != room_name:
            raise ValidationError("Dispatch room does not match.")
        for field in ("userId", "participantIdentity", "roomName"):
            value = data.get(field)
            if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_:.-]{1,200}", value):
                raise ValidationError("Invalid dispatch identity.")
        if data["participantIdentity"] in ("launchpad-guide", "launchpad-avatar"):
            raise ValidationError("Reserved participant identity.")
        if data.get("mode") not in ("onboarding", "help"):
            raise ValidationError("Invalid guide mode.")
        if "experience" in data and data["experience"] is None:
            raise ValidationError("Invalid guide experience.")
        data["experience"] = validate_experience(data.get("experience"), data["mode"])
        data["draft"] = validate_patch(data.get("draft", {}), allow_empty=True)
        return data
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        if isinstance(exc, ValidationError):
            raise
        raise ValidationError("Invalid dispatch metadata.") from None


@dataclass(frozen=True)
class ProductDoc:
    id: str
    title: str
    version: str
    keywords: tuple[str, ...]
    content: str

    def source(self) -> dict[str, str]:
        return {"id": self.id, "title": self.title, "version": self.version, "excerpt": self.content}


class ProductDocs:
    def __init__(self, directory: Path = DOCS_PATH):
        self.documents: list[ProductDoc] = []
        for path in sorted(directory.glob("*.md")):
            raw = path.read_text(encoding="utf-8")
            chunks = raw.split("---", 2)
            if len(chunks) != 3 or chunks[0].strip():
                raise ValidationError("Product document metadata is invalid.")
            meta = dict(line.split(": ", 1) for line in chunks[1].strip().splitlines())
            self.documents.append(ProductDoc(
                id=meta["id"], title=meta["title"], version=meta["version"],
                keywords=tuple(x.strip() for x in meta["keywords"].split(",")),
                content=chunks[2].strip(),
            ))
        if len(self.documents) != 6 or len({x.id for x in self.documents}) != 6:
            raise ValidationError("Exactly six uniquely identified product documents are required.")

    def lookup(self, query: str) -> dict:
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 600:
            raise ValidationError("Ask a product question between 1 and 600 characters.")
        words = set(re.findall(r"[a-z0-9]+", query.lower()))
        aliases = {"invites": "invite", "members": "member", "exports": "export", "uploads": "upload",
                   "invoices": "invoice", "calendars": "calendar", "deadlines": "deadline", "prices": "price",
                   "costs": "cost", "automations": "automation", "businesses": "business", "companies": "company",
                   "moves": "move", "moving": "move", "moved": "move"}
        words |= {aliases[word] for word in words if word in aliases}
        scored = []
        for doc in self.documents:
            score = sum(1 for keyword in doc.keywords if set(keyword.split()).issubset(words))
            if score:
                scored.append((score, doc))
        if not scored:
            return {"status": "unknown", "answer": UNKNOWN_ANSWER, "sources": []}
        # Explicit unsupported capabilities take precedence over generic project vocabulary.
        limits = next((d for _, d in scored if d.id == "limits"), None)
        if limits:
            return {"status": "limited", "answer": UNSUPPORTED_ANSWER, "sources": [limits.source()]}
        scored.sort(key=lambda item: (-item[0], item[1].id))
        return {"status": "documented", "sources": [doc.source() for _, doc in scored[:3]],
                "instruction": "Answer only the question parts directly supported by these sources. For missing information, say you do not have it in the Launchpad docs."}

    def context(self) -> str:
        return "\n\n".join(f"[{d.id} v{d.version}] {d.title}\n{d.content}" for d in self.documents)


class GuideTools:
    def __init__(self, publish: Callable[[dict], Awaitable[None]], *, mode: str = "onboarding", experience: str | None = None, draft: dict | None = None, documents: ProductDocs | None = None, perform_action: Callable[[str, str], Awaitable[dict]] | None = None, create_task: Callable[..., Awaitable[dict]] | None = None, move_task: Callable[..., Awaitable[dict]] | None = None):
        self.publish = publish
        self.mode = mode
        self.experience = validate_experience(experience, mode)
        self.draft = validate_patch(draft or {}, allow_empty=True)
        self.documents = documents or ProductDocs()
        self.perform_action = perform_action
        self._create_task = create_task
        self._move_task = move_task
        self.last_demonstration: dict | None = None

    async def create_task(self, title: str, description: str = "", stage: str = "Brief") -> dict:
        if self.mode != "help":
            raise ValidationError("Create the project using the setup form first. Tasks can only be added to a saved project.")
        task = validate_task(title, description, stage)
        if self._create_task is None:
            raise ValidationError("Task creation is unavailable in this session. Use New task in the dashboard.")
        result = await self._create_task(**task)
        if result.get("saved") is True:
            self.last_demonstration = None  # The new task receipt is now the conversational context.
        return result

    async def move_task(self, title: str, stage: str, from_stage: str | None = None) -> dict:
        if self.mode != "help":
            raise ValidationError("Create the project using the setup form first. Tasks can only be moved in a saved project.")
        move = validate_move(title, stage, from_stage)
        if self._move_task is None:
            raise ValidationError("Moving tasks is unavailable in this session. Use Move task in the dashboard.")
        result = await self._move_task(**move)
        if result.get("saved") is True:
            self.last_demonstration = None  # The move receipt is now the conversational context.
        return result

    async def perform_demo_action(self, kind: str, target: str) -> dict:
        if self.perform_action is None:
            raise ValidationError("Browser controls are unavailable in this session.")
        result = await self.perform_action(kind, target)
        if result.get("status") == "applied":
            # This is evidence of the last confirmed demonstration, not a live
            # mirror of browser state or a classifier of the next user's intent.
            context = {"kind": kind, "target": target}
            if kind == "stage" and target.capitalize() in TASK_STAGES:
                stage = target.capitalize()
                index = STAGE_ORDER.index(stage)
                context.update({"stage": stage, "next_stage": STAGE_ORDER[index + 1] if index + 1 < len(STAGE_ORDER) else None,
                                "view": "Preview" if self.mode == "onboarding" else "List",
                                "changed": "visible_filter_only"})
            self.last_demonstration = context
            return {**result, "last_demonstrated_feature": dict(context)}
        return result

    async def navigate_demo_tab(self, tab: str) -> dict:
        clean = validate_tab(tab)
        if self.perform_action is not None:
            return await self.perform_demo_action("navigate", clean)
        await self.publish({"type": "navigate", "tab": clean})
        return {"status": "navigation_sent", "tab": clean, "saved": False,
                "changes": "visible_tab_only", "delivery": "published_to_authenticated_participant"}

    async def update_draft(self, patch: dict) -> dict:
        if self.mode != "onboarding":
            raise ValidationError("Help cannot change the saved project. Draft updates are only available during onboarding.")
        if self.experience != "setup":
            raise ValidationError("Tour and Q&A cannot edit the draft. Choose Guided setup to change draft fields.")
        clean = validate_patch(patch)
        await self.publish({"type": "draft", "patch": clean})
        self.draft.update(clean)
        return {"status": "draft_updated", "draft": dict(self.draft), "saved": False,
                "next": "The user must review the form and press Create in the browser to persist it."}

    async def highlight_step(self, step: str) -> dict:
        clean = validate_step(step)
        await self.publish({"type": "highlight", "step": clean})
        return {"status": "highlighted", "step": clean}

    async def lookup_product_docs(self, query: str) -> dict:
        result = self.documents.lookup(query)
        for source in result["sources"]:
            await self.publish({"type": "source", **source})
        return {**result, **({"last_demonstrated_feature": dict(self.last_demonstration)} if self.last_demonstration else {})}
