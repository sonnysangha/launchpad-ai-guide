"""Exercise the actual TypeScript signer/validator against the Python worker."""
import asyncio
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "agent" / "tests"))
from guide_core import ValidationError, task_reference_key, validate_move, validate_task, verify_dispatch
from browser_actions import CREATE_TASK_METHOD, MANUAL_TARGETS, MOVE_ERRORS, MOVE_TASK_METHOD, TARGETS, UI_TARGETS, BrowserActions
from test_guide_core import SECRET, metadata


class MetadataContractTests(unittest.TestCase):
    def test_task_rpc_and_unicode_field_validation_match_actual_browser_parser(self):
        cases = [("Design homepage", "", "Brief"), (" Landing page ", " Wireframes ", "Build"),
                 ("😀" * 120, "🚀" * 500, "Review"), ("x", "", "Brief"),
                 ("😀" * 121, "", "Brief"), ("Task", "x" * 501, "Brief"),
                 ("Task", "", "delete"), (" Task\n", "", "Brief"), ("Task", "a\u200bb", "Brief")]
        requests = [{"version": 1, "requestId": "1b6c59d1-9c29-416a-aa44-e889b97e113e",
                     "title": title, "description": description, "stage": stage} for title, description, stage in cases]
        result = self.run_typescript(
            "import {parseCreateTask,CREATE_TASK_METHOD} from './src/lib/task-actions.ts'; console.log(JSON.stringify({method:CREATE_TASK_METHOD,results:JSON.parse(process.argv[1]).map(x=>parseCreateTask(JSON.stringify(x)))}));",
            json.dumps(requests))
        self.assertEqual(result["method"], CREATE_TASK_METHOD)
        for args, parsed in zip(cases, result["results"]):
            try:
                clean = validate_task(*args)
            except ValidationError:
                self.assertIsNone(parsed)
            else:
                self.assertEqual({key: parsed[key] for key in clean}, clean)

    def test_all_browser_action_pairs_and_manual_markers_match_typescript(self):
        requests = [{"version": 1, "actionId": "test-action", "kind": kind, "target": target}
                    for kind, targets in TARGETS.items() for target in sorted(targets)]
        results = self.run_typescript(
            "import {parseGuideAction,guideActionMarker,isGuideActionMarker} from './src/lib/guide-actions.ts'; console.log(JSON.stringify(JSON.parse(process.argv[1]).map(x=>{ const action=parseGuideAction(JSON.stringify(x)); return action ? {marker:guideActionMarker(action),valid:isGuideActionMarker(guideActionMarker(action))} : null; })));",
            json.dumps(requests))
        self.assertTrue(all(item and item["valid"] for item in results))
        self.assertEqual({item["marker"] for item in results}, UI_TARGETS - MANUAL_TARGETS)
        manual = sorted(MANUAL_TARGETS)
        markers = self.run_typescript(
            "import {parseGuideAction,isGuideActionMarker} from './src/lib/guide-actions.ts'; console.log(JSON.stringify(JSON.parse(process.argv[1]).map(target=>({manual:isGuideActionMarker(target),remote:parseGuideAction(JSON.stringify({version:1,actionId:'test',kind:'navigate',target}))}))));",
            json.dumps(manual))
        self.assertEqual(dict(zip(manual, markers)), {target: {"manual": True, "remote": None} for target in manual})

    def test_move_rpc_title_key_and_resolution_match_actual_browser(self):
        cases = [("Design homepage", "Review", None), (" Landing page ", "Build", "Brief"),
                 ("😀" * 120, "Handoff", "Review"), ("x", "Review", None), ("😀" * 121, "Review", None),
                 ("Task", "review", None), ("Task", "Review", "archive"), (" Task\n", "Review", None),
                 ("Task", "Review", "Review")]
        request_id = "1b6c59d1-9c29-416a-aa44-e889b97e113e"
        requests = [{"version": 1, "requestId": request_id, "title": title, "fromStage": current, "stage": stage}
                    for title, stage, current in cases]
        titles = ["Design Homepage!", "ＤＥＳＩＧＮ　homepage", "Café ① launch", "cafe\u0301 1 Launch", "İstanbul",
                  "ΟΔΥΣΣΕΥΣ", "Straße", "ﬁx bug", "١٢٣ ٤", "Ⅻ chapters", "😀 Q4: plan", "a\u200bb", "日本語のタスク", "  "]
        result = self.run_typescript(
            "import {parseMoveTask,taskReferenceKey,MOVE_TASK_METHOD} from './src/lib/task-actions.ts'; const [requests,titles]=JSON.parse(process.argv[1]); console.log(JSON.stringify({method:MOVE_TASK_METHOD,results:requests.map(x=>parseMoveTask(JSON.stringify(x))),keys:titles.map(taskReferenceKey)}));",
            json.dumps([requests, titles]))
        self.assertEqual(result["method"], MOVE_TASK_METHOD)
        self.assertEqual(result["keys"], [task_reference_key(title) for title in titles])
        for args, parsed in zip(cases, result["results"]):
            with self.subTest(args=args):
                try:
                    clean = validate_move(*args)
                except ValidationError:
                    # Python is stricter: it never sends a no-op move or a title without
                    # letters or digits; the browser would answer those with
                    # already_in_stage or not_found.
                    symbols_only = isinstance(args[0], str) and not task_reference_key(args[0])
                    if args[1] != args[2] and not symbols_only:
                        self.assertIsNone(parsed)
                else:
                    self.assertEqual(parsed, {"version": 1, "requestId": request_id, "title": clean["title"],
                                              "fromStage": clean["from_stage"], "stage": clean["stage"]})
        # The exact payload the worker sends parses in the browser, and the browser's
        # own resolution of a known rejection binds in the worker without a lockout.
        tasks = [{"id": "324ca4d5-67e9-4e43-b7cc-0dc5367950d7", "title": "Design homepage", "stage": "Review"},
                 {"id": "424ca4d5-67e9-4e43-b7cc-0dc5367950d7", "title": "design-homepage", "stage": "Brief"},
                 {"id": "524ca4d5-67e9-4e43-b7cc-0dc5367950d7", "title": "Launch plan", "stage": "Build"}]
        for args, code in [(("DESIGN HOMEPAGE", "Handoff"), "ambiguous"), (("Design homepage", "Handoff", "Review"), None),
                           (("Launch Plan", "Build"), "already_in_stage"), (("Launch plan", "Review", "Brief"), "not_found"),
                           (("Missing task", "Review"), "not_found")]:
            sent = []
            async def rpc(**options):
                sent.append(options)
                return json.dumps({"version": 1, "requestId": json.loads(options["payload"])["requestId"],
                                   "applied": False, "error": "unavailable"})
            actions = BrowserActions(rpc, "member", lambda: True)
            with self.assertRaises(ValidationError):
                asyncio.run(actions.move_task(*args))
            resolution = self.run_typescript(
                "import {parseMoveTask,resolveMoveTask} from './src/lib/task-actions.ts'; const request=parseMoveTask(process.argv[1]); console.log(JSON.stringify(request && resolveMoveTask(JSON.parse(process.argv[2]), request)));",
                sent[0]["payload"], json.dumps(tasks))
            with self.subTest(args=args):
                self.assertEqual(resolution.get("error"), code)
                if code is None:
                    self.assertEqual(resolution["task"]["stage"], "Review")
                    continue
                reply = {key: value for key, value in resolution.items() if key != "ok"}
                async def browser(**options):
                    return json.dumps({"version": 1, "requestId": json.loads(options["payload"])["requestId"],
                                       "applied": False, **reply})
                actions = BrowserActions(browser, "member", lambda: True)
                with self.assertRaises(ValidationError) as caught:
                    asyncio.run(actions.move_task(*args))
                expected = (f"No task with that title is in {args[2]}" if code == "not_found" and len(args) > 2
                            else MOVE_ERRORS[code])
                self.assertTrue(str(caught.exception).startswith(expected))
                if code == "ambiguous":
                    self.assertEqual(resolution["stages"], ["Brief", "Review"])

    def run_typescript(self, script, *args):
        # Loader mode avoids the tsx CLI's unnecessary local IPC listener.
        result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", script, *args],
                                cwd=ROOT, text=True, capture_output=True, timeout=30, check=True)
        return json.loads(result.stdout)

    def test_actual_backend_signature_verifies_in_python_with_unicode(self):
        claims = {"v": 1, "userId": "user_test", "participantIdentity": "member_test", "roomName": "launchpad-unit-test",
                  "expiresAt": 1200, "mode": "onboarding", "experience": "tour", "draft": {"workspaceName": "Orbit 🚀", "workflow": "campaign"}}
        envelope = self.run_typescript(
            "import {signGuideMetadata} from './src/lib/room-token.ts'; console.log(JSON.stringify(signGuideMetadata(JSON.parse(process.argv[1]), process.argv[2])));",
            json.dumps(claims), SECRET)
        self.assertEqual(verify_dispatch(envelope, SECRET, "launchpad-unit-test", now=1000), claims)

    def test_python_envelope_verifies_in_actual_backend(self):
        claims = self.run_typescript(
            "import {verifyGuideMetadata} from './src/lib/room-token.ts'; console.log(JSON.stringify(verifyGuideMetadata(process.argv[1], process.argv[2],1000)));",
            metadata(), SECRET)
        self.assertEqual(claims["roomName"], "launchpad-unit-test")
        self.assertEqual(claims["draft"]["workspaceName"], "Orbit Studio")
        self.assertEqual(claims["experience"], "setup")

    def test_legacy_help_envelope_defaults_to_qa_in_both_runtimes(self):
        envelope = metadata(mode="help")
        claims = self.run_typescript(
            "import {verifyGuideMetadata} from './src/lib/room-token.ts'; console.log(JSON.stringify(verifyGuideMetadata(process.argv[1], process.argv[2],1000)));",
            envelope, SECRET)
        self.assertEqual(claims, verify_dispatch(envelope, SECRET, "launchpad-unit-test", now=1000))
        self.assertEqual(claims["experience"], "qa")
