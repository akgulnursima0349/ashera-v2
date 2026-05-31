import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

import config
from db import get_pool, update_meeting_status
from normalizer import NormalizedCall

log = logging.getLogger(__name__)

ALOTECH_CDR_URL = "https://api.alo-tech.com/api/v3/cdr"


def parse_cdr_record(record: dict) -> NormalizedCall:
    started_at: Optional[datetime] = None
    if record.get("start_date"):
        try:
            started_at = datetime.fromisoformat(record["start_date"])
        except ValueError:
            pass

    return NormalizedCall(
        call_id=str(record.get("call_id", "")),
        recording_url=record.get("record_file", ""),
        caller_number=str(record.get("caller_id", "Unknown")),
        agent_name=str(record.get("agent_name", "Unknown")),
        duration_seconds=int(record.get("call_duration", 0)),
        started_at=started_at,
        provider="alotech",
        raw_payload=record,
    )


async def poll_once(config_row: dict) -> list[NormalizedCall]:
    # TODO: decrypt credentials before use (stored as plaintext JSON for now)
    credentials = config_row["credentials"]
    token = credentials.get("token", "")

    last_polled_at: Optional[datetime] = config_row.get("last_polled_at")
    now = datetime.now(timezone.utc)

    if last_polled_at is None:
        # First poll — look back 24 hours
        from datetime import timedelta
        last_polled_at = now - timedelta(hours=24)

    params = {
        "start_date": last_polled_at.strftime("%Y-%m-%dT%H:%M:%S"),
        "end_date": now.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(ALOTECH_CDR_URL, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()

    records = data if isinstance(data, list) else data.get("data", data.get("records", []))

    calls = []
    for record in records:
        if not record.get("record_file"):
            continue
        calls.append(parse_cdr_record(record))

    return calls


async def start_polling_loop():
    """Background polling loop — runs forever, polls every ALOTECH_POLL_INTERVAL seconds."""
    # Import here to avoid circular import at module load time
    from pipeline import submit_call

    log.info("Alotech polling loop started (interval=%ds).", config.ALOTECH_POLL_INTERVAL)

    while True:
        try:
            pool = await get_pool()
            configs = await pool.fetch(
                "SELECT * FROM call_provider_configs WHERE provider = 'alotech' AND is_active = TRUE"
            )

            if not configs:
                log.debug("No active Alotech configs found.")
            else:
                for cfg in configs:
                    cfg_dict = dict(cfg)
                    try:
                        calls = await poll_once(cfg_dict)
                        log.info("Alotech config id=%d: fetched %d call(s).", cfg_dict["id"], len(calls))
                        for call in calls:
                            try:
                                await submit_call(call)
                            except Exception as exc:
                                log.error("Failed to submit Alotech call %s: %s", call.call_id, exc)
                        # Update last_polled_at
                        await pool.execute(
                            "UPDATE call_provider_configs SET last_polled_at = NOW() WHERE id = $1",
                            cfg_dict["id"],
                        )
                    except Exception as exc:
                        log.error("Alotech poll error for config id=%d: %s", cfg_dict["id"], exc)

        except Exception as exc:
            log.error("Alotech polling loop error: %s", exc)

        await asyncio.sleep(config.ALOTECH_POLL_INTERVAL)
