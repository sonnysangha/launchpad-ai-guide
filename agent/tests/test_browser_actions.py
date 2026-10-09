import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser_actions import (BrowserActions, CREATE_TASK_METHOD, METHOD, MOVE_ERRORS, MOVE_TASK_METHOD, TASK_ERRORS,
                             UNCONFIRMED_WRITE, is_user_navigation)
from guide_core import ValidationError


class BrowserActionsTests(unittest.IsolatedAsyncioTestCase):
    def test_manual_takeover_requires_bound_participant_and_allowlisted_marker(self):
        data = b'{"type":"user_navigation","target":"nav-workflow"}'
        self.assertTrue(is_user_navigation(data, 'launchpad.ui', 'owner', 'owner'))
        for marker in ('project-home', 'task-search-clear', 'task-new', 'task-save'):
            packet = json.dumps({'type': 'user_navigation', 'target': marker}).encode()
            self.assertTrue(is_user_navigation(packet, 'launchpad.ui', 'owner', 'owner'))
            self.assertFalse(is_user_navigation(packet, 'launchpad.ui', 'other', 'owner'))
        for packet, topic, sender in [(data, 'launchpad.ui', 'other'), (data, 'launchpad.ui', None),
                                     (data, 'other', 'owner'), (b'{}', 'launchpad.ui', 'owner'),
                                     (b'{"type":"user_navigation","target":"create"}', 'launchpad.ui', 'owner'),
                                     (b'not json', 'launchpad.ui', 'owner')]:
            self.assertFalse(is_user_navigation(packet, topic, sender, 'owner'))

    def test_manual_move_controls_are_user_navigation_but_not_remote_targets(self):
        markers = ('task-move', 'task-move-to-brief', 'task-move-to-build', 'task-move-to-review',
                   'task-move-to-handoff', 'task-move-save')
        for marker in markers:
            packet = json.dumps({'type': 'user_navigation', 'target': marker}).encode()
            self.assertTrue(is_user_navigation(packet, 'launchpad.ui', 'owner', 'owner'))
            self.assertFalse(is_user_navigation(packet, 'launchpad.ui', 'other', 'owner'))
        for marker in ('task-move-to-archive', 'task-move-to-Review', 'task-moved'):
            packet = json.dumps({'type': 'user_navigation', 'target': marker}).encode()
            self.assertFalse(is_user_navigation(packet, 'launchpad.ui', 'owner', 'owner'))

    async def test_move_markers_are_not_remote_action_targets(self):
        rpc = AsyncMock()
        actions = BrowserActions(rpc, 'signed-member', lambda: True)
        for kind, target in [('navigate', 'task-move'), ('stage', 'task-move-to-review'), ('task', 'move')]:
            with self.subTest(kind=kind, target=target), self.assertRaises(ValidationError):
                await actions.perform(kind, target)
        rpc.assert_not_awaited()

    async def test_binds_destination_and_waits_for_matching_applied_ack(self):
        calls = []
        async def rpc(**options):
            calls.append(options)
            request = json.loads(options['payload'])
            return json.dumps({'version': 1, 'actionId': request['actionId'], 'applied': True})
        result = await BrowserActions(rpc, 'signed-member', lambda: True).perform('stage', 'review')
        self.assertEqual(result, {'status': 'applied', 'kind': 'stage', 'target': 'review', 'saved': False})
        self.assertEqual(calls[0]['destination_identity'], 'signed-member')
        self.assertEqual(calls[0]['method'], METHOD)
        self.assertEqual(calls[0]['response_timeout'], 8)
        self.assertEqual(set(json.loads(calls[0]['payload'])), {'version', 'actionId', 'kind', 'target'})

    async def test_invalid_actions_and_absent_participant_never_send(self):
        rpc = AsyncMock()
        actions = BrowserActions(rpc, 'signed-member', lambda: True)
        for kind, target in [('stage', 'create'), ('role', 'review'), ('faq', 'payments'), ('navigate', 'project-home'), ('navigate', 'task-search-clear'), ('selector', '#delete'), (None, 'review')]:
            with self.subTest(kind=kind, target=target), self.assertRaises(ValidationError):
                await actions.perform(kind, target)
        with self.assertRaises(ValidationError):
            await BrowserActions(rpc, 'signed-member', lambda: False).perform('stage', 'review')
        rpc.assert_not_awaited()

    async def test_failed_stale_malformed_and_false_acks_are_safe_errors(self):
        for raw in ['private-provider-error', '{}', '{"version":1,"actionId":"stale","applied":true}', 'x' * 2049]:
            with self.subTest(raw=raw[:25]), self.assertRaises(ValidationError) as error:
                await BrowserActions(AsyncMock(return_value=raw), 'signed-member', lambda: True).perform('stage', 'review')
            self.assertNotIn('private-provider-error', str(error.exception))
        for applied in [False, 1, 'true']:
            async def rpc(**options):
                request = json.loads(options['payload'])
                return json.dumps({'version': 1, 'actionId': request['actionId'], 'applied': applied})
            with self.assertRaises(ValidationError):
                await BrowserActions(rpc, 'signed-member', lambda: True).perform('stage', 'review')

    async def test_timeout_cancels_transport_and_does_not_leak_details(self):
        cancelled = asyncio.Event()
        async def rpc(**_):
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
        with self.assertRaises(ValidationError):
            await BrowserActions(rpc, 'signed-member', lambda: True, timeout=.01).perform('stage', 'review')
        self.assertTrue(cancelled.is_set())

    async def test_caller_cancellation_propagates(self):
        entered = asyncio.Event()
        async def rpc(**_):
            entered.set()
            await asyncio.Future()
        task = asyncio.create_task(BrowserActions(rpc, 'signed-member', lambda: True).perform('stage', 'review'))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task


class TaskCreationTests(unittest.IsolatedAsyncioTestCase):
    task_id = "324ca4d5-67e9-4e43-b7cc-0dc5367950d7"

    def receipt(self, payload, **changes):
        result = {"version": 1, "requestId": payload["requestId"], "applied": True,
                  "task": {"id": self.task_id, "title": payload["title"], "stage": payload["stage"]}}
        return json.dumps({**result, **changes})

    async def test_creates_one_task_and_returns_only_committed_receipt(self):
        calls, logs = [], []
        present = True
        async def rpc(**options):
            nonlocal present
            calls.append(options)
            payload = json.loads(options["payload"])
            self.assertFalse(actions.in_flight)
            present = False  # Leaving immediately after commit does not undo it.
            return self.receipt(payload)
        actions = BrowserActions(rpc, "bound-member", lambda: present,
                                 observe=lambda event, **fields: logs.append((event, fields)))
        result = await actions.create_task(" Design homepage ", " Start with a wireframe ", "Build")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["destination_identity"], "bound-member")
        self.assertEqual(calls[0]["method"], CREATE_TASK_METHOD)
        self.assertEqual(calls[0]["response_timeout"], 15)
        request = json.loads(calls[0]["payload"])
        self.assertEqual(set(request), {"version", "requestId", "title", "description", "stage"})
        self.assertEqual(UUID(request["requestId"]).version, 4)
        self.assertEqual(request["description"], "Start with a wireframe")
        self.assertEqual(result, {"status": "created", "saved": True, "requestId": request["requestId"],
                                  "task": {"id": self.task_id, "title": "Design homepage", "stage": "Build"}})
        self.assertNotIn("Design homepage", json.dumps(logs))
        self.assertNotIn("Start with", json.dumps(logs))

    async def test_invalid_fields_and_absent_participant_never_write(self):
        rpc = AsyncMock()
        actions = BrowserActions(rpc, "bound-member", lambda: True)
        invalid = [("x", "", "Brief"), ("Task", "a" * 501, "Brief"), ("Task", "", "Delete"),
                   ("Task", "", []), ("Task\x00", "", "Brief"), ("Task", "secret\nvalue", "Brief"),
                   ("😀" * 121, "", "Brief"), ("Task", None, "Brief"), ("Task\ud800", "", "Brief")]
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(ValidationError):
                await actions.create_task(*args)
        with self.assertRaises(ValidationError):
            await BrowserActions(rpc, "bound-member", lambda: False).create_task("Design homepage")
        rpc.assert_not_awaited()

    async def test_known_rejections_do_not_claim_success_or_lock_out_safe_retry(self):
        for code in set(TASK_ERRORS) - {"outcome_unknown"}:
            calls = []
            async def rpc(**options):
                payload = json.loads(options["payload"])
                calls.append(payload)
                if len(calls) == 1:
                    return json.dumps({"version": 1, "requestId": payload["requestId"], "applied": False, "error": code})
                return self.receipt(payload)
            actions = BrowserActions(rpc, "member", lambda: True)
            with self.subTest(code=code), self.assertRaises(ValidationError):
                await actions.create_task("Design homepage")
            self.assertTrue((await actions.create_task("Design homepage"))["saved"])
            self.assertNotEqual(calls[0]["requestId"], calls[1]["requestId"])

    async def test_unknown_stale_or_malformed_receipt_blocks_further_writes(self):
        def invalid(payload):
            return ["private-provider-details", "x" * 2049, "{}",
                    self.receipt(payload, requestId="unrelated"), self.receipt(payload, version=True),
                    self.receipt(payload, applied=1), self.receipt(payload, extra="bad"),
                    self.receipt(payload, task={"id": self.task_id, "title": "Another task", "stage": "Brief"}),
                    self.receipt(payload, task={"id": self.task_id, "title": payload["title"], "stage": "Build"}),
                    self.receipt(payload, task={"id": "not-an-id", "title": payload["title"], "stage": "Brief"}),
                    json.dumps({"version": 1, "requestId": payload["requestId"], "applied": False, "error": "outcome_unknown"}),
                    json.dumps({"version": 1, "requestId": payload["requestId"], "applied": False, "error": "private-provider-details"})]
        for index in range(12):
            calls = []
            async def rpc(**options):
                calls.append(options)
                return invalid(json.loads(options["payload"]))[index]
            actions = BrowserActions(rpc, "member", lambda: True)
            with self.subTest(index=index), self.assertRaises(ValidationError) as caught:
                await actions.create_task("Design homepage")
            self.assertIn("unconfirmed", str(caught.exception))
            self.assertNotIn("private-provider-details", str(caught.exception))
            with self.assertRaises(ValidationError):
                await actions.create_task("Design homepage")
            self.assertEqual(len(calls), 1)

    async def test_concurrent_request_is_rejected_and_timeout_is_not_retried(self):
        entered = asyncio.Event()
        calls = []
        async def rpc(**options):
            calls.append(options)
            entered.set()
            await asyncio.Future()
        actions = BrowserActions(rpc, "member", lambda: True, task_timeout=.01)
        pending = asyncio.create_task(actions.create_task("Design homepage"))
        await entered.wait()
        with self.assertRaisesRegex(ValidationError, "Another dashboard action"):
            await actions.create_task("Second task")
        with self.assertRaisesRegex(ValidationError, "unconfirmed"):
            await pending
        with self.assertRaisesRegex(ValidationError, "unconfirmed"):
            await actions.create_task("Design homepage")
        self.assertEqual(len(calls), 1)

    async def test_shutdown_cancellation_blocks_repeating_unconfirmed_commit(self):
        entered = asyncio.Event()
        rpc = AsyncMock()
        async def transport(**options):
            await rpc(**options)
            entered.set()
            await asyncio.Future()
        actions = BrowserActions(transport, "member", lambda: True)
        pending = asyncio.create_task(actions.create_task("Design homepage"))
        await entered.wait()
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        with self.assertRaisesRegex(ValidationError, "unconfirmed"):
            await actions.create_task("Design homepage")
        self.assertEqual(rpc.await_count, 1)


class TaskMoveTests(unittest.IsolatedAsyncioTestCase):
    task_id = "324ca4d5-67e9-4e43-b7cc-0dc5367950d7"

    def receipt(self, payload, title="Design homepage", from_stage="Brief", **changes):
        result = {"version": 1, "requestId": payload["requestId"], "applied": True,
                  "task": {"id": self.task_id, "title": title, "fromStage": from_stage, "stage": payload["stage"]}}
        return json.dumps({**result, **changes})

    def rejection(self, payload, error, **extra):
        return json.dumps({"version": 1, "requestId": payload["requestId"], "applied": False, "error": error, **extra})

    async def test_moves_one_task_and_returns_only_committed_receipt(self):
        calls, logs = [], []
        present = True
        async def rpc(**options):
            nonlocal present
            calls.append(options)
            self.assertFalse(actions.in_flight)
            present = False  # Leaving immediately after commit does not undo it.
            return self.receipt(json.loads(options["payload"]), title="Design Homepage!")
        actions = BrowserActions(rpc, "bound-member", lambda: present,
                                 observe=lambda event, **fields: logs.append((event, fields)))
        result = await actions.move_task(" design homepage ", "Review")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["destination_identity"], "bound-member")
        self.assertEqual(calls[0]["method"], MOVE_TASK_METHOD)
        self.assertEqual(calls[0]["response_timeout"], 15)
        request = json.loads(calls[0]["payload"])
        self.assertEqual(request, {"version": 1, "requestId": request["requestId"], "title": "design homepage",
                                   "fromStage": None, "stage": "Review"})
        self.assertEqual(UUID(request["requestId"]).version, 4)
        self.assertEqual(result, {"status": "moved", "saved": True, "requestId": request["requestId"],
                                  "task": {"id": self.task_id, "title": "Design Homepage!", "fromStage": "Brief", "stage": "Review"}})
        self.assertEqual([event for event, _ in logs], ["task_move_requested", "task_moved"])
        self.assertNotIn("homepage", json.dumps(logs).lower())

    async def test_current_stage_is_sent_and_bound(self):
        calls = []
        async def rpc(**options):
            payload = json.loads(options["payload"])
            calls.append(payload)
            return self.receipt(payload, from_stage="Build")
        result = await BrowserActions(rpc, "member", lambda: True).move_task("Design homepage", "Handoff", "Build")
        self.assertEqual(calls[0]["fromStage"], "Build")
        self.assertEqual(result["task"]["fromStage"], "Build")

    async def test_invalid_fields_and_absent_participant_never_write(self):
        rpc = AsyncMock()
        actions = BrowserActions(rpc, "bound-member", lambda: True)
        invalid = [("x", "Review", None), ("Task", "review", None), ("Task", "Delete", None), ("Task", [], None),
                   ("Task\x00", "Review", None), ("😀" * 121, "Review", None), (None, "Review", None),
                   ("Task", "Review", "Review"), ("Task", "Review", "archive"), ("Task\ud800", "Review", None)]
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(ValidationError):
                await actions.move_task(*args)
        with self.assertRaises(ValidationError):
            await BrowserActions(rpc, "bound-member", lambda: False).move_task("Design homepage", "Review")
        rpc.assert_not_awaited()

    async def test_known_rejections_do_not_claim_success_or_lock_out_safe_retry(self):
        for code in set(MOVE_ERRORS) - {"outcome_unknown"}:
            calls, logs = [], []
            async def rpc(**options):
                payload = json.loads(options["payload"])
                calls.append(payload)
                if len(calls) == 1:
                    extra = {"stages": ["Brief", "Review"]} if code == "ambiguous" else {}
                    return self.rejection(payload, code, **extra)
                return self.receipt(payload)
            actions = BrowserActions(rpc, "member", lambda: True,
                                     observe=lambda event, **fields: logs.append((event, fields)))
            with self.subTest(code=code), self.assertRaises(ValidationError) as caught:
                await actions.move_task("Design homepage", "Review")
            self.assertTrue(str(caught.exception).startswith(MOVE_ERRORS[code]))
            self.assertIn(("task_move_rejected", {"request_id": calls[0]["requestId"], "code": code}), logs)
            self.assertTrue((await actions.move_task("Design homepage", "Review"))["saved"])
            self.assertNotEqual(calls[0]["requestId"], calls[1]["requestId"])
            self.assertNotIn("homepage", json.dumps(logs).lower())

    async def test_not_found_names_the_current_stage_only_when_one_was_given(self):
        async def rpc(**options):
            return self.rejection(json.loads(options["payload"]), "not_found")
        actions = BrowserActions(rpc, "member", lambda: True)
        with self.assertRaises(ValidationError) as caught:
            await actions.move_task("Design homepage", "Review")
        self.assertEqual(str(caught.exception), MOVE_ERRORS["not_found"])
        with self.assertRaisesRegex(ValidationError, "^No task with that title is in Brief, so nothing moved"):
            await actions.move_task("Design homepage", "Review", "Brief")

    async def test_ambiguous_rejection_names_only_the_reported_stages(self):
        async def rpc(**options):
            payload = json.loads(options["payload"])
            stages = ["Review", "Brief"] if payload["fromStage"] is None else [payload["fromStage"]]
            return self.rejection(payload, "ambiguous", stages=stages)
        actions = BrowserActions(rpc, "member", lambda: True)
        with self.assertRaisesRegex(ValidationError, "in Brief and Review. Ask once which"):
            await actions.move_task("Design homepage", "Handoff")
        with self.assertRaisesRegex(ValidationError, "all in Brief; use Move task"):
            await actions.move_task("Design homepage", "Handoff", "Brief")

    async def test_unknown_stale_or_malformed_receipts_block_further_writes(self):
        task = lambda payload, **changes: {"id": self.task_id, "title": "Design homepage", "fromStage": "Brief",
                                           "stage": payload["stage"], **changes}
        cases = [
            (None, lambda p: "private-provider-details"), (None, lambda p: "x" * 2049), (None, lambda p: "{}"),
            (None, lambda p: self.receipt(p, requestId="unrelated")), (None, lambda p: self.receipt(p, version=True)),
            (None, lambda p: self.receipt(p, applied=1)), (None, lambda p: self.receipt(p, extra="bad")),
            (None, lambda p: self.receipt(p, title="Another task")),
            (None, lambda p: self.receipt(p, title="Design homepage" + "!" * 106)),
            (None, lambda p: self.receipt(p, title=None)),
            (None, lambda p: self.receipt(p, from_stage="Review")), (None, lambda p: self.receipt(p, from_stage="Archive")),
            (None, lambda p: self.receipt(p, from_stage=None)), (None, lambda p: self.receipt(p, from_stage=["Brief"])),
            ("Build", lambda p: self.receipt(p, from_stage="Brief")),
            (None, lambda p: self.receipt(p, task=task(p, stage="Handoff"))),
            (None, lambda p: self.receipt(p, task=task(p, id="not-an-id"))),
            (None, lambda p: self.receipt(p, task=task(p, id=self.task_id.upper()))),
            (None, lambda p: self.receipt(p, task=task(p, description="extra"))),
            (None, lambda p: self.receipt(p, task={"id": self.task_id, "title": "Design homepage", "stage": p["stage"]})),
            (None, lambda p: self.rejection(p, "outcome_unknown")),
            (None, lambda p: self.rejection(p, "private-provider-details")),
            (None, lambda p: self.rejection(p, "not_found", stages=["Brief"])),
            (None, lambda p: self.rejection(p, "ambiguous")),
            (None, lambda p: self.rejection(p, "ambiguous", stages=[])),
            (None, lambda p: self.rejection(p, "ambiguous", stages="Brief")),
            (None, lambda p: self.rejection(p, "ambiguous", stages=["Brief", "Brief"])),
            (None, lambda p: self.rejection(p, "ambiguous", stages=["Brief", "Archive"])),
            (None, lambda p: self.rejection(p, "ambiguous", stages=[["Brief"]])),
            ("Build", lambda p: self.rejection(p, "ambiguous", stages=["Brief"])),
            (None, lambda p: self.rejection(p, "ambiguous", stages=["Brief"], hint="extra")),
        ]
        for index, (from_stage, reply) in enumerate(cases):
            calls = []
            async def rpc(**options):
                calls.append(options)
                return reply(json.loads(options["payload"]))
            actions = BrowserActions(rpc, "member", lambda: True)
            with self.subTest(index=index), self.assertRaises(ValidationError) as caught:
                await actions.move_task("Design homepage", "Review", from_stage)
            self.assertEqual(str(caught.exception), MOVE_ERRORS["outcome_unknown"])
            for write in (actions.move_task("Design homepage", "Review"), actions.create_task("Design homepage")):
                with self.assertRaises(ValidationError) as locked:
                    await write
                self.assertEqual(str(locked.exception), UNCONFIRMED_WRITE)
            self.assertEqual(len(calls), 1)

    async def test_unknown_creation_blocks_moves_and_unknown_move_blocks_creation(self):
        async def unknown(**options):
            payload = json.loads(options["payload"])
            return self.rejection(payload, "outcome_unknown")
        actions = BrowserActions(unknown, "member", lambda: True)
        with self.assertRaisesRegex(ValidationError, "Task creation is unconfirmed"):
            await actions.create_task("Design homepage")
        with self.assertRaises(ValidationError) as caught:
            await actions.move_task("Design homepage", "Review")
        self.assertEqual(str(caught.exception), UNCONFIRMED_WRITE)
        actions = BrowserActions(unknown, "member", lambda: True)
        with self.assertRaisesRegex(ValidationError, "The move is unconfirmed"):
            await actions.move_task("Design homepage", "Review")
        with self.assertRaises(ValidationError) as caught:
            await actions.create_task("Design homepage")
        self.assertEqual(str(caught.exception), UNCONFIRMED_WRITE)
        self.assertNotIn("creation", UNCONFIRMED_WRITE.lower())

    async def test_concurrent_creation_and_move_share_one_busy_slot(self):
        for first, second, busy in [("create", "move", MOVE_ERRORS["busy"]), ("move", "create", TASK_ERRORS["busy"])]:
            entered, release, calls = asyncio.Event(), asyncio.Event(), []
            async def rpc(**options):
                payload = json.loads(options["payload"])
                calls.append(options["method"])
                entered.set()
                await release.wait()
                if options["method"] == MOVE_TASK_METHOD:
                    return self.receipt(payload)
                return json.dumps({"version": 1, "requestId": payload["requestId"], "applied": True,
                                   "task": {"id": self.task_id, "title": payload["title"], "stage": payload["stage"]}})
            actions = BrowserActions(rpc, "member", lambda: True)
            write = {"create": lambda: actions.create_task("Design homepage"),
                     "move": lambda: actions.move_task("Design homepage", "Review")}
            pending = asyncio.create_task(write[first]())
            await entered.wait()
            with self.subTest(first=first), self.assertRaises(ValidationError) as caught:
                await write[second]()
            self.assertEqual(str(caught.exception), busy)
            release.set()
            self.assertTrue((await pending)["saved"])
            self.assertTrue((await write[second]())["saved"])  # busy never locks out
            self.assertEqual(len(calls), 2)

    async def test_timeout_is_not_retried_and_locks_out(self):
        calls, logs = [], []
        async def rpc(**options):
            calls.append(options)
            await asyncio.Future()
        actions = BrowserActions(rpc, "member", lambda: True, task_timeout=.01,
                                 observe=lambda event, **fields: logs.append((event, fields)))
        with self.assertRaisesRegex(ValidationError, "The move is unconfirmed"):
            await actions.move_task("Design homepage", "Review")
        with self.assertRaisesRegex(ValidationError, "unconfirmed"):
            await actions.move_task("Design homepage", "Review")
        self.assertEqual(len(calls), 1)
        self.assertEqual([event for event, _ in logs], ["task_move_requested", "task_move_unconfirmed"])

    async def test_shutdown_cancellation_after_send_blocks_repeating_unconfirmed_move(self):
        entered = asyncio.Event()
        rpc = AsyncMock()
        async def transport(**options):
            await rpc(**options)
            entered.set()
            await asyncio.Future()
        actions = BrowserActions(transport, "member", lambda: True)
        pending = asyncio.create_task(actions.move_task("Design homepage", "Review"))
        await entered.wait()
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        for write in (actions.move_task("Design homepage", "Review"), actions.create_task("Design homepage")):
            with self.assertRaisesRegex(ValidationError, "unconfirmed"):
                await write
        self.assertEqual(rpc.await_count, 1)
