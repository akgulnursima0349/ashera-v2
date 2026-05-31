# Google Meet Bot — Technical Architecture

A complete deep-dive into how this system joins Google Meet meetings as a headless bot, captures audio, and produces transcripts. After reading this document, you should be able to build the same system from scratch.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Services and Their Roles](#2-services-and-their-roles)
3. [How the Bot Bypasses Google Meet Security](#3-how-the-bot-bypasses-google-meet-security)
4. [Meeting Join Flow — Step by Step](#4-meeting-join-flow--step-by-step)
5. [Audio Capture Pipeline](#5-audio-capture-pipeline)
6. [Transcription Pipeline](#6-transcription-pipeline)
7. [Speaker Detection](#7-speaker-detection)
8. [Data Flow: Audio to Database](#8-data-flow-audio-to-database)
9. [API Layer](#9-api-layer)
10. [Database Schema](#10-database-schema)
11. [Building Your Own](#11-building-your-own)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User / Ashera UI                        │
│                    POST /bots  →  GET /transcripts              │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        vexa-lite :8056                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  API Gateway│  │  Bot Manager │  │ Transcription Collector│ │
│  │  :8056      │  │  :8080       │  │  :8123                 │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬─────────────┘ │
│         │                │                      │               │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌──────────▼─────────────┐ │
│  │  Admin API  │  │  WhisperLive │  │       Redis Streams     │ │
│  │  :8057      │  │  :9090       │  │       :6379             │ │
│  └─────────────┘  └──────┬───────┘  └─────────────────────────┘ │
│                          │ HTTP                                  │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│               assemblyai-proxy :8070                             │
│         Accumulates audio chunks → AssemblyAI Batch API          │
└──────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│               vexa-bot (Node.js process, Playwright)              │
│    Runs inside vexa-lite, one process per meeting                 │
│    Chromium → Google Meet → Web Audio API → WhisperLive WS       │
└───────────────────────────────────────────────────────────────────┘
```

**Key insight:** The bot is a headless Chromium browser controlled by Playwright that joins the meeting like a real human. Audio is captured via the Web Audio API inside the browser, then streamed over WebSocket to the transcription service.

---

## 2. Services and Their Roles

| Service | Port | Language | Role |
|---------|------|----------|------|
| `vexa-lite` | 8056 | Python (FastAPI) | All-in-one container: API Gateway, Bot Manager, WhisperLive, Transcription Collector, Redis |
| `assemblyai-proxy` | 8070 | Python (FastAPI) | Accumulates 5s audio chunks, sends to AssemblyAI batch API |
| `ashera-ui` | 3000 | Python (FastAPI) | Web UI + proxy to vexa-lite API |
| `postgres` | 5433 | PostgreSQL 15 | Persistent storage: users, meetings, transcripts |
| `redis` | 6379 | Redis 7 | Message bus between WhisperLive and Transcription Collector |

### Inside `vexa-lite` (Supervisor-managed processes)

```
supervisord
├── redis-server          :6379  (internal bus)
├── Xvfb :99                     (virtual X11 display for Chromium)
├── whisperlive           :9090  (WebSocket server, remote backend)
├── transcription-collector :8123 (reads Redis, writes to PostgreSQL)
├── admin-api             :8057  (user and token management)
├── bot-manager           :8080  (bot lifecycle)
├── api-gateway           :8056  (public API, routes to internal services)
└── mcp                   :18888 (Claude/Cursor integration)
```

---

## 3. How the Bot Bypasses Google Meet Security

Google Meet has several layers of protection against automated access:

### 3.1 Bot Detection

Google Meet uses:
- **User-Agent fingerprinting** — detecting non-browser UAs
- **WebGL and Canvas fingerprinting** — detecting headless rendering
- **Behavioral analysis** — mouse patterns, click timing, scroll events
- **Chrome DevTools Protocol detection** — checking `navigator.webdriver`

### 3.2 The Solution: Playwright + Stealth Plugin

The bot uses **Playwright Extra** with **`puppeteer-extra-plugin-stealth`**, which patches the browser at the JavaScript runtime level to remove all headless fingerprints:

```typescript
// src/index.ts
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { chromium } from "playwright-extra";

chromium.use(StealthPlugin());
```

The stealth plugin patches:
- `navigator.webdriver` → `undefined` (instead of `true`)
- `navigator.plugins` → realistic plugin list
- `navigator.languages` → real browser language list
- `window.chrome` → Chrome runtime object
- `WebGL renderer` → real GPU vendor string
- Canvas fingerprint → randomized

### 3.3 Chromium Launch Flags

```typescript
// src/constans.ts
export const browserArgs = [
  "--incognito",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--disable-gpu",
  "--use-fake-ui-for-media-stream",       // Grants mic/camera permission without popup
  "--use-file-for-fake-video-capture=/dev/null",  // Fake camera (black screen)
  "--use-file-for-fake-audio-capture=/dev/null",  // Fake mic input (silent)
  "--allow-running-insecure-content",
  "--disable-web-security",
  "--ignore-certificate-errors",
  "--disable-site-isolation-trials"
];
```

**Critical flags explained:**
- `--use-fake-ui-for-media-stream`: Automatically grants microphone/camera permissions without showing the browser permission dialog. Without this, Google Meet would block at the permissions prompt.
- `--use-file-for-fake-video-capture=/dev/null`: The bot has a "camera" but it outputs nothing. This is needed so Google Meet's pre-join screen doesn't fail.
- `--no-sandbox`: Required for running Chromium as root inside Docker.

### 3.4 User Agent Spoofing

```typescript
export const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
```

The bot presents itself as Chrome 129 on Windows 10 — a common, unsuspicious user agent.

### 3.5 Virtual Display (Xvfb)

Chromium requires a display server even in "headless" mode when running with stealth (truly headless Chromium has different fingerprints). The container runs **Xvfb** (X Virtual Frame Buffer) on display `:99`, which provides a virtual monitor without physical hardware:

```ini
[program:xvfb]
command=Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset
```

Chromium runs with `DISPLAY=:99` environment variable.

---

## 4. Meeting Join Flow — Step by Step

```
Bot Manager API call
       │
       ▼
1. Spawn Node.js process (vexa-bot/dist/docker.js)
       │
       ▼
2. Launch Chromium (playwright-extra + stealth)
   DISPLAY=:99, fake mic/camera, Windows UA
       │
       ▼
3. Navigate to https://meet.google.com/{meeting-code}
   page.goto(meetingUrl, { waitUntil: "networkidle" })
       │
       ▼
4. Wait for name input field (up to 120s)
   selector: 'input[type="text"][aria-label="Your name"]'
       │
       ▼
5. Fill in bot name (e.g., "Ashera Bot")
       │
       ▼
6. Mute microphone and camera
   (bot listens only, never sends audio/video)
       │
       ▼
7. Click "Ask to join" button
   selector: '//button[.//span[text()="Ask to join"]]'
       │
       ▼
8. Wait for admission (polling every 2s)
   ├── Check for waiting room indicators
   │   e.g., 'text="Asking to be let in..."'
   ├── Check for rejection indicators
   │   e.g., 'text="Meeting not found"'
   └── Check for admission indicators (need ≥2)
       e.g., 'button[aria-label*="Leave call"]'
            'button[aria-label*="People"]'
       │
       ▼
9. Admitted → Start audio capture
```

### 4.1 Admission Detection Strategy

Google Meet's UI changes frequently, so the bot uses multiple selector strategies simultaneously. For admission, it requires **at least 2 indicators** to be present (to avoid false positives from waiting room UI elements):

```typescript
// googlemeet/admission.ts
const googleInitialAdmissionIndicators = [
  'button[aria-label*="People"]',
  'button[aria-label*="Chat"]',
  'button[aria-label*="Leave call"]',
  '[role="toolbar"]',
  '[data-participant-id]',
  'button[aria-label*="Turn off microphone"]',
  // ...
];

// Requires ≥2 visible and enabled indicators
if (foundSelectors.length >= 2) {
  return true; // Admitted
}
```

### 4.2 Waiting Room Handling

If the host requires manual admission, the bot waits in the waiting room and polls every 2 seconds. Waiting room is detected by:

```typescript
const googleWaitingRoomIndicators = [
  'text="Asking to be let in..."',
  'text="You\'ll join the call when someone lets you in"',
  '[role="progressbar"]',
  // ...
];
```

---

## 5. Audio Capture Pipeline

Once admitted, audio capture starts inside the browser context via the Web Audio API.

### 5.1 Audio Source Discovery

```typescript
// services/audio.ts
async findMediaElements(): Promise<HTMLMediaElement[]> {
  return Array.from(document.querySelectorAll("audio, video"))
    .filter(el =>
      !el.paused &&
      el.srcObject instanceof MediaStream &&
      el.srcObject.getAudioTracks().length > 0
    );
}
```

Google Meet renders all participants' audio through `<audio>` and `<video>` DOM elements. The bot finds all active media elements and combines them into a single audio stream.

### 5.2 Audio Graph

```
Audio Elements (all participants)
         │
         ▼
MediaStreamAudioSourceNode (×N, one per participant)
         │ (all connected to same destination)
         ▼
MediaStreamAudioDestinationNode  (combined stream)
         │
         ▼
MediaStreamAudioSourceNode  (re-read combined stream)
         │
         ▼
ScriptProcessorNode  (bufferSize=4096)
         │  onaudioprocess callback fires every ~85ms
         ▼
GainNode (gain=0, silent — no playback)
         │
         ▼
AudioContext.destination  (required to keep graph alive)
```

**Why `gainNode.gain = 0`?** The bot doesn't play any audio — it's invisible to other participants. The gain node is required to keep the Web Audio graph active (Chrome garbage-collects disconnected graphs).

### 5.3 Resampling

Google Meet's audio context runs at 48kHz. AssemblyAI requires 16kHz. The bot resamples on the fly using linear interpolation:

```typescript
private resampleAudioData(inputData: Float32Array, sourceSampleRate: number): Float32Array {
  const targetLength = Math.round(
    inputData.length * (16000 / sourceSampleRate)
  );
  const resampledData = new Float32Array(targetLength);
  const springFactor = (inputData.length - 1) / (targetLength - 1);

  for (let i = 1; i < targetLength - 1; i++) {
    const index = i * springFactor;
    const leftIndex = Math.floor(index);
    const rightIndex = Math.ceil(index);
    const fraction = index - leftIndex;
    resampledData[i] =
      inputData[leftIndex] +
      (inputData[rightIndex] - inputData[leftIndex]) * fraction;
  }
  return resampledData;  // Float32, mono, 16kHz
}
```

### 5.4 Sending Audio to WhisperLive

The resampled Float32Array is sent directly over WebSocket to WhisperLive:

```typescript
// Binary message: raw Float32Array bytes
socket.send(audioData.buffer);

// Metadata message (sent alongside each chunk)
socket.send(JSON.stringify({
  type: "audio_chunk_metadata",
  payload: {
    length: audioData.length,
    sample_rate: 16000,
    client_timestamp_ms: Date.now(),
  }
}));
```

---

## 6. Transcription Pipeline

```
Bot (browser)
   │  WebSocket (Float32 binary frames)
   ▼
WhisperLive :9090  (inside vexa-lite, remote backend mode)
   │  HTTP POST multipart/form-data (WAV file)
   │  Every ~1s (LIFO — latest audio chunk)
   ▼
assemblyai-proxy :8070
   │  Accumulates chunks until buffer ≥ 5s
   │  HTTP POST to AssemblyAI
   ▼
AssemblyAI Batch API
   │  Returns transcript with word-level timestamps
   ▼
assemblyai-proxy
   │  Converts to Whisper-format JSON response
   ▼
WhisperLive
   │  Parses segments, writes to Redis Stream
   ▼
Redis Stream: "transcription_segments"
   │
   ▼
Transcription Collector :8123
   │  Reads from Redis, resolves speaker names
   ▼
PostgreSQL: transcriptions table
```

### 6.1 WhisperLive WebSocket Handshake

When the bot connects, it sends a JSON configuration as the first message:

```json
{
  "uid": "550e8400-e29b-41d4-a716-446655440000",
  "language": "en",
  "task": "transcribe",
  "model": null,
  "use_vad": false,
  "platform": "google_meet",
  "token": "<JWT meeting token>",
  "meeting_id": 31,
  "meeting_url": "https://meet.google.com/abc-defg-hij"
}
```

WhisperLive responds with `SERVER_READY`, after which audio data can flow.

### 6.2 The Buffer Problem and Solution

**Problem:** WhisperLive (LIFO mode) sends fresh ~1s audio chunks on every HTTP request to the transcription backend. It does not accumulate. When the backend returns empty (no transcription), WhisperLive interprets it as "silence detected" and advances its window — it never builds up to larger chunks.

**Solution:** The `assemblyai-proxy` maintains its own internal accumulation buffer:

```python
# assemblyai-proxy/main.py

class AudioBuffer:
    def add(self, wav_bytes: bytes) -> float:
        """Append fresh chunk, return total buffered duration."""
        frames = _wav_frames(wav_bytes)
        self._frames.append(frames)
        self._total_duration += _wav_duration(wav_bytes)
        return self._total_duration

    def flush(self) -> Optional[bytes]:
        """Return all buffered audio as single WAV, then clear."""
        wav = _build_wav(b"".join(self._frames), self._params)
        self._frames.clear()
        self._total_duration = 0.0
        return wav

_buffer = AudioBuffer()

@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile, ...):
    wav_bytes = await file.read()
    total = _buffer.add(wav_bytes)

    if total < MIN_CHUNK_SECONDS:  # 5.0 seconds
        return _EMPTY  # {"text": "", "segments": []}

    buffered_wav = _buffer.flush()
    return _transcribe(buffered_wav, lang)  # Send 5s to AssemblyAI
```

Every ~1s chunk is accumulated. When 5 seconds of audio has been collected, it is flushed to AssemblyAI as a single request.

### 6.3 AssemblyAI Transcription

```python
config = aai.TranscriptionConfig(
    language_code=language,
    punctuate=True,
    format_text=True,
    disfluencies=False,
    speech_model=aai.SpeechModel.best,
)
transcript = aai.Transcriber(config=config).transcribe(io.BytesIO(wav_bytes))
```

AssemblyAI returns:
- Full transcript text
- Word-level timestamps (start/end in milliseconds)
- Confidence scores per word

### 6.4 Segment Building

Word-level data is grouped into sentence segments using:
- **Pause detection**: gap between consecutive words > 600ms → new segment
- **Sentence boundaries**: text ending in `.`, `?`, `!` with ≥3 words → new segment
- **Max length**: 50 words per segment

The output is formatted to match the Whisper `verbose_json` response format so WhisperLive can parse it.

### 6.5 Redis Stream

WhisperLive writes finalized segments to Redis Streams:

```
Stream key: "transcription_segments"

Entry fields:
  payload: {
    "type": "transcription",
    "token": "<JWT>",
    "platform": "google_meet",
    "meeting_id": 31,
    "uid": "<session-uuid>",
    "segments": [
      {
        "text": "We help sales teams get more out of every conversation.",
        "start": 13.367,
        "end": 19.527,
        "completed": true,
        "language": "en"
      }
    ]
  }
```

### 6.6 Transcription Collector

Reads from Redis Streams as a consumer group, maps speaker events to segments, and writes to PostgreSQL:

```
Consumer group: "collector_group"
Stream: "transcription_segments"

For each entry:
  1. Parse JSON payload
  2. Match segment timestamps to speaker events
  3. Write to transcriptions table
```

---

## 7. Speaker Detection

The bot detects who is speaking by monitoring CSS class changes on participant DOM elements.

### 7.1 Speaking Class Detection

Google Meet adds CSS classes to participant tiles when they are speaking:

```typescript
// googlemeet/selectors.ts
export const googleSpeakingClassNames = [
  'Oaajhc',   // Speaking animation class (Google's obfuscated class)
  'HX2H7',    // Alternative speaking class
  'wEsLMd',   // Another speaking indicator
  'OgVli',    // Additional speaking class
  'speaking',
  'active-speaker',
  // ...
];
```

The bot runs a `MutationObserver` inside the browser to watch for class changes on `[data-participant-id]` elements.

### 7.2 Speaker Events

When speaking state changes, a message is sent over WebSocket to WhisperLive:

```json
{
  "type": "speaker_activity",
  "payload": {
    "event_type": "started_speaking",
    "participant_name": "Nur Sima Akgül",
    "participant_id_meet": "abc123",
    "relative_client_timestamp_ms": 45230,
    "uid": "<session-uuid>",
    "platform": "google_meet",
    "meeting_id": "abc-defg-hij"
  }
}
```

The Transcription Collector correlates these timestamps with transcript segment timestamps to assign speaker names to each segment.

---

## 8. Data Flow: Audio to Database

```
t=0s   Bot joins meeting, audio capture starts
       Float32Array frames → WebSocket → WhisperLive

t=1s   WhisperLive sends 1s WAV → assemblyai-proxy
       Buffer: 1.0s / 5.0s → return _EMPTY

t=2s   WhisperLive sends 1s WAV → assemblyai-proxy
       Buffer: 2.0s / 5.0s → return _EMPTY

t=5s   WhisperLive sends 1s WAV → assemblyai-proxy
       Buffer: 5.0s / 5.0s → FLUSH → AssemblyAI API

t=8s   AssemblyAI returns transcript (3s latency)
       assemblyai-proxy → Whisper-format JSON → WhisperLive
       WhisperLive → Redis Stream entry

t=8s   Transcription Collector reads Redis entry
       Matches speaker events → writes to PostgreSQL

t=8s   User calls GET /transcripts/google_meet/{id}
       API Gateway → Transcription Collector → PostgreSQL → Response
```

**Total latency from speech to database:** ~8-10 seconds (5s buffer + 3s AssemblyAI processing).

---

## 9. API Layer

### Public Endpoints (API Gateway :8056)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/users` | Create user (requires admin token) |
| `POST` | `/admin/users/{id}/tokens` | Generate API key |
| `POST` | `/bots` | Start bot in a meeting |
| `DELETE` | `/bots/{platform}/{meeting_id}` | Stop bot |
| `GET` | `/transcripts/{platform}/{meeting_id}` | Get transcript |
| `GET` | `/bots/status` | List active bots |

### Authentication

- **Admin endpoints**: `x-admin-api-key: <ADMIN_API_TOKEN>` header
- **User endpoints**: `X-API-Key: <user-token>` header

### Start Bot Request

```json
POST /bots
{
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "platform": "google_meet",
  "native_meeting_id": "abc-defg-hij",
  "bot_name": "Ashera Bot",
  "language": "en"
}
```

### Transcript Response

```json
GET /transcripts/google_meet/abc-defg-hij

{
  "meeting_id": "abc-defg-hij",
  "segments": [
    {
      "speaker": "Nur Sima Akgül",
      "text": "We help sales teams get more out of every conversation.",
      "start": 13.367,
      "end": 19.527,
      "language": "en"
    }
  ]
}
```

---

## 10. Database Schema

```sql
-- Users (API key holders)
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(255) UNIQUE NOT NULL,
    name        VARCHAR(255),
    created_at  TIMESTAMP DEFAULT NOW()
);

-- API Tokens (one user can have multiple)
CREATE TABLE api_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    token       VARCHAR(255) UNIQUE NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- Meetings (one per bot session)
CREATE TABLE meetings (
    id                   SERIAL PRIMARY KEY,
    user_id              INTEGER REFERENCES users(id),
    platform             VARCHAR(100) NOT NULL,   -- "google_meet"
    platform_specific_id VARCHAR(255),            -- "abc-defg-hij"
    status               VARCHAR(50) NOT NULL,    -- requested|joining|active|stopping|completed|failed
    bot_container_id     VARCHAR(255),
    start_time           TIMESTAMP,
    end_time             TIMESTAMP,
    data                 JSONB NOT NULL DEFAULT '{}'
);

-- Transcriptions (one row per segment)
CREATE TABLE transcriptions (
    id          SERIAL PRIMARY KEY,
    meeting_id  INTEGER REFERENCES meetings(id),
    start_time  FLOAT NOT NULL,   -- seconds from meeting start
    end_time    FLOAT NOT NULL,
    text        TEXT NOT NULL,
    speaker     VARCHAR(255),
    language    VARCHAR(10),
    session_uid VARCHAR,          -- links to WhisperLive session
    created_at  TIMESTAMP
);
```

---

## 11. Building Your Own

To build the same system from scratch, here are the key components and decisions:

### 11.1 The Browser Bot (Node.js)

**Required packages:**
```json
{
  "playwright-extra": "^4.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2",
  "playwright": "^1.40.0"
}
```

**Core loop:**
1. Launch `chromium` with stealth plugin + headless args
2. Set fake mic/camera flags so permission prompts are auto-accepted
3. Navigate to meeting URL
4. Fill name field, click join
5. Poll for admission indicators (≥2 simultaneously visible)
6. Inject audio capture code into page context via `page.evaluate()`
7. Connect WebSocket to transcription service
8. Stream `Float32Array` audio data continuously

**Audio injection pattern:**
```typescript
await page.evaluate(async (config) => {
  // This code runs inside Chrome
  const audioElements = document.querySelectorAll("audio, video");
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();

  audioElements.forEach(el => {
    if (el.srcObject) {
      ctx.createMediaStreamSource(el.srcObject).connect(dest);
    }
  });

  const processor = ctx.createScriptProcessor(4096, 1, 1);
  ctx.createMediaStreamSource(dest.stream).connect(processor);
  processor.connect(ctx.createGain()); // keep graph alive

  processor.onaudioprocess = (e) => {
    const raw = e.inputBuffer.getChannelData(0);
    const resampled = resampleTo16k(raw, ctx.sampleRate);
    websocket.send(resampled.buffer);
  };
}, config);
```

### 11.2 The Transcription Backend

**Option A: AssemblyAI Batch (this project)**
- Accumulate 5s of audio chunks from WhisperLive
- Send as WAV to `POST https://api.assemblyai.com/v2/transcript`
- Best for: cost efficiency, high accuracy
- Latency: 8-10s

**Option B: AssemblyAI Real-time Streaming**
- WebSocket connection to `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000`
- Send PCM16 audio frames continuously
- Best for: low latency (~1-2s)
- Requires: Streaming STT plan (paid feature)
- Note: Float32 → PCM16 conversion required: `(arr * 32767).astype('<i2')`

**Option C: OpenAI Whisper / Groq**
- Groq's Whisper API is free and fast
- Same OpenAI-compatible API format
- URL: `https://api.groq.com/openai/v1/audio/transcriptions`

### 11.3 The Transcription Relay (WhisperLive)

WhisperLive acts as the WebSocket bridge between the bot and the HTTP transcription API. It:
- Accepts binary audio frames over WebSocket
- Buffers them into chunks
- Calls the remote transcription backend
- Returns results to the bot
- Writes final segments to Redis Streams

You can replace WhisperLive with any WebSocket server that does the same job.

### 11.4 Infrastructure Checklist

| Component | Purpose | Can Replace With |
|-----------|---------|-----------------|
| Playwright + Stealth | Headless browser, fingerprint masking | Puppeteer + stealth |
| Xvfb | Virtual display for Chromium | Actual headless mode (lower stealth) |
| WhisperLive | WS ↔ HTTP audio bridge + Redis writer | Custom FastAPI WebSocket server |
| AssemblyAI | Speech-to-text | OpenAI Whisper, Groq, Deepgram |
| Redis Streams | Async message bus | RabbitMQ, Kafka, direct DB writes |
| PostgreSQL | Transcript storage | Any relational DB |
| FastAPI | REST API | Express, NestJS, Flask |

### 11.5 Docker Compose Minimal Setup

```yaml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: vexa
      POSTGRES_USER: vexa
      POSTGRES_PASSWORD: secret

  redis:
    image: redis:7-alpine

  your-bot-service:
    build: ./bot
    environment:
      DISPLAY: ":99"           # Xvfb display
      WHISPER_LIVE_URL: ws://your-transcriber:9090
    # Must mount Docker socket if spawning bots as containers:
    # volumes:
    #   - /var/run/docker.sock:/var/run/docker.sock

  your-transcriber:
    build: ./transcriber
    environment:
      ASSEMBLYAI_API_KEY: ${ASSEMBLYAI_API_KEY}
      REDIS_URL: redis://redis:6379/0
```

### 11.6 Key Gotchas

1. **Google Meet UI changes frequently.** CSS class names like `Oaajhc` (speaking indicator) are obfuscated and change with UI updates. Build multiple fallback selectors for every interaction.

2. **Require ≥2 admission indicators.** Single selectors like "Leave call" can appear in the waiting room, causing false "admitted" detection.

3. **WhisperLive LIFO mode sends fixed-size chunks.** It does NOT grow its buffer. Your backend must accumulate chunks independently.

4. **Float32 vs PCM16.** The Web Audio API produces Float32 (`-1.0` to `+1.0`). Most speech APIs expect PCM16 (int16, little-endian). AssemblyAI's batch API accepts WAV (any PCM format). AssemblyAI's real-time WebSocket requires PCM16 raw bytes.

5. **Xvfb + stealth > truly headless.** Running Chromium with a virtual display (`--display=:99`) produces a less detectable fingerprint than `--headless=new` mode.

6. **The bot needs camera/mic permissions silently.** Use `--use-fake-ui-for-media-stream` Chrome flag. Without it, the permission dialog blocks the bot.

7. **Speaker detection is fragile.** Google obfuscates CSS class names. The speaking class `Oaajhc` was correct as of early 2026 but will likely change. Build a fallback: audio level monitoring via `getByteTimeDomainData()` on the AudioAnalyserNode as an alternative to class-based detection.
