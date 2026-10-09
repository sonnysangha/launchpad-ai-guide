"""Summarize observed SDK turn timing; emits no transcript or credential data."""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


def summarize(lines):
    samples = defaultdict(list)
    turns = 0
    for line in lines:
        # Accept a plain JSON event or LiveKit's structured log with JSON in message.
        try:
            # Dev logs append color codes and job metadata after the JSON event.
            # Decode just the first object rather than rejecting that safe suffix.
            event, _ = json.JSONDecoder().raw_decode(line[line.index("{"):])
            if isinstance(event.get("message"), str):
                event = json.loads(event["message"])
        except (ValueError, TypeError, AttributeError):
            continue
        if event.get("event") != "turn_timing" or event.get("role") != "assistant":
            continue
        turns += 1
        for key, value in event.get("milliseconds", {}).items():
            if type(value) in (float, int) and math.isfinite(value) and value >= 0:
                samples[key].append(value)
    def percentile(values, quantile):
        values = sorted(values)
        return values[max(0, math.ceil(len(values) * quantile) - 1)]
    return {
        "status": "observed" if samples else "no_measurements",
        "assistant_turns": turns,
        "metrics_ms": {key: {"samples": len(values), "p50": percentile(values, .5),
                            "p95": percentile(values, .95), "max": max(values)}
                       for key, values in sorted(samples.items())},
        "scope": "SDK turn timing; not independent browser video-render timing",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logfile", type=Path)
    args = parser.parse_args()
    with args.logfile.open(encoding="utf-8") as stream:
        print(json.dumps(summarize(stream), indent=2))
