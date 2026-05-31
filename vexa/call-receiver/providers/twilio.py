from datetime import datetime
from typing import Any

from normalizer import NormalizedCall


def parse(form_data: dict) -> NormalizedCall:
    recording_url = form_data.get("RecordingUrl", "")
    # Twilio recording URLs need .mp3 appended
    if recording_url and not recording_url.endswith(".mp3"):
        recording_url = recording_url + ".mp3"

    started_at = None
    if form_data.get("StartTime"):
        try:
            started_at = datetime.strptime(form_data["StartTime"], "%a, %d %b %Y %H:%M:%S %z")
        except ValueError:
            pass

    return NormalizedCall(
        call_id=form_data.get("RecordingSid") or form_data.get("CallSid", ""),
        recording_url=recording_url,
        caller_number=form_data.get("From", "Unknown"),
        agent_name=form_data.get("To", "Unknown"),
        duration_seconds=int(form_data.get("CallDuration", 0)),
        started_at=started_at,
        provider="twilio",
        raw_payload=dict(form_data),
    )
