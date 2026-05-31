# Slack Bot Service — Technical Architecture

This document describes the `slack-bot` service: a standalone Node.js/Fastify service that connects the Ashera backend to Slack. It sends automated DMs to sales agents, handles slash commands, and manages OAuth installations for multiple workspaces.

---

## Table of Contents

1. [How It Fits Into the Existing System](#1-how-it-fits-into-the-existing-system)
2. [Service Overview](#2-service-overview)
3. [What the Bot Does](#3-what-the-bot-does)
4. [OAuth Flow — Installing to Customer Workspaces](#4-oauth-flow--installing-to-customer-workspaces)
5. [Message Format](#5-message-format)
6. [Slash Command Handler](#6-slash-command-handler)
7. [Report Generation](#7-report-generation)
8. [Database Changes](#8-database-changes)
9. [API Endpoints](#9-api-endpoints)
10. [Configuration](#10-configuration)
11. [Directory Structure](#11-directory-structure)
12. [Key Gotchas](#12-key-gotchas)

---

## 1. How It Fits Into the Existing System

```
┌──────────────────────────────────────────────────────────────────┐
│                     Existing Backend                             │
│                                                                  │
│   vexa-lite :8056        assemblyai-proxy :8070                  │
│   call-receiver :8075    PostgreSQL :5433                        │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTP (fetch transcripts + meetings)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    slack-bot :8076  (NEW)                        │
│                                                                  │
│  ┌─────────────────┐   ┌──────────────────┐                      │
│  │ OAuth Handler   │   │ Command Handler  │                      │
│  │ /slack/oauth    │   │ /slack/commands  │                      │
│  └────────┬────────┘   └────────┬─────────┘                      │
│           │                     │                                │
│  ┌────────▼─────────────────────▼─────────┐                      │
│  │          Report Generator              │                      │
│  │  Claude API → pre/post meeting reports │                      │
│  └────────────────────┬───────────────────┘                      │
│                       │                                          │
│  ┌────────────────────▼───────────────────┐                      │
│  │          Slack Sender                  │                      │
│  │  Slack Web API → DM to sales agent     │                      │
│  └────────────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────────────┘
                               │
                               │ HTTPS (Slack Web API)
                               ▼
                    ┌──────────────────────┐
                    │   Slack Platform     │
                    │   Sales agent's DM   │
                    └──────────────────────┘
```

**Key insight:** The slack-bot service never modifies existing services. It reads transcript and meeting data from PostgreSQL (same database) and sends messages to Slack. It is triggered either by an incoming slash command from Slack or by a POST from vexa-lite/call-receiver when a meeting ends.

---

## 2. Service Overview

| Property | Value |
|----------|-------|
| Port | 8076 |
| Language | Node.js 20 |
| Framework | Fastify |
| Slack SDK | `@slack/bolt` (handles signing secret verification, OAuth) |
| New dependencies | `@slack/bolt`, `@slack/web-api`, `@anthropic-ai/sdk`, `pg` |
| Existing services touched | None — reads PostgreSQL directly, POSTed to by vexa-lite |

---

## 3. What the Bot Does

### Triggered automatically (by backend)

**When a meeting ends:**
vexa-lite or call-receiver POSTs to `POST /slack/notify/meeting-ended` with the meeting_id. The bot:
1. Fetches the full transcript from PostgreSQL
2. Sends transcript to Claude API to generate a post-meeting report
3. Sends the report as a DM to the sales agent on Slack
4. Includes an "CRM'e Aktar" button (interactive message) — not functional yet, prepared for next phase

### Triggered by slash commands

**`/ashera rapor`**
- Finds the most recent completed meeting for this Slack user
- Generates and sends the post-meeting report as a DM

**`/ashera hazırla`**
- Generates a generic pre-meeting preparation message
- In this phase: asks the agent to provide the company name, then generates a brief profile
- Calendar integration comes in the next phase

**`/ashera yardım`**
- Sends a help message listing available commands

---

## 4. OAuth Flow — Installing to Customer Workspaces

The Ashera Slack App (App ID: A0A9NUF6UEP) is already created. This service handles the OAuth flow that allows it to be installed in any customer workspace.

### Installation Flow

```
t=0  User clicks "Slack ile bağlan" in Ashera desktop app
     Desktop app opens this URL in system browser:
     https://slack.com/oauth/v2/authorize
       ?client_id={SLACK_CLIENT_ID}
       &scope=chat:write,im:write,users:read,commands,app_mentions:read,im:history
       &redirect_uri=https://api.ashera.net/slack/oauth/callback

t=1  Slack shows permission screen to user
     User clicks "Allow"

t=2  Slack redirects to:
     https://api.ashera.net/slack/oauth/callback?code=xyz

t=3  slack-bot exchanges code for access token:
     POST https://slack.com/api/oauth.v2.access
     client_id + client_secret + code + redirect_uri

t=4  Slack returns:
     {
       "access_token": "xoxb-...",
       "team": { "id": "T123", "name": "Acme Corp" },
       "authed_user": { "id": "U456" }
     }

t=5  slack-bot saves token to slack_installations table in PostgreSQL
     Redirects browser to: ashera://oauth/success (opens desktop app)
     OR shows a success HTML page

t=6  Desktop app polls GET /slack/installation/status
     Receives { connected: true, workspace: "Acme Corp", user_id: "U456" }
     Updates API settings screen
```

### Token Storage

Each workspace installation is stored in the `slack_installations` table (see Database Changes). One row per (workspace_id, user_id) pair. When the bot needs to send a DM, it looks up the token by user_id.

---

## 5. Message Format

All messages use Slack Block Kit for rich formatting.

### Post-Meeting Report Message

```
┌─────────────────────────────────────────────────┐
│ 📋 Toplantı Raporu — TechCorp                   │
│ 14 May 2026 · 42 dk · Google Meet               │
├─────────────────────────────────────────────────┤
│ ÖZET                                            │
│ TechCorp fiyat konusunda tereddütlü, SSO        │
│ entegrasyonu ana blocker. Q3 bütçesine           │
│ kilitli, karar Haziran sonuna kadar.             │
├─────────────────────────────────────────────────┤
│ AKSİYONLAR                                      │
│ ☐ SSO dokümanını gönder — 16 May                │
│ ☐ Pilot teklif hazırla — 20 May                 │
├─────────────────────────────────────────────────┤
│ SATIŞ SİNYALLERİ                                │
│ 🟢 Fiyatı proaktif sordular                     │
│ 🟡 SSO konusunda tereddüt                       │
│ 🔴 Gong kullandıklarını belirtti                │
├─────────────────────────────────────────────────┤
│ Deal skoru: 68/100                              │
├─────────────────────────────────────────────────┤
│ [CRM'e Aktar]  [Transkripti Gör]               │
└─────────────────────────────────────────────────┘
```

### Pre-Meeting Report Message

```
┌─────────────────────────────────────────────────┐
│ 🎯 Toplantı Hazırlık Brifiniz                   │
│ TechCorp · Az sonra                             │
├─────────────────────────────────────────────────┤
│ DİKKAT EDİLECEKLER                             │
│ ⚠️ Fiyata takılı — önceki görüşmede 3 kez       │
│    gündeme getirdi                              │
│ ⚠️ SSO desteği sorulacak — IT ekibi dahil        │
├─────────────────────────────────────────────────┤
│ HAZIRLIK NOTLARI                                │
│ • Rakip: Gong kullanıyorlar                     │
│ • Bütçe: Q3, karar yetkisi CTO'da              │
│ • Son görüşme: 3 hafta önce, demo               │
└─────────────────────────────────────────────────┘
```

---

## 6. Slash Command Handler

Slack sends a POST to `/slack/commands` when a user types `/ashera`.

### Request Verification

Every incoming Slack request must be verified using the Signing Secret before processing. `@slack/bolt` handles this automatically — do not skip verification.

### Command Routing

```
/ashera rapor    → handleRapor(user_id, workspace_id)
/ashera hazırla  → handleHazirla(user_id, workspace_id)
/ashera yardım   → handleYardim(user_id)
/ashera          → handleYardim(user_id)  (default)
```

### Response Timing

Slack requires a response within 3 seconds. For commands that trigger Claude API calls (which take 5-10s), the pattern is:
1. Immediately respond with HTTP 200 and `{"response_type": "in_channel", "text": "Hazırlanıyor..."}` 
2. Process in background
3. Send the actual report as a follow-up DM via Slack Web API

---

## 7. Report Generation

Reports are generated by calling the Claude API with the transcript text.

### Post-Meeting Report Prompt

```javascript
const systemPrompt = `
Sen Ashera'sın, bir satış zekası asistanı.
Verilen satış görüşmesi transkriptinden Türkçe bir toplantı sonrası rapor üret.

Çıktı formatı — sadece JSON, başka hiçbir şey yazma:
{
  "company": "şirket adı",
  "summary": "2-3 cümle özet",
  "actions": [
    { "text": "aksiyon maddesi", "deadline": "tarih veya null" }
  ],
  "signals": [
    { "type": "positive|neutral|negative", "text": "sinyal açıklaması" }
  ],
  "dealScore": 0-100
}

Kurallar:
- Özet maksimum 3 cümle
- Maksimum 5 aksiyon maddesi
- Maksimum 4 sinyal
- Deal skoru: alım sinyalleri artırır, itirazlar azaltır, başlangıç 50
- Türkçe yaz
`
```

### Pre-Meeting Report Prompt

```javascript
const systemPrompt = `
Sen Ashera'sın, bir satış zekası asistanı.
Verilen önceki toplantı transkriptlerinden ve notlardan toplantı öncesi hazırlık brifingi üret.

Çıktı formatı — sadece JSON:
{
  "warnings": ["dikkat edilecek madde 1", "madde 2"],
  "preparation": ["hazırlık notu 1", "not 2"],
  "context": "1-2 cümle genel bağlam"
}

Kurallar:
- Maksimum 3 uyarı
- Maksimum 4 hazırlık notu
- Kısa ve aksiyon odaklı yaz
- Türkçe yaz
`
```

---

## 8. Database Changes

**No changes to existing tables.**

Two new tables:

```sql
-- Stores Slack OAuth installations (one per workspace+user)
CREATE TABLE IF NOT EXISTS slack_installations (
    id              SERIAL PRIMARY KEY,
    workspace_id    VARCHAR(50) NOT NULL,
    workspace_name  VARCHAR(255),
    user_id         VARCHAR(50) NOT NULL,         -- Slack user ID (U...)
    bot_token       VARCHAR(255) NOT NULL,         -- xoxb-... token
    ashera_user_id  INTEGER REFERENCES users(id), -- links to existing users table
    installed_at    TIMESTAMP DEFAULT NOW(),
    is_active       BOOLEAN DEFAULT TRUE,
    UNIQUE(workspace_id, user_id)
);

-- Links Ashera meetings to Slack users (so bot knows who to DM)
CREATE TABLE IF NOT EXISTS meeting_slack_links (
    id              SERIAL PRIMARY KEY,
    meeting_id      INTEGER REFERENCES meetings(id),
    slack_user_id   VARCHAR(50) NOT NULL,
    workspace_id    VARCHAR(50) NOT NULL,
    notified        BOOLEAN DEFAULT FALSE,         -- whether post-meeting DM was sent
    created_at      TIMESTAMP DEFAULT NOW()
);
```

### How Meeting → Slack User Linking Works

When a user joins a meeting via the desktop app:
1. Desktop app sends `POST /slack/link-meeting` with `{ meeting_id, slack_user_id, workspace_id }`
2. slack-bot saves a row to `meeting_slack_links`
3. When meeting ends, slack-bot looks up this table to find who to DM

---

## 9. API Endpoints

| Method | Path | Caller | Description |
|--------|------|--------|-------------|
| `GET` | `/slack/oauth/install` | Desktop app (browser) | Redirects to Slack OAuth |
| `GET` | `/slack/oauth/callback` | Slack (OAuth redirect) | Exchanges code for token |
| `GET` | `/slack/installation/status` | Desktop app | Check if workspace connected |
| `POST` | `/slack/commands` | Slack | Slash command handler |
| `POST` | `/slack/notify/meeting-ended` | vexa-lite / call-receiver | Trigger post-meeting DM |
| `POST` | `/slack/link-meeting` | Desktop app | Link meeting to Slack user |
| `GET` | `/health` | Docker | Health check |

### POST /slack/notify/meeting-ended

Called by the backend when a meeting ends. Payload:

```json
{
  "meeting_id": 42,
  "platform": "google_meet",
  "platform_specific_id": "abc-defg-hij"
}
```

The slack-bot then:
1. Looks up `meeting_slack_links` for this meeting_id
2. Fetches transcript from `transcriptions` table
3. Generates report via Claude API
4. Sends DM to the linked Slack user

### GET /slack/oauth/install

Redirects to:
```
https://slack.com/oauth/v2/authorize
  ?client_id={SLACK_CLIENT_ID}
  &scope=chat:write,im:write,users:read,commands,app_mentions:read,im:history
  &redirect_uri={SLACK_REDIRECT_URI}
```

The desktop app opens this URL in the system browser to start the OAuth flow.

---

## 10. Configuration

```env
# Slack App credentials (from api.slack.com/apps → Basic Information)
SLACK_CLIENT_ID=10363620637376.10328967232499
SLACK_CLIENT_SECRET=your_client_secret_here
SLACK_SIGNING_SECRET=your_signing_secret_here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here   # from Install App page

# Redirect URI (must match what's set in Slack app settings)
SLACK_REDIRECT_URI=https://api.ashera.net/slack/oauth/callback

# Claude API
ANTHROPIC_API_KEY=your_key_here

# Database (same as other services)
DATABASE_URL=postgresql://vexa:secret@postgres:5433/vexa

# Internal — called by this service to fetch transcripts
VEXA_LITE_URL=http://vexa-lite:8056
```

---

## 11. Directory Structure

```
slack-bot/
├── main.js                  # Fastify app + Bolt app setup
├── config.js                # Environment variable loading
├── db.js                    # PostgreSQL connection + queries
├── handlers/
│   ├── oauth.js             # OAuth install + callback endpoints
│   ├── commands.js          # /ashera slash command routing
│   └── notify.js            # meeting-ended notification handler
├── services/
│   ├── reportGenerator.js   # Claude API calls, report generation
│   └── slackSender.js       # Block Kit message builder + Slack Web API
├── requirements.txt
├── package.json
└── Dockerfile
```

---

## 12. Key Gotchas

1. **Slack requires HTTPS for all endpoints.** During development, use `ngrok` to expose localhost. Add the ngrok URL to Slack app settings under "Slash Commands" and "OAuth Redirect URLs".

2. **Signing secret verification is mandatory.** Never skip it. `@slack/bolt` does this automatically — use Bolt's built-in request handler, not raw Fastify routes for Slack endpoints.

3. **3-second timeout on slash commands.** Always respond immediately with HTTP 200, then send the actual content as a follow-up DM. Do not await Claude API inside the command handler.

4. **One token per workspace.** If the same user reinstalls the app, update the existing row rather than inserting a new one (`ON CONFLICT (workspace_id, user_id) DO UPDATE`).

5. **Bot token vs user token.** Use the Bot Token (`xoxb-`) for sending DMs. The User Token (`xoxp-`) is only needed if you want to act on behalf of the user. For Ashera's use case, the bot token is always sufficient.

6. **`im:write` scope is required to open DM channels.** Without it, `conversations.open` fails even if `chat:write` is present.

7. **Interactive buttons (Block Kit actions).** The "CRM'e Aktar" button in the post-meeting report is included in the message but not yet wired to any action. Add `action_id: "crm_transfer"` to the button — when the next phase implements CRM, add an interactivity endpoint at `/slack/actions` to handle it.
