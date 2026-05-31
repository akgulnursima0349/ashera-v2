import uuid
from datetime import datetime

from normalizer import NormalizedCall


def parse(payload: dict, webhook_token: str) -> NormalizedCall:
    recording_url = payload.get("recording_url")
    if not recording_url:
        raise ValueError("Generic webhook payload missing required field: recording_url")

    started_at = None
    if payload.get("started_at"):
        try:
            started_at = datetime.fromisoformat(payload["started_at"])
        except ValueError:
            pass

    return NormalizedCall(
        call_id=payload.get("call_id") or str(uuid.uuid4()),
        recording_url=recording_url,
        caller_number=str(payload.get("caller_number", "Unknown")),
        agent_name=str(payload.get("agent_name", "Unknown")),
        duration_seconds=int(payload.get("duration_seconds", 0)),
        started_at=started_at,
        provider="generic",
        raw_payload=payload,
    )
