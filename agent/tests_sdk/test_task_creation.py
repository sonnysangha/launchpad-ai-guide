"""Installed SDK interruption boundary and real task-operation plumbing, no provider."""
import asyncio
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent import LaunchpadGuide, apply_tool_reply_policy
from browser_actions import MOVE_ERRORS, TASK_ERRORS, BrowserActions
from guide_core import GuideTools
from livekit.agents import AgentSession, RunContext
from livekit.agents.llm import FunctionCall, FunctionCallOutput, ToolError
from livekit.agents.voice.events import FunctionToolsExecutedEvent
from livekit.agents.voice.speech_handle import InputDetails, SpeechHandle

TASK_ID = "1b6c59d1-9c29-416a-aa44-e889b97e113e"


class TaskToolSDKTests(unittest.IsolatedAsyncioTestCase):
    def context(self, session, name="create_task"):
        handle = SpeechHandle(speech_id=f"unit-{name}-speech", allow_interruptions=True,
                              input_details=InputDetails(modality="audio"))
        call = FunctionCall(call_id=f"unit-{name}-call", name=name, arguments='{"title":"Design homepage"}')
        return RunContext(session=session, speech_handle=handle, function_call=call)

    async def test_disables_interruptions_stops_tour_and_returns_committed_receipt(self):
        events = []
        async def publish(event):
            events.append(event)
        async def rpc(**options):
            self.assertFalse(context.speech_handle.allow_interruptions)
            self.assertEqual(events, ["tour_stopped", {"type": "cancel_actions"}])
            request = json.loads(options["payload"])
            return json.dumps({"version": 1, "requestId": request["requestId"], "applied": True,
                               "task": {"id": "1b6c59d1-9c29-416a-aa44-e889b97e113e", "title": request["title"], "stage": "Build"}})
        browser = BrowserActions(rpc, "bound-member", lambda: True)
        operations = GuideTools(publish, mode="help", create_task=browser.create_task)
        tour = SimpleNamespace(stop=lambda: events.append("tour_stopped"))
        guide = LaunchpadGuide(operations, "help", tour)
        async with AgentSession() as session:
            context = self.context(session)
            result = await guide.create_task(context, "Design homepage", stage="Build")
        self.assertTrue(result["saved"])
        self.assertEqual(result["task"]["title"], "Design homepage")
        self.assertEqual(result["task"]["stage"], "Build")

    async def test_already_interrupted_or_onboarding_never_reaches_browser(self):
        publish, create, stop = AsyncMock(), AsyncMock(), Mock()
        async with AgentSession() as session:
            context = self.context(session)
            context.speech_handle.interrupt(force=True)
            guide = LaunchpadGuide(GuideTools(publish, mode="help", create_task=create), "help", SimpleNamespace(stop=stop))
            self.assertEqual(await guide.create_task(context, "Design homepage"), {"status": "interrupted", "saved": False})
            guide = LaunchpadGuide(GuideTools(publish, create_task=create), "onboarding", SimpleNamespace(stop=stop))
            with self.assertRaisesRegex(ToolError, "saved project"):
                await guide.create_task(self.context(session), "Design homepage")
        create.assert_not_awaited()
        publish.assert_not_awaited()
        stop.assert_not_called()

    async def test_failed_commit_is_a_tool_error_and_does_not_disclose_transport(self):
        async def rpc(**_options):
            raise ConnectionError("private-provider-details")
        browser = BrowserActions(rpc, "bound-member", lambda: True)
        guide = LaunchpadGuide(GuideTools(AsyncMock(), mode="help", create_task=browser.create_task), "help")
        async with AgentSession() as session:
            with self.assertRaisesRegex(ToolError, "unconfirmed") as caught:
                await guide.create_task(self.context(session), "Design homepage")
        self.assertNotIn("private-provider-details", str(caught.exception))

    async def test_move_disables_interruptions_stops_tour_and_returns_committed_receipt(self):
        events = []
        async def publish(event):
            events.append(event)
        async def rpc(**options):
            self.assertFalse(context.speech_handle.allow_interruptions)
            self.assertEqual(events, ["tour_stopped", {"type": "cancel_actions"}])
            request = json.loads(options["payload"])
            self.assertEqual((request["title"], request["fromStage"], request["stage"]), ("design homepage", "Brief", "Review"))
            return json.dumps({"version": 1, "requestId": request["requestId"], "applied": True,
                               "task": {"id": TASK_ID, "title": "Design homepage", "fromStage": "Brief", "stage": "Review"}})
        browser = BrowserActions(rpc, "bound-member", lambda: True)
        operations = GuideTools(publish, mode="help", move_task=browser.move_task)
        guide = LaunchpadGuide(operations, "help", SimpleNamespace(stop=lambda: events.append("tour_stopped")))
        async with AgentSession() as session:
            context = self.context(session, "move_task")
            result = await guide.move_task(context, "design homepage", "Review", "Brief")
        self.assertEqual(result["status"], "moved")
        self.assertEqual(result["task"], {"id": TASK_ID, "title": "Design homepage", "fromStage": "Brief", "stage": "Review"})

    async def test_move_already_interrupted_or_onboarding_never_reaches_browser(self):
        publish, move, stop = AsyncMock(), AsyncMock(), Mock()
        async with AgentSession() as session:
            context = self.context(session, "move_task")
            context.speech_handle.interrupt(force=True)
            guide = LaunchpadGuide(GuideTools(publish, mode="help", move_task=move), "help", SimpleNamespace(stop=stop))
            self.assertEqual(await guide.move_task(context, "Design homepage", "Review"), {"status": "interrupted", "saved": False})
            for experience in ("setup", "tour", "qa"):
                guide = LaunchpadGuide(GuideTools(publish, experience=experience, move_task=move), "onboarding", SimpleNamespace(stop=stop))
                with self.subTest(experience=experience), self.assertRaisesRegex(ToolError, "saved project"):
                    await guide.move_task(self.context(session, "move_task"), "Design homepage", "Review")
        move.assert_not_awaited()
        publish.assert_not_awaited()
        stop.assert_not_called()

    async def test_failed_move_is_a_tool_error_and_does_not_disclose_transport(self):
        async def rpc(**_options):
            raise ConnectionError("private-provider-details")
        browser = BrowserActions(rpc, "bound-member", lambda: True)
        guide = LaunchpadGuide(GuideTools(AsyncMock(), mode="help", move_task=browser.move_task), "help")
        async with AgentSession() as session:
            with self.assertRaisesRegex(ToolError, "unconfirmed") as caught:
                await guide.move_task(self.context(session, "move_task"), "Design homepage", "Review")
        self.assertNotIn("private-provider-details", str(caught.exception))

    async def test_concurrent_second_write_never_publishes_cancel_over_an_in_flight_write(self):
        for first, second, busy in [("create_task", "move_task", MOVE_ERRORS["busy"]),
                                    ("move_task", "create_task", TASK_ERRORS["busy"]),
                                    ("create_task", "create_task", TASK_ERRORS["busy"])]:
            published, sent = [], []
            entered, release, transport_cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()
            async def publish(event):
                await asyncio.sleep(0)  # A real data-packet publish yields to other tool calls.
                published.append(event)
            async def rpc(**options):
                request = json.loads(options["payload"])
                sent.append(options["method"])
                entered.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    transport_cancelled.set()
                    raise
                task = {"id": TASK_ID, "title": request["title"], "stage": request["stage"]}
                if "fromStage" in request:
                    task["fromStage"] = "Brief"
                return json.dumps({"version": 1, "requestId": request["requestId"], "applied": True, "task": task})
            browser = BrowserActions(rpc, "bound-member", lambda: True)
            guide = LaunchpadGuide(GuideTools(publish, mode="help", create_task=browser.create_task,
                                              move_task=browser.move_task), "help")
            call = {"create_task": lambda context: guide.create_task(context, "Design homepage"),
                    "move_task": lambda context: guide.move_task(context, "Design homepage", "Review")}
            async with AgentSession() as session:
                # Same batch: the second call starts before the first reaches its RPC.
                pending = asyncio.create_task(call[first](self.context(session, first)))
                await asyncio.sleep(0)
                with self.subTest(first=first, second=second, phase="before_rpc"), self.assertRaises(ToolError) as caught:
                    await call[second](self.context(session, second))
                self.assertEqual(str(caught.exception), busy)
                await entered.wait()
                # Later turn: the first write is waiting on its browser receipt.
                with self.subTest(first=first, second=second, phase="during_rpc"), self.assertRaises(ToolError) as caught:
                    await call[second](self.context(session, second))
                self.assertEqual(str(caught.exception), busy)
                self.assertEqual(published, [{"type": "cancel_actions"}])
                release.set()
                self.assertTrue((await pending)["saved"])
                self.assertFalse(transport_cancelled.is_set())
                self.assertEqual(len(sent), 1)
                # The slot is released after the receipt, and a busy rejection never locks out.
                self.assertTrue((await call[second](self.context(session, second)))["saved"])
                self.assertEqual(published, [{"type": "cancel_actions"}] * 2)


class ToolReplyPolicyTests(unittest.TestCase):
    def event(self, *outputs):
        calls = [FunctionCall(call_id=f"call-{index}", name=name, arguments="{}") for index, (name, _, _) in enumerate(outputs)]
        results = [FunctionCallOutput(call_id=f"call-{index}", name=name, output="{}", is_error=error, reply_required=reply)
                   for index, (name, reply, error) in enumerate(outputs)]
        return FunctionToolsExecutedEvent(function_calls=calls, function_call_outputs=results)

    def test_prepared_narration_owns_reply_unless_a_write_shares_the_batch(self):
        cases = [
            ((("show_feature", False, False), ("lookup_product_docs", True, False)), False),
            ((("start_walkthrough", False, False),), False),
            ((("show_feature", False, False), ("create_task", True, False)), True),
            ((("start_walkthrough", False, False), ("move_task", True, False)), True),
            ((("show_feature", False, False), ("move_task", True, True)), True),
            ((("show_feature", False, True), ("lookup_product_docs", True, False)), True),
            ((("show_feature", True, False),), True),
            ((("create_task", True, False),), True),
            ((("move_task", True, False), ("lookup_product_docs", True, False)), True),
        ]
        for outputs, keeps_reply in cases:
            event = self.event(*outputs)
            apply_tool_reply_policy(event)
            with self.subTest(outputs=outputs):
                self.assertEqual(event.has_tool_reply, keeps_reply)
