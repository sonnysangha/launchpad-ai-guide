"""Fail-closed local app check prevents cached room tokens reviving an ended guide."""
from __future__ import annotations

import json
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from guide_core import ValidationError


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_session(metadata: str, origin: str, *, now: int | None = None, opener=None) -> int:
    """Return server-owned expiry in epoch seconds; never echo signed user data."""
    try:
        parsed = urlsplit(origin)
        allowed_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (not allowed_http and parsed.scheme != "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValidationError("LAUNCHPAD_APP_ORIGIN must be a trusted HTTPS or loopback HTTP origin.")
        request = Request(origin.rstrip("/") + "/api/room/validate", method="POST",
                          data=json.dumps({"metadata": metadata}).encode(),
                          headers={"Content-Type": "application/json", "Accept": "application/json"})
        request_open = opener or build_opener(NoRedirects()).open
        with request_open(request, timeout=5) as response:
            if response.status != 200 or response.geturl() != request.full_url:
                raise ValidationError("Guide session is no longer active.")
            value = json.loads(response.read(4096))
        current = int(time.time()) if now is None else now
        expires = value.get("sessionExpiresAt") if isinstance(value, dict) else None
        if not isinstance(value, dict) or value.get("valid") is not True or type(expires) is not int or not current < expires <= current + 900:
            raise ValidationError("Guide session is no longer active.")
        return expires
    except (OSError, ValueError, TypeError):
        raise ValidationError("Guide session validation failed. Start a new guide from Launchpad.") from None
