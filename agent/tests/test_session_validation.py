import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from guide_core import ValidationError
from session_validation import NoRedirects, validate_session
from summarize_latency import summarize


class Response:
    status = 200
    def __init__(self, body): self.body = body
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def geturl(self): return "http://127.0.0.1:3212/api/room/validate"
    def read(self, limit): return json.dumps(self.body).encode()[:limit]


class ActiveSessionTests(unittest.TestCase):
    def test_signed_envelope_sent_to_exact_local_endpoint(self):
        opener = Mock(return_value=Response({"valid": True, "sessionExpiresAt": 1500}))
        expiry = validate_session("signed-envelope", "http://127.0.0.1:3212", now=1000, opener=opener)
        request = opener.call_args.args[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.full_url, "http://127.0.0.1:3212/api/room/validate")
        self.assertEqual(json.loads(request.data), {"metadata": "signed-envelope"})
        self.assertEqual(expiry, 1500)

    def test_deleted_expired_or_invalid_backend_session_fails_closed(self):
        for body in ({"valid": False, "sessionExpiresAt": 1500}, {"valid": True, "sessionExpiresAt": 999},
                     {"valid": True, "sessionExpiresAt": 1901}, {"valid": True, "sessionExpiresAt": True}, {}, []):
            with self.subTest(body=body), self.assertRaises(ValidationError):
                validate_session("signed-envelope", "http://127.0.0.1:3212", now=1000, opener=lambda *a, **k: Response(body))

    def test_network_error_does_not_accept_or_echo_user_metadata(self):
        with self.assertRaises(ValidationError) as caught:
            validate_session("private-signed-payload", "http://127.0.0.1:3212", opener=Mock(side_effect=OSError("network details")))
        self.assertNotIn("private-signed-payload", str(caught.exception))
        self.assertNotIn("network details", str(caught.exception))

    def test_insecure_remote_origins_and_redirects_are_blocked(self):
        for origin in ("http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?token=secret"):
            opener = Mock()
            with self.subTest(origin=origin), self.assertRaises(ValidationError):
                validate_session("signed-envelope", origin, opener=opener)
            opener.assert_not_called()
        self.assertIsNone(NoRedirects().redirect_request(None, None, 307, "", {}, "https://another.example"))


class MeasuredLatencyTests(unittest.TestCase):
    def test_actual_dev_log_format_with_ansi_and_job_suffix_is_readable(self):
        line = '2026-10-06 INFO launchpad.guide - {"event":"turn_timing","role":"assistant","milliseconds":{"playback_latency":1.2}} \x1b[90m{"pid":123,"job_id":"test"}\x1b[0m'
        result = summarize([line])
        self.assertEqual(result['assistant_turns'], 1)
        self.assertEqual(result['metrics_ms']['playback_latency']['p50'], 1.2)

    def test_empty_and_non_turn_logs_do_not_invent_measurements(self):
        self.assertEqual(summarize(["not json", '{"event":"avatar_joined","elapsed_ms":999}'])["status"], "no_measurements")

    def test_observed_metrics_have_honest_counts_and_quantiles(self):
        events = [json.dumps({"event": "turn_timing", "role": "assistant", "milliseconds": {"e2e_latency": value}})
                  for value in (1200, 600, 900)]
        events.append(json.dumps({"event": "turn_timing", "role": "user", "milliseconds": {"e2e_latency": 0}}))
        result = summarize(events)
        self.assertEqual(result["assistant_turns"], 3)
        self.assertEqual(result["metrics_ms"]["e2e_latency"], {"samples": 3, "p50": 900, "p95": 1200, "max": 1200})
