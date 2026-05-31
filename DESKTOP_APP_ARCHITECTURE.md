# Ashera Desktop App — Technical Architecture

A complete deep-dive into the Ashera desktop application: an Electron app that embeds Google Meet in a WebView, records and streams audio to the transcription backend, and displays a floating always-on-top live brief overlay during meetings.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Window Architecture](#2-window-architecture)
3. [Live Brief Overlay — How It Floats](#3-live-brief-overlay--how-it-floats)
4. [Audio Capture Pipeline](#4-audio-capture-pipeline)
5. [Live Brief Logic](#5-live-brief-logic)
6. [Main App Screens](#6-main-app-screens)
7. [IPC Communication Map](#7-ipc-communication-map)
8. [Backend Integration](#8-backend-integration)
9. [Data Flow — Meeting Start to First Brief](#9-data-flow--meeting-start-to-first-brief)
10. [Directory Structure](#10-directory-structure)
11. [Key Gotchas](#11-key-gotchas)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                        │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐                       │
│  │   Main Window    │    │  Overlay Window  │                       │
│  │   (BrowserWindow)│    │  (BrowserWindow) │                       │
│  │                  │    │  alwaysOnTop     │                       │
│  │  ┌────────────┐  │    │  transparent     │                       │
│  │  │  WebView   │  │    │  frame: false    │                       │
│  │  │ Google Meet│  │    │                  │                       │
│  │  └────────────┘  │    │  Live brief UI   │                       │
│  │                  │    │  Floats over     │                       │
│  │  Meet screen     │    │  all windows     │                       │
│  │  API settings    │    │                  │                       │
│  └──────────────────┘    └──────────────────┘                       │
│              │                    ▲                                 │
│              │ IPC                │ IPC (brif updates)              │
│              ▼                    │                                 │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    IPC Bridge (main.js)                       │  │
│  │   audio-chunk → backend    transcript-update → overlay        │  │
│  │   meeting-join → backend   brief-update → overlay             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Ashera Backend                                 │
│                                                                     │
│   vexa-lite :8056          assemblyai-proxy :8070                   │
│   call-receiver :8075      PostgreSQL :5433                         │
└─────────────────────────────────────────────────────────────────────┘
```

**Key insight:** There are exactly two Electron windows. The main window is a normal app window with two screens (Meet and API settings). The overlay window is a separate transparent frameless window that floats above everything including full-screen apps. They communicate via Electron IPC through the main process.

---

## 2. Window Architecture

### Main Window

```javascript
new BrowserWindow({
  width: 1100,
  height: 700,
  minWidth: 800,
  minHeight: 500,
  titleBarStyle: 'hiddenInset',   // macOS traffic lights inset
  backgroundColor: '#0e0e11',
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js'),
  }
})
```

The main window loads the local React/HTML app (`app/index.html`). It contains:
- A sidebar with two navigation icons (Meet, API settings)
- A Meet screen with a `<webview>` tag embedding Google Meet
- An API settings screen for connecting Slack, CRM, and telephony providers

### Overlay Window

```javascript
const overlay = new BrowserWindow({
  width: 360,
  height: 220,       // auto-expands as briefs arrive
  x: centerX - 180, // horizontally centered on active display
  y: 60,             // near top, below camera
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'overlay-preload.js'),
  }
})

overlay.setAlwaysOnTop(true, 'screen-saver')   // highest level — above full-screen apps
overlay.setVisibleOnAllWorkspaces(true)          // survives workspace switching on macOS
overlay.setIgnoreMouseEvents(false)              // clickable
```

**Multi-monitor:** When a meeting starts, detect which display the main window is on using `screen.getDisplayNearestPoint(mainWindow.getBounds())`. Place the overlay centered on that display's `workArea`.

### Overlay Positioning Logic

```javascript
function positionOverlay(overlay, mainWindow) {
  const display = screen.getDisplayNearestPoint({
    x: mainWindow.getBounds().x,
    y: mainWindow.getBounds().y
  })
  const { x, y, width } = display.workArea
  overlay.setPosition(
    Math.floor(x + width / 2 - 180),  // center horizontally
    y + 60                              // near top
  )
}
```

Call `positionOverlay` on meeting start and whenever `mainWindow` moves to a different display.

---

## 3. Live Brief Overlay — How It Floats

The overlay window uses `alwaysOnTop: true` with level `'screen-saver'`. This is the highest Electron alwaysOnTop level and renders above:
- Normal application windows
- Full-screen Google Meet
- System notifications
- Other always-on-top windows

`setVisibleOnAllWorkspaces(true)` ensures the overlay persists when the user switches virtual desktops (macOS Mission Control, Windows virtual desktops).

### Overlay Lifecycle

```
Meeting join button clicked
  → Main process creates overlay window
  → Overlay positioned on active display
  → Overlay shows "connecting..." state

Backend confirms meeting active
  → Overlay shows initial alert chips (pre-meeting profile)
  → Timer starts

Transcript segments arrive (every ~10s)
  → Main process sends to Claude API for brief generation
  → Brief response sent to overlay via IPC
  → Overlay animates new brief item in

Meeting ended or user closes overlay
  → Overlay window destroyed
  → Main window notified (meeting_ended event)
```

### Overlay Visibility States

| State | What shows |
|-------|-----------|
| `connecting` | Spinner, "Bağlanıyor..." |
| `pre-meeting` | Alert chips from CRM profile, meeting summary |
| `live` | Alert chips + streaming brief items + deal score |
| `ended` | "Toplantı bitti — rapor hazırlanıyor" fade-out |

---

## 4. Audio Capture Pipeline

The main window's `<webview>` embeds Google Meet. Audio is captured using the Web Audio API injected into the webview via `executeJavaScript`.

```javascript
// Injected into the webview when meeting goes live
webview.executeJavaScript(`
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  const source = ctx.createMediaStreamSource(
    await navigator.mediaDevices.getUserMedia({ audio: true })
  )
  source.connect(dest)

  const recorder = new MediaRecorder(dest.stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 64000
  })

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      e.data.arrayBuffer().then(buf => {
        window.__asheraAudioChunk(new Uint8Array(buf))
      })
    }
  }

  recorder.start(5000)  // 5-second chunks
`)
```

Audio chunks flow: webview JS → `contextBridge` preload → main process → HTTP POST to `assemblyai-proxy :8070`.

---

## 5. Live Brief Logic

Briefs are generated by calling Claude API with the latest transcript segments plus CRM context. This runs in the main process every time a new transcript batch arrives.

### Brief Generation Prompt (current — pre-fine-tune)

```javascript
const systemPrompt = `
You are Ashera, a real-time sales assistant. 
Given a transcript excerpt and CRM context, generate 1-3 brief items for the sales agent.

Rules:
- Max 2 lines per brief item
- Tag each item: "aksiyon" (do something now), "dikkat" (watch out), "bilgi" (useful info)
- Never say "maybe" or "perhaps" — be direct
- If a pricing objection is detected, always suggest a concrete response
- If a technical integration question is asked, check CRM notes for previous blockers
- Output JSON only: {"alerts": [...], "briefs": [...], "deal_score": 0-100}

alerts format: {"type": "price|tech|hot|neutral", "text": "..."}
briefs format: {"tag": "aksiyon|dikkat|bilgi", "text": "...", "is_new": true}
`
```

### Brief Trigger Conditions

Briefs are generated when:
1. A new transcript batch arrives (every ~10 seconds during active meeting)
2. A keyword spike is detected: price-related words, competitor names, integration questions
3. The deal score changes by more than 10 points

Keyword detection runs locally (no API call) using a simple word list before deciding whether to generate a new brief.

### Deal Score

Calculated from transcript analysis:
- Buying signals detected (positive weight)
- Price objections (negative weight)
- Technical blockers (negative weight)
- Decision-maker involvement (positive weight)
- Meeting duration (mild positive — engagement signal)

Score is 0–100. Color thresholds: green ≥ 75, amber ≥ 50, red < 50.

---

## 6. Main App Screens

### Screen 1 — Meet

Two sub-states:

**Idle (no meeting):**
- URL input field
- "Katıl & Kaydı Başlat" button
- Optional: upcoming meetings pulled from Google Calendar (future)

**Live (meeting active):**
- Green status bar: "Canlı · [Company] · [Timer] · Live brif aktif"
- `<webview>` showing Google Meet
- "Toplantıyı Bitir" button

### Screen 2 — API Settings

Three connection groups:

**Slack**
- Connect via OAuth (Slack App OAuth flow opens in system browser)
- Shows: workspace name, selected channel
- Status badge: connected / disconnected

**Telefon sistemi**
- Provider selector: Alotech / Twilio / Diğer
- Alotech: enter API token → Ashera configures webhook automatically
- Twilio: enter Account SID + Auth Token → Ashera configures webhook
- Diğer: shows generated webhook URL to copy
- Status badge: connected / disconnected

**CRM**
- Provider selector: HubSpot / Salesforce / Pipedrive
- OAuth flow for each
- Status badge: connected / disconnected

---

## 7. IPC Communication Map

All IPC goes through the main process. Renderer windows never communicate directly.

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `meeting:join` | Main → Main process | `{ url, meetingId }` | User clicked join |
| `meeting:active` | Main process → Main + Overlay | `{ meetingId, companyName }` | Backend confirmed active |
| `meeting:end` | Main → Main process | `{ meetingId }` | User ended meeting |
| `audio:chunk` | Main (webview) → Main process | `ArrayBuffer` | 5s audio chunk |
| `transcript:new` | Main process → Main | `{ segments }` | New transcript batch |
| `brief:update` | Main process → Overlay | `{ alerts, briefs, dealScore }` | New brief from Claude |
| `overlay:close` | Overlay → Main process | — | User closed overlay |
| `overlay:move` | Main process → Overlay | `{ x, y }` | Reposition on display change |
| `api:save` | Main → Main process | `{ provider, credentials }` | Save API credentials |
| `api:status` | Main process → Main | `{ provider, connected }` | Connection status update |

---

## 8. Backend Integration

### Meeting Start

```
POST http://localhost:8056/bots
{
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "platform": "google_meet",
  "native_meeting_id": "abc-defg-hij",
  "bot_name": "Ashera Bot",
  "language": "tr"
}
```

### Audio Upload (every 5 seconds)

```
POST http://localhost:8070/v1/audio/transcriptions
Content-Type: multipart/form-data
file: <audio chunk>
```

### Transcript Polling (every 10 seconds)

```
GET http://localhost:8056/transcripts/google_meet/{meeting_id}
→ { segments: [...] }
```

New segments since last poll are sent to Claude API for brief generation.

### Pre-meeting CRM Context

Before meeting starts, fetch from CRM (HubSpot/Salesforce via backend proxy):
- Company name, size, industry
- Previous meeting notes
- Known blockers from past interactions
- Deal stage and value

This context is included in every brief generation prompt.

---

## 9. Data Flow — Meeting Start to First Brief

```
t=0s   User pastes Meet URL, clicks "Katıl & Kaydı Başlat"
       Main window sends meeting:join to main process

t=1s   Main process extracts meeting_id from URL
       Fetches CRM context for the company
       Creates overlay window, positions on active display
       Overlay shows "Bağlanıyor..."

t=2s   Main process POSTs to vexa-lite /bots
       Bot joins Google Meet as headless participant
       Audio injection script runs in webview

t=3s   Overlay shows pre-meeting alert chips
       Example: "Fiyata takılı", "Teknik entegrasyon sorusu bekleniyor"
       (from CRM history, not yet from transcript)

t=8s   First audio chunk sent to assemblyai-proxy
       Main process polls /transcripts for first segments

t=18s  First transcript segments available
       Sent to Claude API with CRM context + system prompt
       Claude returns { alerts, briefs, dealScore }

t=19s  Main process sends brief:update to overlay via IPC
       Overlay animates first brief items in
       Deal score displayed

t=30s+ Every new transcript batch triggers a brief update
       Overlay updates in place — new items tagged "yeni"
       Old items fade to lower opacity after 2 updates
```

---

## 10. Directory Structure

```
ashera-desktop/
├── main.js                    # Electron main process
├── preload.js                 # Context bridge for main window
├── overlay-preload.js         # Context bridge for overlay window
├── package.json
├── electron-builder.yml       # Build config for Mac/Win/Linux
│
├── app/                       # Main window UI (React)
│   ├── index.html
│   ├── index.jsx
│   ├── screens/
│   │   ├── MeetScreen.jsx     # WebView + join controls
│   │   └── ApiScreen.jsx      # API connection settings
│   └── components/
│       └── Sidebar.jsx
│
├── overlay/                   # Overlay window UI (plain HTML/JS)
│   ├── index.html
│   ├── overlay.js             # Brief rendering, animations
│   └── overlay.css
│
└── services/                  # Main process services
    ├── briefGenerator.js      # Claude API call + prompt
    ├── transcriptPoller.js    # Polls vexa-lite for new segments
    ├── audioCapture.js        # Injects audio capture into webview
    ├── crmFetcher.js          # Fetches pre-meeting context
    └── credentialStore.js     # Encrypted storage (electron-store)
```

---

## 11. Key Gotchas

1. **Webview vs BrowserView vs iframe**: Use `<webview>` tag (not BrowserView) because it supports `executeJavaScript` for audio injection. Requires `webviewTag: true` in webPreferences. Google Meet works in webview as of Electron 28+ with a real User-Agent string set.

2. **Google Meet microphone permission**: The webview needs microphone access. Set `session.defaultSession.setPermissionRequestHandler` to auto-approve `media` requests from `meet.google.com`.

3. **Overlay clicks through**: On Windows, if the overlay becomes unresponsive to mouse events after a game or full-screen app takes focus, call `overlay.setAlwaysOnTop(true, 'screen-saver')` again. Add a 1-second interval that re-asserts alwaysOnTop during active meetings.

4. **macOS screen recording permission**: The app needs screen recording permission on macOS for audio capture from tabs. Show a clear onboarding dialog before the first meeting directing the user to System Preferences → Privacy → Screen Recording.

5. **Overlay height is dynamic**: Start at 180px. As brief items are added, measure the content height in the overlay renderer and send the new height to the main process via IPC, which calls `overlay.setSize(360, newHeight)`. Max height: 380px — after that, oldest briefs scroll out.

6. **Brief generation rate limiting**: Do not call Claude API on every single transcript update. Implement a minimum 8-second gap between brief generation calls. If a new transcript arrives before 8 seconds, buffer it and include it in the next call.

7. **Credential storage**: Use `electron-store` with encryption for all API tokens (Slack, CRM, telephony). Never log credentials. The encryption key is derived from the machine's hardware ID.

8. **User-Agent for Google Meet webview**: Set to a real Chrome user agent string matching the Electron Chromium version. Google Meet detects headless browsers and blocks them otherwise.
