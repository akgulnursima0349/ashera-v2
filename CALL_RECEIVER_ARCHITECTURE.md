# Call Receiver Service — Technical Architecture

This document describes the `call-receiver` service: a standalone FastAPI microservice that ingests phone call recordings from multiple telephony providers, normalizes them into a common format, and feeds them into the existing Ashera transcription pipeline (`assemblyai-proxy`).

After reading this document you should understand how the service fits into the existing system, how to add a new provider, and how the data flows from a completed phone call to a transcript in PostgreSQL.

---

## Table of Contents

1. [How It Fits Into the Existing System](#1-how-it-fits-into-the-existing-system)
2. [Service Overview](#2-service-overview)
3. [Provider Strategy](#3-provider-strategy)
4. [Data Flow — Step by Step](#4-data-flow--step-by-step)
5. [Normalized Call Format](#5-normalized-call-format)
6. [Provider Implementations](#6-provider-implementations)
7. [Database Changes](#7-database-changes)
8. [API Endpoints](#8-api-endpoints)
9. [Configuration](#9-configuration)
10. [Adding a New Provider](#10-adding-a-new-provider)
11. [Key Gotchas](#11-key-gotchas)

---

## 1. How It Fits Into the Existing System

The existing system handles Google Meet calls via a headless Chromium bot. The `call-receiver` service adds phone call support **without modifying any existing service**. It connects only to `assemblyai-proxy` (for transcription) and PostgreSQL (for storage) — both of which already exist.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Telephony Providers                         │
│                                                                 │
│   Alotech ──webhook──┐                                          │
│   Twilio  ──webhook──┤                                          │
│   Generic ──webhook──┘                                          │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP POST (recording URL + metadata)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                   call-receiver :8075                            │
│                                                                  │
│  ┌───────────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │ Webhook Router│──▶│  Normalizer  │──▶│  Pipeline Submitter │ │
│  │               │   │              │   │                     │ │
│  │ /alotech      │   │ NormalizedCall│   │ Downloads audio     │ │
│  │ /twilio       │   │ dataclass    │   │ Sends to proxy      │ │
│  │ /generic      │   │              │   │ Creates DB record   │ │
│  └───────────────┘   └──────────────┘   └──────────┬──────────┘ │
│                                                     │            │
└─────────────────────────────────────────────────────┼────────────┘
                                                      │
                    ┌─────────────────────────────────┤
                    │                                 │
                    ▼                                 ▼
     ┌──────────────────────────┐      ┌──────────────────────────┐
     │   assemblyai-proxy :8070 │      │   PostgreSQL :5433       │
     │   (unchanged)            │      │   meetings + transcripts │
     │   Batches audio →        │      │   platform="phone_call"  │
     │   AssemblyAI API         │      │   (unchanged schema)     │
     └──────────────────────────┘      └──────────────────────────┘
```

**Key insight:** The existing `meetings` table already has a `platform` column. Google Meet uses `"google_meet"`. Phone calls use `"phone_call"`. The transcription pipeline is identical — only the audio source differs.

---

## 2. Service Overview

| Property | Value |
|----------|-------|
| Port | 8075 |
| Language | Python 3.11 |
| Framework | FastAPI |
| New dependencies | `httpx`, `pydantic` (already present in other services) |
| Existing services touched | None — read-only connection to PostgreSQL and HTTP to assemblyai-proxy |

### Directory Structure

```
call-receiver/
├── main.py                  # FastAPI app, route registration
├── normalizer.py            # NormalizedCall dataclass + normalization logic
├── pipeline.py              # Downloads audio, submits to assemblyai-proxy, writes DB
├── providers/
│   ├── __init__.py
│   ├── alotech.py           # Alotech CDR polling + webhook parser
│   ├── twilio.py            # Twilio webhook parser
│   └── generic.py           # Generic webhook (any provider that sends a recording URL)
├── db.py                    # PostgreSQL connection (mirrors existing pattern)
├── config.py                # Environment variable loading
├── requirements.txt
└── Dockerfile
```

---

## 3. Provider Strategy

The service supports three provider modes:

### Mode A — Managed Providers (Alotech, Twilio)

The customer enters their provider credentials once in the Ashera settings panel. Ashera configures the webhook on their behalf. The customer never sees raw API keys again.

Supported managed providers:
- **Alotech** — CDR polling via REST API (no native webhook push). The service polls Alotech every 60 seconds for completed calls and fetches recording URLs.
- **Twilio** — Webhook push. Twilio sends a POST to `/calls/twilio` when a recording is ready.

### Mode B — Generic Webhook

For any provider Ashera does not natively support, the customer is given a unique webhook URL:

```
https://api.ashera.net/calls/webhook/{customer_token}
```

The customer configures their own telephony system to POST to this URL when a call ends. The payload must contain at minimum a `recording_url` field. All other fields are optional.

### How Provider Is Identified

```
POST /calls/alotech      → AlotechProvider parser
POST /calls/twilio       → TwilioProvider parser
POST /calls/webhook/{token} → GenericProvider parser
```

The router calls the correct parser, which returns a `NormalizedCall`. From that point forward, all providers follow the same code path.

---

## 4. Data Flow — Step by Step

```
t=0s   Call ends at customer's telephony system
       Provider sends webhook POST to call-receiver
       (Alotech: call-receiver polls for new CDRs instead)

t=0s   Webhook router receives request
       Identifies provider from URL path
       Calls provider-specific parser

t=0s   Parser extracts fields, returns NormalizedCall
       Fields: call_id, recording_url, caller_number,
               agent_name, duration_seconds, started_at, provider

t=1s   Pipeline submitter creates meeting row in PostgreSQL
       platform="phone_call", status="requested"

t=2s   Pipeline submitter downloads audio file (MP3/WAV)
       from recording_url using httpx streaming

t=5s   Audio file sent to assemblyai-proxy :8070
       Same endpoint as Google Meet audio chunks
       assemblyai-proxy batches and forwards to AssemblyAI

t=15s  AssemblyAI returns transcript segments
       assemblyai-proxy writes segments to PostgreSQL transcriptions table
       meeting status updated to "completed"

t=15s  User calls GET /transcripts/phone_call/{call_id}
       Returns same segment format as Google Meet transcripts
```

**Total latency from call end to transcript:** ~15-20 seconds (2s download + 5s buffer + 8s AssemblyAI).

---

## 5. Normalized Call Format

All providers must produce a `NormalizedCall` before entering the pipeline. This is the single contract between providers and the rest of the system.

```python
# normalizer.py

from dataclasses import dataclass
from datetime import datetime

@dataclass
class NormalizedCall:
    call_id: str            # Unique ID from the provider (used as platform_specific_id)
    recording_url: str      # Direct download URL for the audio file
    caller_number: str      # The customer's phone number
    agent_name: str         # The sales agent's name or ID
    duration_seconds: int   # Call duration
    started_at: datetime    # When the call started
    provider: str           # "alotech" | "twilio" | "generic"
    raw_payload: dict       # Full original payload stored in meetings.data JSONB
```

If the provider does not supply a field, use sensible defaults (`agent_name="Unknown"`, `caller_number="Unknown"`, etc.). Never raise a validation error for missing optional fields — a partial record is better than a dropped call.

---

## 6. Provider Implementations

### 6.1 Alotech

Alotech does not push webhooks. The service polls the Alotech CDR API every 60 seconds.

```
GET https://api.alo-tech.com/api/v3/cdr
    ?start_date={last_polled_at}
    &end_date={now}
Authorization: Bearer {customer_alotech_token}
```

Key response fields:
- `record_file` → `recording_url`
- `call_id` → `call_id`
- `caller_id` → `caller_number`
- `agent_name` → `agent_name`
- `call_duration` → `duration_seconds`
- `start_date` → `started_at`

The poller tracks `last_polled_at` per customer in PostgreSQL to avoid processing duplicate calls.

### 6.2 Twilio

Twilio sends a POST when a recording is ready. The payload is form-encoded (not JSON).

Key fields:
- `RecordingSid` → `call_id`
- `RecordingUrl` + `.mp3` suffix → `recording_url`
- `From` → `caller_number`
- `CallDuration` → `duration_seconds`
- `StartTime` → `started_at`

Twilio requires a 200 response within 15 seconds. The webhook handler must respond immediately and process the recording asynchronously via a background task.

### 6.3 Generic Webhook

Accepts any JSON payload that contains at minimum:

```json
{
  "recording_url": "https://example.com/call-recording.mp3"
}
```

Optional fields (all strings):
- `call_id` — defaults to a generated UUID if missing
- `agent_name`
- `caller_number`
- `duration_seconds`
- `started_at` (ISO 8601)

The customer token in the URL path (`/calls/webhook/{token}`) is used to look up which user account this call belongs to.

---

## 7. Database Changes

**No changes to existing tables.**

The existing `meetings` table already supports phone calls:

```sql
-- No migration needed. Existing columns are sufficient.
-- platform column already exists: VARCHAR(100) NOT NULL
-- platform values: "google_meet" (existing) | "phone_call" (new)
-- data JSONB column stores the raw provider payload
```

One new table is needed to store customer provider credentials and polling state:

```sql
CREATE TABLE call_provider_configs (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    provider        VARCHAR(50) NOT NULL,        -- "alotech" | "twilio" | "generic"
    credentials     JSONB NOT NULL DEFAULT '{}', -- encrypted at application level
    webhook_token   VARCHAR(255) UNIQUE,         -- for generic webhook URL
    last_polled_at  TIMESTAMP,                   -- for polling-based providers (Alotech)
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW()
);
```

---

## 8. API Endpoints

All endpoints are registered under the `/calls` prefix.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/calls/alotech` | Internal — called by the Alotech poller, not external |
| `POST` | `/calls/twilio` | Twilio webhook receiver |
| `POST` | `/calls/webhook/{token}` | Generic webhook receiver |
| `GET` | `/transcripts/phone_call/{call_id}` | Get transcript (same format as Google Meet) |
| `POST` | `/calls/config` | Save provider credentials for a user |
| `GET` | `/calls/config` | Get current provider config for a user |

The `/transcripts/phone_call/{call_id}` endpoint returns the **same JSON format** as the existing `/transcripts/google_meet/{id}` endpoint. No frontend changes needed to display phone call transcripts.

### Transcript Response (identical to Google Meet)

```json
GET /transcripts/phone_call/call_abc123

{
  "meeting_id": "call_abc123",
  "segments": [
    {
      "speaker": "Agent",
      "text": "Merhaba, sizi nasıl yardımcı olabilirim?",
      "start": 0.0,
      "end": 3.2,
      "language": "tr"
    },
    {
      "speaker": "Caller",
      "text": "Fiyatlarınız hakkında bilgi almak istiyorum.",
      "start": 3.8,
      "end": 6.1,
      "language": "tr"
    }
  ]
}
```

---

## 9. Configuration

Environment variables for the `call-receiver` service:

```env
# Required
DATABASE_URL=postgresql://vexa:secret@postgres:5433/vexa
ASSEMBLYAI_PROXY_URL=http://assemblyai-proxy:8070

# Alotech polling interval (seconds)
ALOTECH_POLL_INTERVAL=60

# Credential encryption key (generate with: openssl rand -hex 32)
CREDENTIALS_ENCRYPTION_KEY=your_32_byte_hex_key
```

Customer credentials (Alotech token, Twilio auth token, etc.) are stored encrypted in the `call_provider_configs.credentials` JSONB column using AES-256. The encryption key is an environment variable, never stored in the database.

---

## 10. Adding a New Provider

To add a new telephony provider:

1. Create `call-receiver/providers/{provider_name}.py`
2. Implement one function: `parse(payload: dict) -> NormalizedCall`
3. If the provider uses webhooks: register a new route in `main.py`
4. If the provider uses polling: add a polling loop in the provider file, called from `main.py` startup
5. Add the provider name to the `provider` enum in `call_provider_configs` table

That is all. The normalizer, pipeline, database writes, and transcript retrieval require no changes.

---

## 11. Key Gotchas

1. **Alotech uses polling, not webhooks.** The CDR API returns records for a time range. Always store `last_polled_at` and query from that timestamp to avoid duplicates.

2. **Twilio requires a fast 200 response.** If you process synchronously, Twilio will retry thinking the webhook failed. Always respond 200 immediately and use `BackgroundTasks` for the actual processing.

3. **Recording URLs may expire.** Alotech and Twilio recording URLs are temporary. Download the audio file immediately after receiving the webhook — do not store the URL and download later.

4. **Audio format varies by provider.** Alotech produces MP3, Twilio produces WAV by default. AssemblyAI accepts both. Do not transcode — pass the file as-is.

5. **Generic webhook token must be treated as a secret.** It identifies a customer account. Rotate it if compromised via the `/calls/config` endpoint.

6. **Credential encryption is mandatory.** Alotech API tokens and Twilio auth tokens give full access to a customer's phone system. Never store them in plaintext.
