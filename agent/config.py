"""Load only the settings required by this worker, without importing Clerk secrets."""
import os
from pathlib import Path

SHARED_KEYS = frozenset({"LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LAUNCHPAD_AGENT_SECRET"})
AGENT_KEYS = SHARED_KEYS | {
    "SYNTHESIA_API_KEY", "SYNTHESIA_AVATAR_ID", "OPENAI_API_KEY", "OPENAI_REALTIME_MODEL",
    "LIVEKIT_STT_MODEL", "LIVEKIT_TTS_MODEL", "CARTESIA_VOICE_ID", "LAUNCHPAD_AGENT_PORT",
    "LAUNCHPAD_APP_ORIGIN",
}


def load_environment(root: Path | None = None, environ=None) -> None:
    from dotenv import dotenv_values
    root = root or Path(__file__).resolve().parent.parent
    environ = os.environ if environ is None else environ
    for key, value in dotenv_values(root / ".env.local", interpolate=False).items():
        if key in SHARED_KEYS and value is not None:
            environ.setdefault(key, value)
    for key, value in dotenv_values(root / "agent" / ".env", interpolate=False).items():
        if key in AGENT_KEYS and value is not None:
            environ[key] = value
