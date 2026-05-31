# Implementation Spec — Google Calendar Integration

## Context

Read `SLACK_BOT_ARCHITECTURE.md` and `SLACK_BOT_IMPLEMENTATION_SPEC.md` before starting. The `slack-bot` service is already built and running on port 8076. You are extending it with Google Calendar support.

Do not modify any existing service outside of `slack-bot/`.

---

## What This Does

1. Sales agent clicks "Google Calendar'ı Bağla" in the desktop app API settings screen
2. OAuth flow opens in browser, agent grants calendar read access
3. Ashera stores the Google Calendar token
4. A background poller runs every 60 seconds, checks for upcoming meetings
5. If a meeting starts in 10 minutes or less and hasn't been notified yet → generate pre-meeting report → send Slack DM

---

## Step 1 — Google Cloud setup (manual, before coding)

Before writing any code, the following must be done in Google Cloud Console:

1. Go to https://console.cloud.google.com
2. Create a new project called "Ashera"
3. Enable the **Google Calendar API**
4. Go to APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
5. Application type: **Web application**
6. Authorized redirect URIs: `http://localhost:8076/calendar/oauth/callback` (add ngrok/production URL later)
7. Copy the **Client ID** and **Client Secret**
8. Go to APIs & Services → OAuth consent screen → add scope: `https://www.googleapis.com/auth/calendar.readonly`

Add to `slack-bot/.env`:
```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8076/calendar/oauth/callback
```

---

## Step 2 — Install dependencies

Add to `slack-bot/package.json` dependencies:
```json
"googleapis": "^140.0.0"
```

Run `npm install`.

---

## Step 3 — Database migration

Add to the `runMigrations()` function in `slack-bot/db.js`:

```sql
CREATE TABLE IF NOT EXISTS calendar_installations (
    id                SERIAL PRIMARY KEY,
    ashera_user_id    INTEGER,
    slack_user_id     VARCHAR(50) NOT NULL UNIQUE,
    workspace_id      VARCHAR(50) NOT NULL,
    google_email      VARCHAR(255),
    access_token      TEXT NOT NULL,
    refresh_token     TEXT,
    token_expiry      TIMESTAMP,
    installed_at      TIMESTAMP DEFAULT NOW(),
    is_active         BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS calendar_notifications (
    id                SERIAL PRIMARY KEY,
    slack_user_id     VARCHAR(50) NOT NULL,
    calendar_event_id VARCHAR(255) NOT NULL,
    notified_at       TIMESTAMP DEFAULT NOW(),
    UNIQUE(slack_user_id, calendar_event_id)
);
```

Also add these functions to `db.js`:

```javascript
async function saveCalendarInstallation({ slackUserId, workspaceId, googleEmail, accessToken, refreshToken, tokenExpiry }) {
  await pool.query(`
    INSERT INTO calendar_installations 
      (slack_user_id, workspace_id, google_email, access_token, refresh_token, token_expiry)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (slack_user_id) DO UPDATE
    SET access_token = $4, refresh_token = $5, token_expiry = $6,
        google_email = $3, is_active = TRUE, installed_at = NOW()
  `, [slackUserId, workspaceId, googleEmail, accessToken, refreshToken, tokenExpiry])
}

async function getCalendarInstallation(slackUserId) {
  const res = await pool.query(
    'SELECT * FROM calendar_installations WHERE slack_user_id = $1 AND is_active = TRUE',
    [slackUserId]
  )
  return res.rows[0] || null
}

async function getAllCalendarInstallations() {
  const res = await pool.query(
    'SELECT * FROM calendar_installations WHERE is_active = TRUE'
  )
  return res.rows
}

async function markEventNotified(slackUserId, calendarEventId) {
  await pool.query(`
    INSERT INTO calendar_notifications (slack_user_id, calendar_event_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
  `, [slackUserId, calendarEventId])
}

async function wasEventNotified(slackUserId, calendarEventId) {
  const res = await pool.query(
    'SELECT 1 FROM calendar_notifications WHERE slack_user_id = $1 AND calendar_event_id = $2',
    [slackUserId, calendarEventId]
  )
  return res.rows.length > 0
}

async function updateCalendarTokens(slackUserId, accessToken, tokenExpiry) {
  await pool.query(
    'UPDATE calendar_installations SET access_token = $2, token_expiry = $3 WHERE slack_user_id = $1',
    [slackUserId, accessToken, tokenExpiry]
  )
}
```

Export all new functions from `db.js`.

---

## Step 4 — handlers/calendar.js (new file)

```javascript
const { google } = require('googleapis')
const config = require('../config')
const db = require('../db')

function getOAuthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  )
}

async function handleCalendarInstall(request, reply) {
  // Expects ?slack_user_id=U123&workspace_id=T456 in query
  const { slack_user_id, workspace_id } = request.query
  if (!slack_user_id || !workspace_id) {
    return reply.status(400).send({ error: 'slack_user_id and workspace_id required' })
  }

  const oauth2Client = getOAuthClient()
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/userinfo.email'],
    state: `${slack_user_id}:${workspace_id}`,
    prompt: 'consent',
  })

  return reply.redirect(url)
}

async function handleCalendarCallback(request, reply) {
  const { code, state, error } = request.query

  if (error || !code || !state) {
    return reply.type('text/html').send(
      '<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff"><h2>Bağlantı başarısız.</h2></body></html>'
    )
  }

  const [slackUserId, workspaceId] = state.split(':')

  const oauth2Client = getOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)

  // Get user email
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const { data } = await oauth2.userinfo.get()

  await db.saveCalendarInstallation({
    slackUserId,
    workspaceId,
    googleEmail: data.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  })

  return reply.type('text/html').send(`
    <html>
    <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff">
      <h2>✅ Google Calendar bağlandı!</h2>
      <p>${data.email} hesabı başarıyla bağlandı.</p>
      <p style="color:#5DCAA5">Bu pencereyi kapatabilirsiniz.</p>
    </body>
    </html>
  `)
}

async function handleCalendarStatus(request, reply) {
  const { slack_user_id } = request.query
  if (!slack_user_id) return reply.status(400).send({ error: 'slack_user_id required' })

  const installation = await db.getCalendarInstallation(slack_user_id)
  return {
    connected: !!installation,
    email: installation?.google_email || null,
  }
}

async function getUpcomingMeetings(installation) {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({
    access_token: installation.access_token,
    refresh_token: installation.refresh_token,
  })

  // Auto-refresh token if expired
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await db.updateCalendarTokens(
        installation.slack_user_id,
        tokens.access_token,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null
      )
    }
  })

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const now = new Date()
  const in15min = new Date(now.getTime() + 15 * 60 * 1000)

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: in15min.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 5,
  })

  return res.data.items || []
}

module.exports = {
  handleCalendarInstall,
  handleCalendarCallback,
  handleCalendarStatus,
  getUpcomingMeetings,
}
```

---

## Step 5 — services/calendarPoller.js (new file)

Runs every 60 seconds. Checks all connected calendars for upcoming meetings.

```javascript
const db = require('../db')
const { getUpcomingMeetings } = require('../handlers/calendar')
const { generatePreMeetingReport } = require('./reportGenerator')
const { buildPreMeetingBlocks, sendDM } = require('./slackSender')

function isMeetLink(event) {
  // Check if event has a Google Meet link
  return !!(
    event.hangoutLink ||
    (event.conferenceData && event.conferenceData.entryPoints &&
     event.conferenceData.entryPoints.some(e => e.entryPointType === 'video'))
  )
}

function getMeetLink(event) {
  if (event.hangoutLink) return event.hangoutLink
  if (event.conferenceData && event.conferenceData.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(e => e.entryPointType === 'video')
    if (videoEntry) return videoEntry.uri
  }
  return null
}

function minutesUntilStart(event) {
  const startTime = new Date(event.start.dateTime || event.start.date)
  const now = new Date()
  return (startTime - now) / 1000 / 60
}

async function pollOnce() {
  const installations = await db.getAllCalendarInstallations()

  for (const installation of installations) {
    try {
      const events = await getUpcomingMeetings(installation)

      for (const event of events) {
        const mins = minutesUntilStart(event)

        // Only notify for events starting in 5-10 minutes
        if (mins < 5 || mins > 10) continue

        // Skip if already notified
        const alreadyNotified = await db.wasEventNotified(installation.slack_user_id, event.id)
        if (alreadyNotified) continue

        // Get Slack installation for this user
        const slackInstallation = await db.getInstallationByWorkspace(installation.workspace_id)
        if (!slackInstallation) continue

        // Get most recent meeting transcript for context
        const recentMeeting = await db.getRecentMeetingForUser(installation.slack_user_id)
        const segments = recentMeeting ? await db.getTranscriptSegments(recentMeeting.id) : []

        // Generate pre-meeting report
        const companyName = extractCompanyName(event)
        const report = await generatePreMeetingReport(segments, { company: companyName, event })
        const blocks = buildPreMeetingBlocks(report, companyName)

        // Add meet link to message if present
        const meetLink = getMeetLink(event)
        const meetLinkBlock = meetLink ? [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔗 <${meetLink}|Toplantıya Katıl> · ${Math.round(mins)} dakika sonra başlıyor`
          }
        }] : []

        await sendDM(
          slackInstallation.bot_token,
          installation.slack_user_id,
          [...meetLinkBlock, ...blocks],
          `${companyName} toplantısı ${Math.round(mins)} dakika sonra başlıyor`
        )

        await db.markEventNotified(installation.slack_user_id, event.id)
        console.log(`Pre-meeting DM sent to ${installation.slack_user_id} for event: ${event.summary}`)
      }
    } catch (err) {
      console.error(`Calendar poll error for user ${installation.slack_user_id}:`, err.message)
    }
  }
}

function extractCompanyName(event) {
  // Try to extract company from event title
  // e.g. "TechCorp Demo", "Meeting with Acme", "Acme Corp - Q3 Review"
  const title = event.summary || 'Toplantı'
  const patterns = [
    /^(.+?)\s*[-–]\s*.+$/,   // "Acme - Demo" → "Acme"
    /^.+?\s+with\s+(.+)$/i,  // "Meeting with Acme" → "Acme"
    /^(.+?)\s+(demo|call|meeting|görüşme|toplantı)/i, // "TechCorp Demo" → "TechCorp"
  ]
  for (const pattern of patterns) {
    const match = title.match(pattern)
    if (match) return match[1].trim()
  }
  return title
}

function startPollingLoop() {
  console.log('Calendar poller started — checking every 60 seconds')
  // Run immediately once, then every 60 seconds
  pollOnce().catch(err => console.error('Initial calendar poll error:', err))
  setInterval(() => {
    pollOnce().catch(err => console.error('Calendar poll error:', err))
  }, 60 * 1000)
}

module.exports = { startPollingLoop }
```

---

## Step 6 — Update config.js

Add Google config:

```javascript
google: {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8076/calendar/oauth/callback',
},
```

---

## Step 7 — Update main.js

Add calendar routes and start poller:

```javascript
const calendar = require('./handlers/calendar')
const { startPollingLoop } = require('./services/calendarPoller')

// Add these routes alongside existing routes:
fastify.get('/calendar/oauth/install', calendar.handleCalendarInstall)
fastify.get('/calendar/oauth/callback', calendar.handleCalendarCallback)
fastify.get('/calendar/installation/status', calendar.handleCalendarStatus)

// Start calendar poller after migrations:
// Add this line after db.runMigrations():
startPollingLoop()
```

---

## Step 8 — Update desktop app API settings screen

In `ashera-desktop/app/index.jsx`, inside the `ApiScreen` component, add a new `ApiGroup` for Google Calendar after the existing groups:

```jsx
<ApiGroup icon="calendar" iconColor="rgba(255,255,255,0.4)" title="Google Calendar" connected={calendar.connected}>
  <ApiRow
    label="hesap"
    value={calendar.email || 'Bağlı değil'}
    btnText={calendar.connected ? 'yeniden bağla' : 'Google ile bağlan'}
    btnStyle="oauth"
    onAction={connectCalendar}
  />
</ApiGroup>
```

Add state and handler:
```javascript
const [calendar, setCalendar] = useState({ connected: false, email: '' })

const connectCalendar = () => {
  // Opens browser to calendar OAuth install URL
  // slack_user_id and workspace_id must be passed — 
  // for now use placeholder values, real linking comes when user auth is implemented
  window.appAPI.connectCalendar()
}
```

Add to `preload.js`:
```javascript
connectCalendar: () => ipcRenderer.send('api:connect', { provider: 'calendar' }),
```

Add to `main.js` in the `api:connect` handler:
```javascript
if (provider === 'calendar') {
  const { shell } = require('electron')
  shell.openExternal('http://localhost:8076/calendar/oauth/install?slack_user_id=PLACEHOLDER&workspace_id=PLACEHOLDER')
}
```

**Note:** The `slack_user_id` and `workspace_id` placeholders will be replaced when proper user session management is implemented. For now this wires the button.

---

## Definition of Done

1. `npm start` in `slack-bot/` starts without errors
2. `calendar_installations` and `calendar_notifications` tables created on startup
3. `GET http://localhost:8076/calendar/oauth/install?slack_user_id=U123&workspace_id=T456` redirects to Google OAuth
4. After completing Google OAuth, row appears in `calendar_installations` table
5. `GET http://localhost:8076/calendar/installation/status?slack_user_id=U123` returns `{"connected":true,"email":"..."}`
6. Calendar poller starts and logs "Calendar poller started" on service startup
7. Desktop app API settings screen shows Google Calendar connection group
8. "Google ile bağlan" button in desktop app opens browser to OAuth URL

## What NOT to do

- Do not modify vexa-lite, assemblyai-proxy, call-receiver
- Do not alter existing database tables
- Do not add Outlook/Microsoft Calendar support in this task
- Do not implement user session management — use placeholder slack_user_id for now
