import base64
import hashlib
import hmac
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from guide_core import GuideTools, ProductDocs, ValidationError, task_reference_key, validate_move, validate_patch, verify_dispatch
from preflight import REQUIRED, check_environment

SECRET = "unit-test-only-not-a-real-key-000000000"


def metadata(**changes):
    claims = {"v": 1, "userId": "user_test", "participantIdentity": "user_test-session", "roomName": "launchpad-unit-test",
              "expiresAt": 1200, "mode": "onboarding", "draft": {"workspaceName": "Orbit Studio"}}
    claims.update(changes)
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return json.dumps({"payload": payload, "signature": signature})


class DispatchTests(unittest.TestCase):
    def test_accepts_authenticated_room_binding(self):
        result = verify_dispatch(metadata(), SECRET, "launchpad-unit-test", now=1000)
        self.assertEqual(result["participantIdentity"], "user_test-session")
        self.assertEqual(result["experience"], "setup")

    def test_experience_is_validated_and_legacy_mode_defaults_are_safe(self):
        self.assertEqual(verify_dispatch(metadata(mode="help"), SECRET, "launchpad-unit-test", now=1000)["experience"], "qa")
        for experience in ("setup", "tour", "qa"):
            self.assertEqual(verify_dispatch(metadata(experience=experience), SECRET, "launchpad-unit-test", now=1000)["experience"], experience)
        for changes in ({"experience": "admin"}, {"experience": None}, {"unexpected": "navigation"}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                verify_dispatch(metadata(**changes), SECRET, "launchpad-unit-test", now=1000)

    def test_rejects_tampering_expiry_room_and_reserved_identity(self):
        bad_envelope = json.loads(metadata())
        bad_envelope["signature"] = "a" * 43
        cases = [json.dumps(bad_envelope), metadata(expiresAt=999), metadata(expiresAt=1601),
                 metadata(roomName="another-room"), metadata(participantIdentity="launchpad-guide"),
                 metadata(mode="admin"), metadata(draft={"ownerId": "someone-else"}), metadata(expiresAt=True), metadata(v=True)]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValidationError):
                verify_dispatch(case, SECRET, "launchpad-unit-test", now=1000)

    def test_rejects_malformed_without_disclosing_value(self):
        for value in ("sensitive-value", "[]", "{}", "null"):
            with self.subTest(value=value), self.assertRaises(ValidationError) as caught:
                verify_dispatch(value, SECRET, "launchpad-unit-test", now=1000)
            self.assertNotIn("sensitive-value", str(caught.exception))


class ProductDocsTests(unittest.TestCase):
    def setUp(self):
        self.docs = ProductDocs()

    def test_six_versioned_sources_are_readable(self):
        self.assertEqual(len(self.docs.documents), 6)
        for doc in self.docs.documents:
            self.assertEqual(doc.version, {"first-project": "1.1.0", "board-stages": "1.2.0", "limits": "1.2.0"}.get(doc.id, "1.0.0"))
            self.assertGreater(len(doc.content), 100)

    def test_workflow_answer_has_traceable_evidence(self):
        result = self.docs.lookup("How do I choose a workflow between Client Delivery and Campaign?")
        self.assertEqual(result["status"], "documented")
        self.assertEqual(result["sources"][0]["id"], "workflows")
        self.assertIn("Brief, Build, Review, and Handoff", result["sources"][0]["excerpt"])

    def test_unknown_and_unsupported_differ(self):
        unknown = self.docs.lookup("What is the weather in London?")
        self.assertEqual(unknown["status"], "unknown")
        self.assertEqual(unknown["sources"], [])
        unsupported = self.docs.lookup("Can I export my project as CSV?")
        self.assertEqual(unsupported["status"], "limited")
        self.assertEqual(unsupported["sources"][0]["id"], "limits")

    def test_moving_a_task_is_documented_not_unsupported(self):
        for query in ("How do I move a task to Review?", "Can you keep moving tasks between stages?"):
            with self.subTest(query=query):
                result = self.docs.lookup(query)
                self.assertEqual(result["status"], "documented")
                self.assertEqual(result["sources"][0]["id"], "board-stages")
                self.assertIn("Move task", result["sources"][0]["excerpt"])
        limits = next(doc for doc in self.docs.documents if doc.id == "limits")
        # Any limits keyword short-circuits to "unsupported", so supported writes stay out of it.
        self.assertTrue({"move", "moves", "moving", "edit", "delete", "task", "tasks"}.isdisjoint(limits.keywords))
        self.assertIn("cannot rename, edit, delete, assign, or reorder tasks", limits.content)
        self.assertEqual(self.docs.lookup("Can I export my project as CSV?")["status"], "limited")

    def test_irrelevant_question_does_not_gain_evidence_from_brand_name(self):
        self.assertEqual(self.docs.lookup("What is Launchpad's quantum accuracy?")["status"], "unknown")

    def test_spoken_plural_invites_resolves_to_the_limits_source(self):
        result = self.docs.lookup("Can you send real invites?")
        self.assertEqual(result["status"], "limited")
        self.assertEqual(result["sources"][0]["id"], "limits")

    def test_source_packets_fit_frontend_limits(self):
        for doc in self.docs.documents:
            self.assertLessEqual(len(doc.content), 2000)
            self.assertLessEqual(len(json.dumps({"type": "source", **doc.source()}).encode()), 8192)

    def test_current_project_navigation_has_grounded_supported_answers(self):
        cases = [('How do Board and List show task rows?', 'board-stages', 'saved tasks'),
                 ('How does the unsaved project Preview work?', 'first-project', 'Preview is unsaved'),
                 ('What does the People permission inspector do?', 'roles', 'only the current signed-in account'),
                 ('How do I search Help center answers?', 'workspace', 'searchable answers')]
        for query, doc_id, fact in cases:
            with self.subTest(query=query):
                result = self.docs.lookup(query)
                self.assertEqual(result['status'], 'documented')
                source = next(item for item in result['sources'] if item['id'] == doc_id)
                self.assertIn(fact, source['excerpt'])


class MoveValidationTests(unittest.TestCase):
    def test_reference_key_ignores_case_spacing_punctuation_and_compatibility_forms(self):
        for spoken, saved in [("design homepage", "Design Homepage!"), ("ＤＥＳＩＧＮ　homepage", "Design-homepage"),
                              ("Café ① launch", "cafe\u0301 1 Launch"), ("ﬁx  bug", "Fix bug.")]:
            with self.subTest(spoken=spoken):
                self.assertEqual(task_reference_key(spoken), task_reference_key(saved))
        self.assertEqual(task_reference_key("Q4: Launch 😀 plan"), "q4launchplan")
        self.assertNotEqual(task_reference_key("Design homepage"), task_reference_key("Design homepage 2"))

    def test_accepts_one_title_destination_and_optional_current_stage(self):
        self.assertEqual(validate_move(" Design homepage ", "Review"),
                         {"title": "Design homepage", "stage": "Review", "from_stage": None})
        self.assertEqual(validate_move("😀" * 118 + "Q4", "Brief", "Handoff"),
                         {"title": "😀" * 118 + "Q4", "stage": "Brief", "from_stage": "Handoff"})

    def test_rejects_invalid_titles_stages_and_no_op_moves(self):
        invalid = [("x", "Review", None), ("😀" * 121, "Review", None), ("Task\x00", "Review", None),
                   ("Task\u200b", "Review", None), ("Task\ud800", "Review", None), (None, "Review", None),
                   (["Task"], "Review", None), ("Task", "review", None), ("Task", "Delete", None),
                   ("Task", None, None), ("Task", ["Review"], None), ("Task", "Review", "brief"),
                   ("Task", "Review", ""), ("Task", "Review", "Review"), ("Task", "Review", ["Brief"]),
                   ("😀😀", "Review", None), ("!!", "Review", None)]
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(ValidationError):
                validate_move(*args)


class ToolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = []
        async def publish(event):
            self.events.append(event)
        self.publish = publish
        self.tools = GuideTools(publish)

    async def test_updates_only_requested_fields_and_never_saves(self):
        await self.tools.update_draft({"workspaceName": " Orbit Studio "})
        result = await self.tools.update_draft({"projectName": "Mars launch", "workflow": "campaign"})
        self.assertEqual(result["draft"]["workspaceName"], "Orbit Studio")
        self.assertFalse(result["saved"])
        self.assertEqual(set(self.events[-1]["patch"]), {"projectName", "workflow"})

    async def test_bad_input_publishes_nothing(self):
        for patch in ({"workspaceName": "x"}, {"projectName": "a" * 81}, {"workflow": "payments"},
                      {"workspaceName": "hello\x00world"}, {"ownerId": "other"}, {}):
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                await self.tools.update_draft(patch)
        self.assertEqual(self.events, [])

    async def test_help_cannot_mutate_a_project(self):
        tools = GuideTools(self.publish, mode="help")
        with self.assertRaises(ValidationError):
            await tools.update_draft({"projectName": "Replacement"})
        self.assertEqual(self.events, [])

    async def test_task_creation_is_available_in_saved_project_for_every_experience(self):
        receipt = {"status": "created", "saved": True,
                   "task": {"id": "test-receipt", "title": "Design homepage", "stage": "Brief"}}
        for experience in ("setup", "tour", "qa"):
            create = AsyncMock(return_value=receipt)
            tools = GuideTools(self.publish, mode="help", experience=experience,
                               draft={"projectName": "Preserve project"}, create_task=create)
            result = await tools.create_task(" Design homepage ")
            self.assertEqual(result, receipt)
            create.assert_awaited_once_with(title="Design homepage", description="", stage="Brief")
            self.assertEqual(tools.draft, {"projectName": "Preserve project"})
        self.assertEqual(self.events, [])

    async def test_task_creation_before_saved_project_or_with_invalid_fields_never_calls_transport(self):
        create = AsyncMock()
        for experience in ("setup", "tour", "qa"):
            tools = GuideTools(self.publish, experience=experience, create_task=create)
            with self.assertRaisesRegex(ValidationError, "saved project"):
                await tools.create_task("Design homepage")
        with self.assertRaises(ValidationError):
            await GuideTools(self.publish, mode="help", create_task=create).create_task("x")
        with self.assertRaisesRegex(ValidationError, "unavailable"):
            await GuideTools(self.publish, mode="help").create_task("Design homepage")
        create.assert_not_awaited()
        self.assertEqual(self.events, [])

    async def test_task_move_is_available_in_saved_project_for_every_experience(self):
        receipt = {"status": "moved", "saved": True,
                   "task": {"id": "test-receipt", "title": "Design homepage", "fromStage": "Brief", "stage": "Review"}}
        for experience in ("setup", "tour", "qa"):
            move = AsyncMock(return_value=receipt)
            tools = GuideTools(self.publish, mode="help", experience=experience,
                               draft={"projectName": "Preserve project"}, move_task=move)
            self.assertEqual(await tools.move_task(" Design homepage ", "Review"), receipt)
            move.assert_awaited_once_with(title="Design homepage", stage="Review", from_stage=None)
            await tools.move_task("Design homepage", "Build", "Review")
            move.assert_awaited_with(title="Design homepage", stage="Build", from_stage="Review")
            self.assertEqual(tools.draft, {"projectName": "Preserve project"})
        self.assertEqual(self.events, [])

    async def test_task_move_before_saved_project_or_with_invalid_fields_never_calls_transport(self):
        move = AsyncMock()
        for experience in ("setup", "tour", "qa"):
            tools = GuideTools(self.publish, experience=experience, move_task=move)
            with self.assertRaisesRegex(ValidationError, "saved project"):
                await tools.move_task("Design homepage", "Review")
        tools = GuideTools(self.publish, mode="help", move_task=move)
        for args in (("x", "Review"), ("Design homepage", "Delete"), ("Design homepage", "Review", "Review")):
            with self.subTest(args=args), self.assertRaises(ValidationError):
                await tools.move_task(*args)
        with self.assertRaisesRegex(ValidationError, "unavailable"):
            await GuideTools(self.publish, mode="help", create_task=AsyncMock()).move_task("Design homepage", "Review")
        move.assert_not_awaited()
        self.assertEqual(self.events, [])

    async def test_tour_and_qa_cannot_mutate_an_unsaved_draft(self):
        for experience in ("tour", "qa"):
            with self.subTest(experience=experience), self.assertRaises(ValidationError):
                await GuideTools(self.publish, experience=experience).update_draft({"projectName": "Replacement"})
        self.assertEqual(self.events, [])

    async def test_failed_delivery_keeps_draft_unchanged(self):
        async def failure(event):
            raise ConnectionError("offline")
        tools = GuideTools(failure)
        with self.assertRaises(ConnectionError):
            await tools.update_draft({"projectName": "Mars launch"})
        self.assertEqual(tools.draft, {})

    async def test_highlight_and_source_have_known_schema(self):
        await self.tools.highlight_step("roles")
        await self.tools.lookup_product_docs("What are the roles?")
        self.assertEqual(self.events[0], {"type": "highlight", "step": "roles"})
        self.assertEqual(set(self.events[1]), {"type", "id", "title", "version", "excerpt"})
        self.assertEqual(self.events[1]["id"], "roles")
        with self.assertRaises(ValidationError):
            await self.tools.highlight_step("publish")

    async def test_navigation_changes_only_the_view_even_in_help(self):
        tools = GuideTools(self.publish, mode="help", experience="tour", draft={"projectName": "Saved sample"})
        for tab in ("overview", "workflow", "roles", "handbook"):
            result = await tools.navigate_demo_tab(tab)
            self.assertEqual(self.events[-1], {"type": "navigate", "tab": tab})
            self.assertEqual(result["tab"], tab)
            self.assertFalse(result["saved"])
        self.assertEqual(tools.draft, {"projectName": "Saved sample"})
        with self.assertRaises(ValidationError):
            await tools.update_draft({"projectName": "Do not save"})

    async def test_navigation_rejects_unknown_tabs_and_delivery_failures(self):
        for tab in ("billing", "../admin", None):
            with self.subTest(tab=tab), self.assertRaises(ValidationError):
                await self.tools.navigate_demo_tab(tab)
        self.assertEqual(self.events, [])
        async def fail(event):
            raise ConnectionError("offline")
        with self.assertRaises(ConnectionError):
            await GuideTools(fail).navigate_demo_tab("workflow")

    async def test_follow_up_context_comes_from_acknowledged_feature_and_keeps_workflow_order(self):
        async def applied(kind, target):
            return {"status": "applied", "kind": kind, "target": target, "saved": False}
        tools = GuideTools(self.publish, mode="help", perform_action=applied)
        for stage, following in (("brief", "Build"), ("build", "Review"), ("review", "Handoff"), ("handoff", None)):
            action = await tools.perform_demo_action("stage", stage)
            self.assertEqual(action["last_demonstrated_feature"], {"kind": "stage", "target": stage,
                             "stage": stage.capitalize(), "next_stage": following, "view": "List", "changed": "visible_filter_only"})
            sources = await tools.lookup_product_docs("How does this workflow stage work?")
            self.assertEqual(sources["last_demonstrated_feature"], action["last_demonstrated_feature"])
        previous = dict(tools.last_demonstration)
        tools.perform_action = AsyncMock(side_effect=ValidationError("unconfirmed"))
        with self.assertRaises(ValidationError):
            await tools.perform_demo_action("stage", "brief")
        self.assertEqual(tools.last_demonstration, previous)

    async def test_changed_feature_or_new_task_replaces_previous_stage_context(self):
        async def applied(kind, target):
            return {"status": "applied", "kind": kind, "target": target}
        tools = GuideTools(self.publish, mode="help", perform_action=applied,
                           create_task=AsyncMock(return_value={"saved": True, "task": {"title": "New task", "stage": "Brief"}}))
        await tools.perform_demo_action("stage", "review")
        await tools.perform_demo_action("role", "owner")
        self.assertEqual(tools.last_demonstration, {"kind": "role", "target": "owner"})
        await tools.create_task("New task")
        self.assertIsNone(tools.last_demonstration)

    async def test_saved_move_replaces_previous_context_but_rejection_keeps_it(self):
        async def applied(kind, target):
            return {"status": "applied", "kind": kind, "target": target}
        move = AsyncMock(side_effect=[ValidationError("not found"), {"saved": False}, {"saved": True}])
        tools = GuideTools(self.publish, mode="help", perform_action=applied, move_task=move)
        await tools.perform_demo_action("role", "owner")
        with self.assertRaises(ValidationError):
            await tools.move_task("Design homepage", "Review")
        await tools.move_task("Design homepage", "Review")
        self.assertEqual(tools.last_demonstration, {"kind": "role", "target": "owner"})
        await tools.move_task("Design homepage", "Review")
        self.assertIsNone(tools.last_demonstration)


class PreflightTests(unittest.TestCase):
    def test_reports_names_only(self):
        self.assertEqual(check_environment({})["missing"], list(REQUIRED))
        env = {name: "private-never-output" for name in REQUIRED}
        result = check_environment(env)
        self.assertFalse(result["configured"])
        self.assertNotIn("private-never-output", json.dumps(result))

    def test_blank_values_are_missing(self):
        self.assertIn("SYNTHESIA_AVATAR_ID", check_environment({"SYNTHESIA_AVATAR_ID": " "})["missing"])


if __name__ == "__main__":
    unittest.main()
