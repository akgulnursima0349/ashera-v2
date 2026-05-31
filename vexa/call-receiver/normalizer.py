from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class NormalizedCall:
    call_id: str
    recording_url: str
    provider: str                          # "alotech" | "twilio" | "generic"
    raw_payload: dict
    caller_number: str = "Unknown"
    agent_name: str = "Unknown"
    duration_seconds: int = 0
    started_at: Optional[datetime] = None
