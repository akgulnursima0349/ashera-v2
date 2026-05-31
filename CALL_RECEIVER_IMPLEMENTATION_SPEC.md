# Implementation Spec — Call Receiver Service

## Context

This is an existing project. Read this carefully before writing any code.

### What already exists (do not modify)

- `assemblyai-proxy` — FastAPI service on port 8070. Accepts audio chunks, batches them, sends to AssemblyAI. Already working.
- `vexa-lite` — All-in-one service for Google Meet bots. Port 8056. Do not touch.
- `postgres` — PostgreSQL 15 on port 5433, database name `vexa`, user `vexa`, password `secret`.
- Existing tables: `users`, `api_tokens`, `meetings`, `transcriptions`. **Do not alter these tables.**
- `docker-compose.yml` — Exists in the project root. You will add one new service to it.

### What you are building

A new standalone FastAPI service called `call-receiver` on port 8075. It receives phone call recordings from telephony providers, normalizes them, downloads the audio, and sends it to the existing `assemblyai-proxy` for transcription.

Read `CALL_RECEIVER_ARCHITECTURE.md` in this directory for the full architecture before starting.

---

## Task

Build the `call-receiver` service. Implement everything listed below. Do not skip any step.

---

## Step 1 — Create the directory structure

Create the following files (empty for now, you will fill them in later steps):

```
call-receiver/
├── main.py
├── normalizer.py
├── pipeline.py
├── db.py
├── config.py
├── requirements.txt
├── Dockerfile
└── providers/
    ├── __init__.py
    ├── alotech.py
    ├── twilio.py
    └── generic.py
```

---

## Step 2 — config.py

Load environment variables. No defaults for secrets — raise a clear error if missing.

```python
import os

DATABASE_URL: str = os.environ["DATABASE_URL"]
ASSEMBLYAI_PROXY_URL: str = os.environ["ASSEMBLYAI_PROXY_URL"]
ALOTECH_POLL_INTERVAL: int = int(os.getenv("ALOTECH_POLL_INTERVAL", "60"))
CREDENTIALS_ENCRYPTION_KEY: str = os.environ["CREDENTIALS_ENCRYPTION_KEY"]
```

---

## Step 3 — normalizer.py

Define the `NormalizedCall` dataclass. This is the single contract between all providers and the pipeline.

```python
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
```

No other logic in this file.

---

## Step 4 — db.py

PostgreSQL connection using `asyncpg`. Mirror the connection pattern used in other services in this project if visible; otherwise use this pattern:

```python
import asyncpg
from config import DATABASE_URL

_pool = None

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
```

Also implement these two functions used by the pipeline:

**`create_meeting_record(call: NormalizedCall) -> int`**
- Inserts a row into the existing `meetings` table
- `platform` = `"phone_call"`
- `platform_specific_id` = `call.call_id`
- `status` = `"requested"`
- `data` = `call.raw_payload` as JSONB
- `start_time` = `call.started_at`
- `user_id` = look up from `call_provider_configs` by matching provider + call_id if possible, otherwise NULL
- Returns the inserted row `id`

**`update_meeting_status(meeting_id: int, status: str)`**
- Updates `meetings.status` for the given id
- Valid values: `"requested"`, `"processing"`, `"completed"`, `"failed"`

---

## Step 5 — Create the new database table

At service startup, run this migration if the table does not exist:

```sql
CREATE TABLE IF NOT EXISTS call_provider_configs (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    provider        VARCHAR(50) NOT NULL,
    credentials     JSONB NOT NULL DEFAULT '{}',
    webhook_token   VARCHAR(255) UNIQUE,
    last_polled_at  TIMESTAMP,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW()
);
```

Run this in `db.py` in a function called `run_migrations()` that is called from `main.py` on startup.

---

## Step 6 — providers/generic.py

The simplest provider. Accepts any JSON payload with at minimum a `recording_url` field.

```python
from normalizer import NormalizedCall
from datetime import datetime
import uuid

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
```

---

## Step 7 — providers/twilio.py

Twilio sends form-encoded data (not JSON). Key fields: `RecordingSid`, `RecordingUrl`, `From`, `CallDuration`, `StartTime`.

```python
from normalizer import NormalizedCall
from datetime import datetime
from typing import Any

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
```

---

## Step 8 — providers/alotech.py

Alotech does not push webhooks. This module contains a **polling loop** that runs as a background task.

The Alotech CDR API:
```
GET https://api.alo-tech.com/api/v3/cdr
    ?start_date=YYYY-MM-DDTHH:MM:SS
    &end_date=YYYY-MM-DDTHH:MM:SS
Authorization: Bearer {token}
```

Implement:

**`parse_cdr_record(record: dict) -> NormalizedCall`**
Maps these fields:
- `record["call_id"]` → `call_id`
- `record["record_file"]` → `recording_url`
- `record["caller_id"]` → `caller_number`
- `record["agent_name"]` → `agent_name`
- `record["call_duration"]` → `duration_seconds` (convert to int)
- `record["start_date"]` → `started_at` (parse ISO 8601)

**`poll_once(config: dict) -> list[NormalizedCall]`**
- `config` is a row from `call_provider_configs`
- `config["credentials"]` contains `{"token": "..."}` (decrypted before calling)
- Fetches CDRs from `last_polled_at` to now
- Only includes records where `record["record_file"]` is not empty
- Returns a list of `NormalizedCall`

**`start_polling_loop()`**
- An async loop that runs forever
- Every `ALOTECH_POLL_INTERVAL` seconds:
  - Fetches all active Alotech configs from `call_provider_configs`
  - Calls `poll_once` for each
  - For each returned `NormalizedCall`, submits it to the pipeline
  - Updates `last_polled_at` in the database

Use `asyncio.sleep` between polls. Handle HTTP errors gracefully — log the error and continue to the next config, do not crash the loop.

---

## Step 9 — pipeline.py

This is the core of the service. Takes a `NormalizedCall`, downloads the audio, and sends it to `assemblyai-proxy`.

```python
import httpx
import asyncio
from normalizer import NormalizedCall
from db import create_meeting_record, update_meeting_status
from config import ASSEMBLYAI_PROXY_URL

async def submit_call(call: NormalizedCall) -> None:
    meeting_id = await create_meeting_record(call)

    try:
        await update_meeting_status(meeting_id, "processing")

        # Download audio file
        audio_bytes = await _download_audio(call.recording_url)

        # Send to assemblyai-proxy
        # The proxy expects multipart form data with the audio file
        # and a meeting_id field — match the format that vexa-lite uses
        await _send_to_proxy(audio_bytes, meeting_id, call)

        await update_meeting_status(meeting_id, "completed")

    except Exception as e:
        await update_meeting_status(meeting_id, "failed")
        raise

async def _download_audio(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content

async def _send_to_proxy(audio_bytes: bytes, meeting_id: int, call: NormalizedCall) -> None:
    async with httpx.AsyncClient(timeout=120.0) as client:
        files = {"audio": ("recording.mp3", audio_bytes, "audio/mpeg")}
        data = {
            "meeting_id": str(meeting_id),
            "platform": "phone_call",
            "language": "tr",   # default; can be extended later
        }
        response = await client.post(
            f"{ASSEMBLYAI_PROXY_URL}/transcribe",
            files=files,
            data=data,
        )
        response.raise_for_status()
```

**Important:** Check the actual endpoint and request format that `assemblyai-proxy` exposes before finalizing `_send_to_proxy`. Look at the existing `assemblyai-proxy/main.py` file and match its expected input format exactly.

---

## Step 10 — main.py

Wire everything together.

```python
from fastapi import FastAPI, Request, BackgroundTasks, HTTPException, Header
from contextlib import asynccontextmanager
import asyncio

from db import get_pool, close_pool, run_migrations
from pipeline import submit_call
from providers import alotech, twilio, generic
from config import ALOTECH_POLL_INTERVAL

@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_migrations()
    asyncio.create_task(alotech.start_polling_loop())
    yield
    await close_pool()

app = FastAPI(lifespan=lifespan)

@app.post("/calls/twilio")
async def twilio_webhook(request: Request, background_tasks: BackgroundTasks):
    form = await request.form()
    call = twilio.parse(dict(form))
    background_tasks.add_task(submit_call, call)
    return {"status": "accepted"}   # Must return fast — Twilio has a 15s timeout

@app.post("/calls/webhook/{token}")
async def generic_webhook(token: str, request: Request, background_tasks: BackgroundTasks):
    payload = await request.json()
    # Verify the token exists in call_provider_configs
    pool = await get_pool()
    config = await pool.fetchrow(
        "SELECT * FROM call_provider_configs WHERE webhook_token = $1 AND is_active = TRUE",
        token,
    )
    if not config:
        raise HTTPException(status_code=401, detail="Invalid webhook token")
    call = generic.parse(payload, token)
    background_tasks.add_task(submit_call, call)
    return {"status": "accepted"}

@app.get("/transcripts/phone_call/{call_id}")
async def get_transcript(call_id: str):
    pool = await get_pool()
    meeting = await pool.fetchrow(
        "SELECT id FROM meetings WHERE platform = 'phone_call' AND platform_specific_id = $1",
        call_id,
    )
    if not meeting:
        raise HTTPException(status_code=404, detail="Call not found")
    segments = await pool.fetch(
        """SELECT speaker, text, start_time AS start, end_time AS end, language
           FROM transcriptions WHERE meeting_id = $1 ORDER BY start_time""",
        meeting["id"],
    )
    return {
        "meeting_id": call_id,
        "segments": [dict(s) for s in segments],
    }

@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## Step 11 — requirements.txt

```
fastapi==0.111.0
uvicorn==0.29.0
asyncpg==0.29.0
httpx==0.27.0
pydantic==2.7.0
cryptography==42.0.0
```

---

## Step 12 — Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8075"]
```

---

## Step 13 — Add to docker-compose.yml

Add this service to the existing `docker-compose.yml` in the project root. Do not modify any existing service definitions.

```yaml
  call-receiver:
    build: ./call-receiver
    ports:
      - "8075:8075"
    environment:
      DATABASE_URL: postgresql://vexa:secret@postgres:5433/vexa
      ASSEMBLYAI_PROXY_URL: http://assemblyai-proxy:8070
      ALOTECH_POLL_INTERVAL: "60"
      CREDENTIALS_ENCRYPTION_KEY: ${CREDENTIALS_ENCRYPTION_KEY}
    depends_on:
      - postgres
      - assemblyai-proxy
    restart: unless-stopped
```

---

## Step 14 — Verify assemblyai-proxy endpoint

Before finalizing `pipeline.py`, read the file `assemblyai-proxy/main.py` and find:
1. The exact endpoint path that accepts audio (likely `/transcribe` or similar)
2. The expected request format (multipart? JSON? what field names?)
3. What it expects as a meeting identifier

Update `_send_to_proxy` in `pipeline.py` to match exactly.

---

## What NOT to do

- Do not modify `vexa-lite`, `assemblyai-proxy`, `ashera-ui`, or any existing service
- Do not alter the `meetings`, `transcriptions`, `users`, or `api_tokens` tables
- Do not add credential encryption to this task — store credentials as plaintext JSON in `call_provider_configs.credentials` for now and leave a `TODO` comment for encryption
- Do not implement the `/calls/config` endpoint for saving credentials in this task — that comes later
- Do not write tests — focus on working implementation

---

## Definition of Done

The service is complete when:

1. `docker-compose up` starts `call-receiver` without errors
2. `GET http://localhost:8075/health` returns `{"status": "ok"}`
3. `POST http://localhost:8075/calls/webhook/{any_valid_token}` with body `{"recording_url": "https://example.com/test.mp3"}` returns `{"status": "accepted"}` and creates a row in the `meetings` table with `platform = 'phone_call'`
4. `GET http://localhost:8075/transcripts/phone_call/{call_id}` returns the segment format shown in the architecture doc
5. The Alotech polling loop starts on service startup (visible in logs) without crashing even if no Alotech configs exist yet
