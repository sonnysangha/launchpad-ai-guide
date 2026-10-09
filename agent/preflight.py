"""Local checks only: never starts a session or prints environment values."""
from __future__ import annotations

import json
import os
import sys
from importlib import metadata
from urllib.parse import urlsplit

REQUIRED = (
    "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "SYNTHESIA_API_KEY",
    "SYNTHESIA_AVATAR_ID", "OPENAI_API_KEY", "LAUNCHPAD_AGENT_SECRET",
)
PACKAGES = {"livekit-agents": "1.8.4", "livekit-plugins-synthesia": "1.8.4", "python-dotenv": "1.2.4"}


def check_environment(environ: dict | os._Environ = os.environ) -> dict:
    missing = [name for name in REQUIRED if not environ.get(name, "").strip()]
    invalid = []
    secret = environ.get("LAUNCHPAD_AGENT_SECRET", "")
    if secret and len(secret) < 32:
        invalid.append("LAUNCHPAD_AGENT_SECRET")
    url = environ.get("LIVEKIT_URL", "")
    if url:
        try:
            parsed = urlsplit(url)
            if parsed.scheme != "wss" or not parsed.hostname or parsed.username or parsed.password:
                invalid.append("LIVEKIT_URL")
        except ValueError:
            invalid.append("LIVEKIT_URL")
    return {"missing": missing, "invalid": invalid, "configured": not missing and not invalid}


def main() -> int:
    try:
        from config import load_environment
        load_environment()
    except ImportError:
        pass
    result = check_environment()
    result["python_supported"] = (3, 10) <= sys.version_info[:2] < (3, 15)
    result["packages"] = {}
    for package, expected in PACKAGES.items():
        try:
            installed = metadata.version(package)
        except metadata.PackageNotFoundError:
            installed = None
        result["packages"][package] = {"expected": expected, "installed": installed}
    result["remote_checks"] = "not_run"
    result["avatar_verified"] = False
    print(json.dumps(result, indent=2))
    ready = result["configured"] and result["python_supported"] and all(
        value["installed"] == value["expected"] for value in result["packages"].values()
    )
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
