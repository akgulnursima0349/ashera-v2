# Implementation Spec — Slack Bot Service

## Context

Read `SLACK_BOT_ARCHITECTURE.md` fully before writing any code.

You are adding a new standalone service called `slack-bot` to the existing Ashera backend. The existing services (vexa-lite :8056, assemblyai-proxy :8070, call-receiver :8075, PostgreSQL :5433) are already running. Do not modify any of them.

The Slack App is already created (App ID: A0A9NUF6UEP). Credentials are in the `.env` file you will create.

---

## Step 1 — Directory structure and package setup

Create the following structure:

```
slack-bot/
├── main.js
├── config.js
├── db.js
├── handlers/
│   ├── oauth.js
│   ├── commands.js
│   └── notify.js
├── services/
│   ├── reportGenerator.js
│   └── slackSender.js
├── package.json
├── .env
└── Dockerfile
```

`package.json`:
```json
{
  "name": "ashera-slack-bot",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "start": "node main.js",
    "dev": "node --watch main.js"
  },
  "dependencies": {
    "@slack/bolt": "^3.18.0",
    "@slack/web-api": "^7.3.0",
    "@anthropic-ai/sdk": "^0.24.0",
    "fastify": "^4.27.0",
    "pg": "^8.11.0",
    "dotenv": "^16.4.0"
  }
}
```

`.env` (placeholder values — real values will be filled in):
```env
SLACK_CLIENT_ID=10363620637376.10328967232499
SLACK_CLIENT_SECRET=your_client_secret_here
SLACK_SIGNING_SECRET=your_signing_secret_here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_REDIRECT_URI=https://api.ashera.net/slack/oauth/callback
ANTHROPIC_API_KEY=your_anthropic_key_here
DATABASE_URL=postgresql://vexa:secret@postgres:5433/vexa
VEXA_LITE_URL=http://vexa-lite:8056
PORT=8076
```

---

## Step 2 — config.js

```javascript
require('dotenv').config()

module.exports = {
  slack: {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    botToken: process.env.SLACK_BOT_TOKEN,
    redirectUri: process.env.SLACK_REDIRECT_URI,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  vexaLiteUrl: process.env.VEXA_LITE_URL || 'http://localhost:8056',
  port: parseInt(process.env.PORT || '8076'),
}
```

---

## Step 3 — db.js

PostgreSQL connection using `pg`. Run migrations on startup.

```javascript
const { Pool } = require('pg')
const config = require('./config')

const pool = new Pool({ connectionString: config.database.url })

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slack_installations (
      id              SERIAL PRIMARY KEY,
      workspace_id    VARCHAR(50) NOT NULL,
      workspace_name  VARCHAR(255),
      user_id         VARCHAR(50) NOT NULL,
      bot_token       VARCHAR(255) NOT NULL,
      ashera_user_id  INTEGER,
      installed_at    TIMESTAMP DEFAULT NOW(),
      is_active       BOOLEAN DEFAULT TRUE,
      UNIQUE(workspace_id, user_id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_slack_links (
      id              SERIAL PRIMARY KEY,
      meeting_id      INTEGER,
      slack_user_id   VARCHAR(50) NOT NULL,
      workspace_id    VARCHAR(50) NOT NULL,
      notified        BOOLEAN DEFAULT FALSE,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `)
}

async function saveInstallation({ workspaceId, workspaceName, userId, botToken }) {
  await pool.query(`
    INSERT INTO slack_installations (workspace_id, workspace_name, user_id, bot_token)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET bot_token = $4, workspace_name = $2, is_active = TRUE, installed_at = NOW()
  `, [workspaceId, workspaceName, userId, botToken])
}

async function getInstallation(workspaceId, userId) {
  const res = await pool.query(
    'SELECT * FROM slack_installations WHERE workspace_id = $1 AND user_id = $2 AND is_active = TRUE',
    [workspaceId, userId]
  )
  return res.rows[0] || null
}

async function getInstallationByWorkspace(workspaceId) {
  const res = await pool.query(
    'SELECT * FROM slack_installations WHERE workspace_id = $1 AND is_active = TRUE LIMIT 1',
    [workspaceId]
  )
  return res.rows[0] || null
}

async function linkMeetingToSlack({ meetingId, slackUserId, workspaceId }) {
  await pool.query(`
    INSERT INTO meeting_slack_links (meeting_id, slack_user_id, workspace_id)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
  `, [meetingId, slackUserId, workspaceId])
}

async function getMeetingSlackLink(meetingId) {
  const res = await pool.query(
    'SELECT * FROM meeting_slack_links WHERE meeting_id = $1 AND notified = FALSE',
    [meetingId]
  )
  return res.rows[0] || null
}

async function markNotified(meetingId) {
  await pool.query(
    'UPDATE meeting_slack_links SET notified = TRUE WHERE meeting_id = $1',
    [meetingId]
  )
}

async function getTranscriptSegments(meetingId) {
  const res = await pool.query(
    `SELECT speaker, text, start_time, end_time, language
     FROM transcriptions WHERE meeting_id = $1 ORDER BY start_time`,
    [meetingId]
  )
  return res.rows
}

async function getRecentMeetingForUser(slackUserId) {
  const res = await pool.query(`
    SELECT m.id, m.platform_specific_id, m.start_time, m.end_time, m.data
    FROM meetings m
    JOIN meeting_slack_links l ON l.meeting_id = m.id
    WHERE l.slack_user_id = $1 AND m.status = 'completed'
    ORDER BY m.end_time DESC LIMIT 1
  `, [slackUserId])
  return res.rows[0] || null
}

module.exports = {
  pool,
  runMigrations,
  saveInstallation,
  getInstallation,
  getInstallationByWorkspace,
  linkMeetingToSlack,
  getMeetingSlackLink,
  markNotified,
  getTranscriptSegments,
  getRecentMeetingForUser,
}
```

---

## Step 4 — services/reportGenerator.js

Calls Claude API to generate reports from transcript text.

```javascript
const Anthropic = require('@anthropic-ai/sdk')
const config = require('../config')

const client = new Anthropic({ apiKey: config.anthropic.apiKey })

function segmentsToText(segments) {
  return segments
    .map(s => `${s.speaker || 'Konuşmacı'}: ${s.text}`)
    .join('\n')
}

async function generatePostMeetingReport(segments, meetingData = {}) {
  if (!segments || segments.length === 0) {
    return {
      company: meetingData.company || 'Bilinmiyor',
      summary: 'Transkript henüz hazır değil.',
      actions: [],
      signals: [],
      dealScore: 50,
    }
  }

  const transcriptText = segmentsToText(segments)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: `Sen Ashera'sın, bir satış zekası asistanı.
Verilen satış görüşmesi transkriptinden Türkçe bir toplantı sonrası rapor üret.

Çıktı formatı — sadece JSON, başka hiçbir şey yazma:
{
  "company": "şirket adı veya 'Bilinmiyor'",
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
- Sadece JSON çıktısı ver, markdown veya açıklama ekleme`,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return {
      company: 'Bilinmiyor',
      summary: text.slice(0, 200),
      actions: [],
      signals: [],
      dealScore: 50,
    }
  }
}

async function generatePreMeetingReport(previousSegments, context = {}) {
  const transcriptText = previousSegments.length > 0
    ? segmentsToText(previousSegments)
    : 'Önceki görüşme transkripti yok.'

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `Sen Ashera'sın, bir satış zekası asistanı.
Verilen önceki toplantı transkriptinden toplantı öncesi hazırlık brifingi üret.

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
- Sadece JSON çıktısı ver`,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return {
      warnings: [],
      preparation: ['Önceki görüşme verisi analiz edilemedi.'],
      context: 'Hazırlık verisi mevcut değil.',
    }
  }
}

module.exports = { generatePostMeetingReport, generatePreMeetingReport }
```

---

## Step 5 — services/slackSender.js

Builds Block Kit messages and sends them via Slack Web API.

```javascript
const { WebClient } = require('@slack/web-api')

function buildPostMeetingBlocks(report, meetingId) {
  const scoreEmoji = report.dealScore >= 75 ? '🟢' : report.dealScore >= 50 ? '🟡' : '🔴'
  const signalEmojis = { positive: '🟢', neutral: '🟡', negative: '🔴' }

  const actionsText = report.actions.length > 0
    ? report.actions.map(a => `☐ ${a.text}${a.deadline ? ` — ${a.deadline}` : ''}`).join('\n')
    : 'Aksiyon maddesi tespit edilmedi.'

  const signalsText = report.signals.length > 0
    ? report.signals.map(s => `${signalEmojis[s.type] || '⚪'} ${s.text}`).join('\n')
    : 'Sinyal tespit edilmedi.'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 Toplantı Raporu — ${report.company}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*ÖZET*\n${report.summary}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*AKSİYONLAR*\n${actionsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*SATIŞ SİNYALLERİ*\n${signalsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Deal skoru:* ${scoreEmoji} ${report.dealScore}/100` }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: "CRM'e Aktar" },
          action_id: 'crm_transfer',
          value: String(meetingId),
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Transkripti Gör' },
          action_id: 'view_transcript',
          value: String(meetingId),
        },
      ]
    }
  ]
}

function buildPreMeetingBlocks(report, companyName) {
  const warningsText = report.warnings.length > 0
    ? report.warnings.map(w => `⚠️ ${w}`).join('\n')
    : 'Özel uyarı yok.'

  const prepText = report.preparation.length > 0
    ? report.preparation.map(p => `• ${p}`).join('\n')
    : 'Hazırlık notu yok.'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🎯 Toplantı Hazırlık Brifiniz — ${companyName}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*DİKKAT EDİLECEKLER*\n${warningsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*HAZIRLIK NOTLARI*\n${prepText}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `_${report.context}_` }
    },
  ]
}

function buildHelpBlocks() {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Ashera Komutları*\n\n` +
          `\`/ashera rapor\` — Son toplantının raporunu gönderir\n` +
          `\`/ashera hazırla\` — Toplantı öncesi hazırlık brifingi\n` +
          `\`/ashera yardım\` — Bu yardım mesajı`
      }
    }
  ]
}

async function sendDM(token, slackUserId, blocks, text = 'Ashera raporu') {
  const client = new WebClient(token)

  const { channel } = await client.conversations.open({ users: slackUserId })
  await client.chat.postMessage({
    channel: channel.id,
    text,
    blocks,
  })
}

module.exports = {
  buildPostMeetingBlocks,
  buildPreMeetingBlocks,
  buildHelpBlocks,
  sendDM,
}
```

---

## Step 6 — handlers/oauth.js

Handles OAuth install and callback.

```javascript
const config = require('../config')
const db = require('../db')

async function handleInstall(request, reply) {
  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: 'chat:write,im:write,users:read,commands,app_mentions:read,im:history',
    redirect_uri: config.slack.redirectUri,
  })
  return reply.redirect(`https://slack.com/oauth/v2/authorize?${params}`)
}

async function handleCallback(request, reply) {
  const { code, error } = request.query

  if (error || !code) {
    return reply.status(400).send('<html><body><h2>Bağlantı başarısız.</h2></body></html>')
  }

  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    client_secret: config.slack.clientSecret,
    code,
    redirect_uri: config.slack.redirectUri,
  })

  const res = await fetch(`https://slack.com/api/oauth.v2.access?${params}`, {
    method: 'POST',
  })
  const data = await res.json()

  if (!data.ok) {
    console.error('Slack OAuth error:', data.error)
    return reply.status(400).send('<html><body><h2>OAuth hatası: ' + data.error + '</h2></body></html>')
  }

  await db.saveInstallation({
    workspaceId: data.team.id,
    workspaceName: data.team.name,
    userId: data.authed_user.id,
    botToken: data.access_token,
  })

  return reply.type('text/html').send(`
    <html>
    <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff;">
      <h2>✅ Ashera Slack'e bağlandı!</h2>
      <p>${data.team.name} workspace'ine başarıyla kuruldu.</p>
      <p style="color:#5DCAA5">Bu pencereyi kapatabilirsiniz.</p>
    </body>
    </html>
  `)
}

async function handleStatus(request, reply) {
  const { workspace_id, user_id } = request.query
  if (!workspace_id || !user_id) {
    return reply.status(400).send({ error: 'workspace_id and user_id required' })
  }

  const installation = await db.getInstallation(workspace_id, user_id)
  return {
    connected: !!installation,
    workspace: installation?.workspace_name || null,
  }
}

module.exports = { handleInstall, handleCallback, handleStatus }
```

---

## Step 7 — handlers/commands.js

Handles `/ashera` slash commands from Slack.

```javascript
const db = require('../db')
const { generatePostMeetingReport, generatePreMeetingReport } = require('../services/reportGenerator')
const { buildPostMeetingBlocks, buildPreMeetingBlocks, buildHelpBlocks, sendDM } = require('../services/slackSender')

async function handleCommand(request, reply) {
  const { command, text, user_id, team_id } = request.body
  const subcommand = (text || '').trim().toLowerCase()

  // Always respond within 3 seconds
  reply.status(200).send({ response_type: 'ephemeral', text: '⏳ Hazırlanıyor...' })

  // Process in background
  setImmediate(async () => {
    try {
      const installation = await db.getInstallationByWorkspace(team_id)
      if (!installation) {
        console.error('No installation found for workspace:', team_id)
        return
      }

      if (subcommand === 'rapor') {
        await handleRapor(user_id, team_id, installation.bot_token)
      } else if (subcommand === 'hazırla' || subcommand === 'hazirla') {
        await handleHazirla(user_id, team_id, installation.bot_token)
      } else {
        await handleYardim(user_id, installation.bot_token)
      }
    } catch (err) {
      console.error('Command handler error:', err)
    }
  })
}

async function handleRapor(slackUserId, workspaceId, botToken) {
  const meeting = await db.getRecentMeetingForUser(slackUserId)
  if (!meeting) {
    await sendDM(botToken, slackUserId, [], 'Tamamlanmış toplantı bulunamadı. Önce bir toplantıya katılın.')
    return
  }

  const segments = await db.getTranscriptSegments(meeting.id)
  const report = await generatePostMeetingReport(segments, meeting.data || {})
  const blocks = buildPostMeetingBlocks(report, meeting.id)
  await sendDM(botToken, slackUserId, blocks, `Toplantı raporu: ${report.company}`)
}

async function handleHazirla(slackUserId, workspaceId, botToken) {
  // In this phase: use most recent meeting transcript as context
  const meeting = await db.getRecentMeetingForUser(slackUserId)
  const segments = meeting ? await db.getTranscriptSegments(meeting.id) : []
  const report = await generatePreMeetingReport(segments, {})
  const companyName = meeting?.data?.company || 'Yaklaşan Toplantı'
  const blocks = buildPreMeetingBlocks(report, companyName)
  await sendDM(botToken, slackUserId, blocks, 'Toplantı hazırlık brifiniz hazır.')
}

async function handleYardim(slackUserId, botToken) {
  const blocks = buildHelpBlocks()
  await sendDM(botToken, slackUserId, blocks, 'Ashera komutları')
}

module.exports = { handleCommand }
```

---

## Step 8 — handlers/notify.js

Called by backend when a meeting ends.

```javascript
const db = require('../db')
const { generatePostMeetingReport } = require('../services/reportGenerator')
const { buildPostMeetingBlocks, sendDM } = require('../services/slackSender')

async function handleMeetingEnded(request, reply) {
  const { meeting_id } = request.body
  if (!meeting_id) {
    return reply.status(400).send({ error: 'meeting_id required' })
  }

  reply.status(200).send({ status: 'accepted' })

  setImmediate(async () => {
    try {
      const link = await db.getMeetingSlackLink(meeting_id)
      if (!link) {
        console.log('No Slack link for meeting:', meeting_id)
        return
      }

      const installation = await db.getInstallationByWorkspace(link.workspace_id)
      if (!installation) {
        console.error('No installation for workspace:', link.workspace_id)
        return
      }

      const segments = await db.getTranscriptSegments(meeting_id)
      const report = await generatePostMeetingReport(segments)
      const blocks = buildPostMeetingBlocks(report, meeting_id)

      await sendDM(installation.bot_token, link.slack_user_id, blocks, `Toplantı raporu: ${report.company}`)
      await db.markNotified(meeting_id)

      console.log(`Post-meeting DM sent for meeting ${meeting_id} to ${link.slack_user_id}`)
    } catch (err) {
      console.error('Notify handler error:', err)
    }
  })
}

async function handleLinkMeeting(request, reply) {
  const { meeting_id, slack_user_id, workspace_id } = request.body
  if (!meeting_id || !slack_user_id || !workspace_id) {
    return reply.status(400).send({ error: 'meeting_id, slack_user_id, workspace_id required' })
  }

  await db.linkMeetingToSlack({ meetingId: meeting_id, slackUserId: slack_user_id, workspaceId: workspace_id })
  return reply.send({ status: 'ok' })
}

module.exports = { handleMeetingEnded, handleLinkMeeting }
```

---

## Step 9 — main.js

Wires everything together.

```javascript
require('dotenv').config()
const Fastify = require('fastify')
const { App, ExpressReceiver } = require('@slack/bolt')
const config = require('./config')
const db = require('./db')
const oauth = require('./handlers/oauth')
const commands = require('./handlers/commands')
const notify = require('./handlers/notify')

const fastify = Fastify({ logger: true })

// Slack Bolt app for signature verification on /slack/commands
const slackApp = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  processBeforeResponse: true,
})

async function start() {
  await db.runMigrations()
  console.log('Database migrations complete')

  // OAuth routes
  fastify.get('/slack/oauth/install', oauth.handleInstall)
  fastify.get('/slack/oauth/callback', oauth.handleCallback)
  fastify.get('/slack/installation/status', oauth.handleStatus)

  // Slack slash commands — verify Slack signature manually
  fastify.post('/slack/commands', {
    config: { rawBody: true }
  }, async (request, reply) => {
    // Verify Slack signing secret
    const crypto = require('crypto')
    const timestamp = request.headers['x-slack-request-timestamp']
    const slackSig = request.headers['x-slack-signature']
    const body = request.rawBody || JSON.stringify(request.body)

    if (!timestamp || !slackSig) {
      return reply.status(401).send({ error: 'Missing Slack headers' })
    }

    const baseStr = `v0:${timestamp}:${body}`
    const hmac = crypto.createHmac('sha256', config.slack.signingSecret)
    hmac.update(baseStr)
    const computed = `v0=${hmac.digest('hex')}`

    if (computed !== slackSig) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }

    return commands.handleCommand(request, reply)
  })

  // Internal endpoints (called by other Ashera services)
  fastify.post('/slack/notify/meeting-ended', notify.handleMeetingEnded)
  fastify.post('/slack/link-meeting', notify.handleLinkMeeting)

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }))

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`Slack bot running on port ${config.port}`)
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
```

**Important:** Fastify does not expose `rawBody` by default. Add this plugin at the top of `main.js` to capture the raw body for signature verification:

```javascript
fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
  req.rawBody = body
  const params = new URLSearchParams(body)
  const obj = {}
  params.forEach((v, k) => { obj[k] = v })
  done(null, obj)
})

fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  req.rawBody = body
  try { done(null, JSON.parse(body)) } catch (e) { done(e) }
})
```

---

## Step 10 — Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
CMD ["node", "main.js"]
```

---

## Step 11 — Add to docker-compose.yml

Add this to the existing `docker-compose.yml`. Do not modify any existing service:

```yaml
  slack-bot:
    build: ./slack-bot
    ports:
      - "8076:8076"
    environment:
      DATABASE_URL: postgresql://vexa:secret@postgres:5433/vexa
      VEXA_LITE_URL: http://vexa-lite:8056
      SLACK_CLIENT_ID: ${SLACK_CLIENT_ID}
      SLACK_CLIENT_SECRET: ${SLACK_CLIENT_SECRET}
      SLACK_SIGNING_SECRET: ${SLACK_SIGNING_SECRET}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_REDIRECT_URI: ${SLACK_REDIRECT_URI}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      PORT: "8076"
    depends_on:
      - postgres
    restart: unless-stopped
```

---

## Step 12 — ngrok setup for local development

Slack cannot reach localhost. During development, expose port 8076 with ngrok:

```bash
ngrok http 8076
```

Copy the ngrok HTTPS URL (e.g. `https://abc123.ngrok.io`) and update:
1. Slack app settings → Slash Commands → Request URL: `https://abc123.ngrok.io/slack/commands`
2. Slack app settings → OAuth & Permissions → Redirect URLs: `https://abc123.ngrok.io/slack/oauth/callback`
3. `.env` → `SLACK_REDIRECT_URI=https://abc123.ngrok.io/slack/oauth/callback`

---

## Definition of Done

1. `docker-compose up slack-bot` starts without errors
2. `GET http://localhost:8076/health` returns `{"status":"ok"}`
3. Database migration creates `slack_installations` and `meeting_slack_links` tables
4. `GET http://localhost:8076/slack/oauth/install` redirects to `slack.com/oauth/v2/authorize`
5. After completing OAuth in browser, workspace is saved to `slack_installations` table
6. `GET http://localhost:8076/slack/installation/status?workspace_id=X&user_id=Y` returns `{"connected":true,...}`
7. `/ashera yardım` slash command (via ngrok) sends a DM with the help message
8. `/ashera rapor` slash command sends a DM (may say "toplantı bulunamadı" if no meetings exist — that is correct)
9. `POST http://localhost:8076/slack/link-meeting` with valid body returns `{"status":"ok"}`
10. `POST http://localhost:8076/slack/notify/meeting-ended` with `{"meeting_id":1}` returns `{"status":"accepted"}` and attempts DM (logs error if no link found — that is correct)

## What NOT to do

- Do not modify vexa-lite, assemblyai-proxy, call-receiver, or any existing service
- Do not alter the meetings, transcriptions, users, or api_tokens tables
- Do not implement CRM transfer button logic — include the button in the Block Kit message but leave the action unhandled
- Do not add calendar integration in this task
- Do not write tests
