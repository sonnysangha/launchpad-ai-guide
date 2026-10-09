"""Real installed SDK/schema checks; no model, LiveKit, or Synthesia calls."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
import agent
from config import load_environment
from guide_core import GuideTools, ValidationError
from livekit.agents.llm.utils import build_legacy_openai_schema, build_strict_openai_schema, function_arguments_to_pydantic_model
from test_guide_core import SECRET, metadata


class InstalledSDKTests(unittest.TestCase):
    def test_registered_tools_compile_to_real_provider_schemas(self):
        async def publish(event): pass
        guide = agent.LaunchpadGuide(GuideTools(publish), "onboarding")
        self.assertEqual({tool.info.name for tool in guide.tools}, {"update_draft", "highlight_step", "lookup_product_docs", "navigate_demo_tab", "start_walkthrough", "stop_walkthrough", "show_feature", "create_task", "move_task"})
        for tool in guide.tools:
            for schema in (build_legacy_openai_schema(tool), build_strict_openai_schema(tool)):
                self.assertEqual(schema["function"]["name"], tool.info.name)
                self.assertIsInstance(schema["function"]["parameters"], dict)
        draft = next(tool for tool in guide.tools if tool.info.name == "update_draft")
        model = function_arguments_to_pydantic_model(draft)
        with self.assertRaises(ValueError):
            model.model_validate({"workflow": "send-payments"})
        self.assertEqual(model.model_validate({"workflow": "campaign"}).workflow, "campaign")
        navigation = next(tool for tool in guide.tools if tool.info.name == "navigate_demo_tab")
        navigation_model = function_arguments_to_pydantic_model(navigation)
        for tab in ("overview", "workflow", "roles", "handbook"):
            self.assertEqual(navigation_model.model_validate({"tab": tab}).tab, tab)
        with self.assertRaises(ValueError):
            navigation_model.model_validate({"tab": "billing"})
        walkthrough = next(tool for tool in guide.tools if tool.info.name == "start_walkthrough")
        walkthrough_model = function_arguments_to_pydantic_model(walkthrough)
        self.assertEqual(walkthrough_model.model_validate({}).start_from, "continue")
        with self.assertRaises(ValueError):
            walkthrough_model.model_validate({"start_from": "create"})
        task = next(tool for tool in guide.tools if tool.info.name == "create_task")
        task_model = function_arguments_to_pydantic_model(task)
        self.assertEqual(task_model.model_validate({"title": "Design homepage"}).stage, "Brief")
        self.assertEqual(task_model.model_validate({"title": "Design homepage"}).description, "")
        self.assertNotIn("context", task_model.model_fields)
        for stage in ("delete", "review", None):
            with self.assertRaises(ValueError):
                task_model.model_validate({"title": "Design homepage", "stage": stage})
        move = next(tool for tool in guide.tools if tool.info.name == "move_task")
        move_model = function_arguments_to_pydantic_model(move)
        self.assertEqual(set(move_model.model_fields), {"title", "stage", "from_stage"})
        self.assertTrue(move_model.model_fields["stage"].is_required())
        self.assertIsNone(move_model.model_validate({"title": "Design homepage", "stage": "Review"}).from_stage)
        self.assertEqual(move_model.model_validate({"title": "Design homepage", "stage": "Review", "from_stage": "Brief"}).from_stage, "Brief")
        for arguments in ({"title": "Design homepage"}, {"title": "Design homepage", "stage": "review"},
                          {"title": "Design homepage", "stage": None},
                          {"title": "Design homepage", "stage": "Review", "from_stage": "archive"}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                move_model.model_validate(arguments)
        self.assertEqual(build_strict_openai_schema(move)["function"]["parameters"]["required"], ["title", "stage", "from_stage"])
        self.assertEqual(build_legacy_openai_schema(move)["function"]["parameters"]["required"], ["title", "stage"])

    def test_environment_loader_does_not_import_clerk_or_unrelated_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "agent").mkdir()
            (root / ".env.local").write_text("LIVEKIT_URL=wss://test.example\nLAUNCHPAD_AGENT_SECRET=test-only\nCLERK_SECRET_KEY=never-import\nUNRELATED_TOKEN=never-import\n")
            (root / "agent" / ".env").write_text("SYNTHESIA_AVATAR_ID=test-avatar\nOPENAI_API_KEY=test-key\nPATH=never-import\n")
            environment = {}
            load_environment(root, environment)
            self.assertEqual(set(environment), {"LIVEKIT_URL", "LAUNCHPAD_AGENT_SECRET", "SYNTHESIA_AVATAR_ID", "OPENAI_API_KEY"})


class DispatchAcceptanceTests(unittest.IsolatedAsyncioTestCase):
    async def test_demonstrated_faq_sources_explain_supported_feature(self):
        published = []
        async def publish(event):
            published.append(event)
        async def action(kind, target):
            return {"status": "applied", "kind": kind, "target": target, "saved": False}
        operations = GuideTools(publish, mode="help", experience="qa", perform_action=action)
        guide = agent.LaunchpadGuide(operations, "help")
        for target, source in [("workflow", "workflows"), ("roles", "roles"), ("handoff", "board-stages")]:
            with self.subTest(target=target):
                result = await guide.show_feature("faq", target)
                self.assertEqual(result["action"]["status"], "applied")
                self.assertEqual(result["grounding"]["status"], "documented")
                self.assertEqual(result["grounding"]["sources"][0]["id"], source)
        self.assertFalse(any(event["type"] == "draft" for event in published))

    def request(self, envelope):
        return SimpleNamespace(job=SimpleNamespace(metadata=envelope), room=SimpleNamespace(name="launchpad-unit-test"), accept=AsyncMock(), reject=AsyncMock())

    async def test_live_backend_status_required_before_accept(self):
        request = self.request(metadata(expiresAt=int(time.time()) + 300))
        with patch.dict(os.environ, {"LAUNCHPAD_AGENT_SECRET": SECRET}), patch.object(agent, "validate_session", return_value=int(time.time()) + 800) as check:
            await agent.request_job(request)
        check.assert_called_once()
        request.accept.assert_awaited_once_with(identity="launchpad-guide", name="Launchpad guide")
        request.reject.assert_not_awaited()

    async def test_ended_session_or_bad_signature_never_accepts(self):
        request = self.request(metadata(expiresAt=int(time.time()) + 300))
        with patch.dict(os.environ, {"LAUNCHPAD_AGENT_SECRET": SECRET}), patch.object(agent, "validate_session", side_effect=ValidationError("ended")):
            await agent.request_job(request)
        request.accept.assert_not_awaited()
        request.reject.assert_awaited_once()
        request = self.request("invalid-envelope")
        with patch.dict(os.environ, {"LAUNCHPAD_AGENT_SECRET": SECRET}), patch.object(agent, "validate_session") as check:
            await agent.request_job(request)
        check.assert_not_called()
        request.accept.assert_not_awaited()
        request.reject.assert_awaited_once()
