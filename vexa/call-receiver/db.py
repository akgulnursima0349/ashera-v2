import json
import logging
from datetime import timezone
from typing import Optional

import asyncpg

from config import DATABASE_URL
from normalizer import NormalizedCall

log = logging.getLogger(__name__)

_pool = None
_system_user_id: Optional[int] = None

SYSTEM_USER_EMAIL = "phone-call-system@ashera.internal"


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def _get_or_create_system_user(pool) -> int:
    """Ensure a system user for phone calls exists and return its id."""
    row = await pool.fetchrow(
        "SELECT id FROM users WHERE email = $1", SYSTEM_USER_EMAIL
    )
    if row:
        return row["id"]
    row = await pool.fetchrow(
        "INSERT INTO users (email, name, data) VALUES ($1, $2, '{}'::jsonb) RETURNING id",
        SYSTEM_USER_EMAIL,
        "Phone Call System",
    )
    return row["id"]


async def run_migrations():
    global _system_user_id
    pool = await get_pool()
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS call_provider_configs (
            id              SERIAL PRIMARY KEY,
            user_id         INTEGER REFERENCES users(id),
            provider        VARCHAR(50) NOT NULL,
            credentials     JSONB NOT NULL DEFAULT '{}',
            webhook_token   VARCHAR(255) UNIQUE,
            last_polled_at  TIMESTAMP,
            is_active       BOOLEAN DEFAULT TRUE,
            created_at      TIMESTAMP DEFAULT NOW()
        )
    """)
    _system_user_id = await _get_or_create_system_user(pool)
    log.info("Migrations complete. System user id=%d.", _system_user_id)


async def create_meeting_record(call: NormalizedCall) -> int:
    pool = await get_pool()

    # Try to find user_id from call_provider_configs for this provider.
    # Falls back to the system user when the config row has no user_id set.
    user_id: Optional[int] = None
    try:
        row = await pool.fetchrow(
            "SELECT user_id FROM call_provider_configs WHERE provider = $1 AND is_active = TRUE LIMIT 1",
            call.provider,
        )
        if row:
            user_id = row["user_id"]
    except Exception as exc:
        log.warning("Could not look up user_id for provider %s: %s", call.provider, exc)

    if user_id is None:
        user_id = _system_user_id

    # asyncpg requires naive datetimes for timestamp without time zone columns
    started_at = call.started_at
    if started_at is not None and started_at.tzinfo is not None:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)

    row = await pool.fetchrow(
        """
        INSERT INTO meetings (platform, platform_specific_id, status, data, start_time, user_id)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        RETURNING id
        """,
        "phone_call",
        call.call_id,
        "requested",
        json.dumps(call.raw_payload),
        started_at,
        user_id,
    )
    return row["id"]


async def update_meeting_status(meeting_id: int, status: str):
    pool = await get_pool()
    await pool.execute(
        "UPDATE meetings SET status = $1 WHERE id = $2",
        status,
        meeting_id,
    )


async def save_transcription_segments(meeting_id: int, segments: list, language: str = 'tr'):
    """Write transcript segments from Deepgram into the transcriptions table."""
    if not segments:
        return
    pool = await get_pool()
    rows = [
        (
            meeting_id,
            seg.get("speaker", "Speaker"),
            seg.get("text", "").strip(),
            float(seg.get("start_time", seg.get("start", 0.0))),
            float(seg.get("end_time", seg.get("end", 0.0))),
            seg.get("language", language),
        )
        for seg in segments
        if seg.get("text", "").strip()
    ]
    if not rows:
        return
    await pool.executemany(
        """
        INSERT INTO transcriptions (meeting_id, speaker, text, start_time, end_time, language)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        rows,
    )
