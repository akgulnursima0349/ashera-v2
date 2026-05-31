# Implementation Spec — HubSpot CRM Integration

## Context

Read `SLACK_BOT_ARCHITECTURE.md` and `SLACK_BOT_IMPLEMENTATION_SPEC.md` before starting. The `slack-bot` service is already built. You are extending it with HubSpot CRM support via natural language commands.

The core idea: the sales agent types any CRM-related command in Slack (`/ashera crm ...`), Claude interprets what action to take, calls the HubSpot API, and reports back. No fixed button mapping — fully natural language driven.

Do not modify any existing service outside of `slack-bot/`.

---

## What This Does

1. Sales agent types `/ashera crm <anything>` in Slack
2. Claude receives the natural language command + recent meeting context
3. Claude decides which HubSpot API call to make and with what parameters
4. slack-bot executes the HubSpot API call
5. Result is sent back to the agent as a Slack DM

### Example commands that must work:

```
/ashera crm deal stage güncelle Proposal
/ashera crm not ekle "SSO sorunu konuşuldu, IT ekibini dahil edecekler"
/ashera crm contact oluştur Can Demir, TechCorp CTO, can@techcorp.com
/ashera crm son toplantıyı kaydet
/ashera crm deal skoru 75 yap
/ashera crm TechCorp dealını bul
/ashera crm bu haftaki kapanan dealları listele
/ashera crm Ayşe'nin pipeline'ını göster
```

---

## Step 1 — HubSpot App setup (manual, before coding)

1. Go to https://app.hubspot.com/developer
2. Create a new app called "Ashera"
3. Go to Auth → OAuth → Add redirect URL: `http://localhost:8076/crm/oauth/callback`
4. Required scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.deals.read`
   - `crm.objects.deals.write`
   - `crm.objects.notes.read`
   - `crm.objects.notes.write`
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
5. Copy **Client ID** and **Client Secret**

Add to `slack-bot/.env`:
```env
HUBSPOT_CLIENT_ID=your_hubspot_client_id
HUBSPOT_CLIENT_SECRET=your_hubspot_client_secret
HUBSPOT_REDIRECT_URI=http://localhost:8076/crm/oauth/callback
```

---

## Step 2 — Install dependencies

Add to `slack-bot/package.json`:
```json
"@hubspot/api-client": "^11.0.0"
```

Run `npm install`.

---

## Step 3 — Database migration

Add to `runMigrations()` in `db.js`:

```sql
CREATE TABLE IF NOT EXISTS crm_installations (
    id              SERIAL PRIMARY KEY,
    slack_user_id   VARCHAR(50) NOT NULL UNIQUE,
    workspace_id    VARCHAR(50) NOT NULL,
    hub_id          VARCHAR(50),
    hub_domain      VARCHAR(255),
    access_token    TEXT NOT NULL,
    refresh_token   TEXT,
    token_expiry    TIMESTAMP,
    installed_at    TIMESTAMP DEFAULT NOW(),
    is_active       BOOLEAN DEFAULT TRUE
);
```

Add to `db.js`:

```javascript
async function saveCrmInstallation({ slackUserId, workspaceId, hubId, hubDomain, accessToken, refreshToken, tokenExpiry }) {
  await pool.query(`
    INSERT INTO crm_installations
      (slack_user_id, workspace_id, hub_id, hub_domain, access_token, refresh_token, token_expiry)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (slack_user_id) DO UPDATE
    SET access_token = $5, refresh_token = $6, token_expiry = $7,
        hub_id = $3, hub_domain = $4, is_active = TRUE, installed_at = NOW()
  `, [slackUserId, workspaceId, hubId, hubDomain, accessToken, refreshToken, tokenExpiry])
}

async function getCrmInstallation(slackUserId) {
  const res = await pool.query(
    'SELECT * FROM crm_installations WHERE slack_user_id = $1 AND is_active = TRUE',
    [slackUserId]
  )
  return res.rows[0] || null
}

async function updateCrmTokens(slackUserId, accessToken, tokenExpiry) {
  await pool.query(
    'UPDATE crm_installations SET access_token = $2, token_expiry = $3 WHERE slack_user_id = $1',
    [slackUserId, accessToken, tokenExpiry]
  )
}
```

Export all new functions.

---

## Step 4 — handlers/crm.js (new file)

OAuth flow for HubSpot.

```javascript
const config = require('../config')
const db = require('../db')

function getHubSpotAuthUrl(slackUserId, workspaceId) {
  const params = new URLSearchParams({
    client_id: config.hubspot.clientId,
    redirect_uri: config.hubspot.redirectUri,
    scope: [
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.deals.read',
      'crm.objects.deals.write',
      'crm.objects.notes.read',
      'crm.objects.notes.write',
      'crm.objects.companies.read',
      'crm.objects.companies.write',
    ].join(' '),
    state: `${slackUserId}:${workspaceId}`,
  })
  return `https://app.hubspot.com/oauth/authorize?${params}`
}

async function handleCrmInstall(request, reply) {
  const { slack_user_id, workspace_id } = request.query
  if (!slack_user_id || !workspace_id) {
    return reply.status(400).send({ error: 'slack_user_id and workspace_id required' })
  }
  return reply.redirect(getHubSpotAuthUrl(slack_user_id, workspace_id))
}

async function handleCrmCallback(request, reply) {
  const { code, state, error } = request.query

  if (error || !code || !state) {
    return reply.type('text/html').send(
      '<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff"><h2>Bağlantı başarısız.</h2></body></html>'
    )
  }

  const [slackUserId, workspaceId] = state.split(':')

  const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.hubspot.clientId,
      client_secret: config.hubspot.clientSecret,
      redirect_uri: config.hubspot.redirectUri,
      code,
    }),
  })

  const tokens = await res.json()
  if (tokens.error) {
    console.error('HubSpot OAuth error:', tokens)
    return reply.status(400).type('text/html').send('<html><body>OAuth hatası</body></html>')
  }

  // Get portal info
  const infoRes = await fetch('https://api.hubapi.com/account-info/v3/details', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = await infoRes.json()

  await db.saveCrmInstallation({
    slackUserId,
    workspaceId,
    hubId: String(info.portalId),
    hubDomain: info.uiDomain,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null,
  })

  return reply.type('text/html').send(`
    <html>
    <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff">
      <h2>✅ HubSpot bağlandı!</h2>
      <p>${info.uiDomain || 'HubSpot'} hesabı başarıyla bağlandı.</p>
      <p style="color:#5DCAA5">Bu pencereyi kapatabilirsiniz.</p>
    </body>
    </html>
  `)
}

async function handleCrmStatus(request, reply) {
  const { slack_user_id } = request.query
  if (!slack_user_id) return reply.status(400).send({ error: 'slack_user_id required' })

  const installation = await db.getCrmInstallation(slack_user_id)
  return {
    connected: !!installation,
    domain: installation?.hub_domain || null,
  }
}

module.exports = { handleCrmInstall, handleCrmCallback, handleCrmStatus }
```

---

## Step 5 — services/crmExecutor.js (new file)

This is the core of the CRM integration. Claude interprets the command, decides what HubSpot API to call, executes it, and returns a human-readable result.

```javascript
const Anthropic = require('@anthropic-ai/sdk')
const config = require('../config')
const db = require('../db')

const client = new Anthropic({ apiKey: config.anthropic.apiKey })

// All available HubSpot operations as tools for Claude
const CRM_TOOLS = [
  {
    name: 'search_deals',
    description: 'Search for deals in HubSpot by company name, deal name, or stage',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — company name, deal name, or keyword' },
        stage: { type: 'string', description: 'Filter by deal stage (optional)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_deal_stage',
    description: 'Update the pipeline stage of a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        stage: {
          type: 'string',
          description: 'New stage. Valid values: appointmentscheduled, qualifiedtobuy, presentationscheduled, decisionmakerboughtin, contractsent, closedwon, closedlost',
        },
      },
      required: ['deal_id', 'stage'],
    },
  },
  {
    name: 'add_note_to_deal',
    description: 'Add a meeting note or comment to a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        note: { type: 'string', description: 'Note content to add' },
      },
      required: ['deal_id', 'note'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new contact in HubSpot',
    input_schema: {
      type: 'object',
      properties: {
        firstname: { type: 'string' },
        lastname: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        jobtitle: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['firstname'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search for contacts by name, email, or company',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, email, or company to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_deal',
    description: 'Create a new deal in HubSpot',
    input_schema: {
      type: 'object',
      properties: {
        dealname: { type: 'string', description: 'Deal name' },
        amount: { type: 'number', description: 'Deal value in currency' },
        stage: { type: 'string', description: 'Initial pipeline stage' },
        company_name: { type: 'string', description: 'Company name to associate with' },
        closedate: { type: 'string', description: 'Expected close date in YYYY-MM-DD format' },
      },
      required: ['dealname'],
    },
  },
  {
    name: 'update_deal_score',
    description: 'Update the priority or score property of a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        score: { type: 'number', description: 'Score value 0-100' },
      },
      required: ['deal_id', 'score'],
    },
  },
  {
    name: 'log_meeting',
    description: 'Log a completed meeting activity on a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        meeting_title: { type: 'string', description: 'Meeting title or subject' },
        meeting_notes: { type: 'string', description: 'Meeting notes and outcomes' },
        meeting_date: { type: 'string', description: 'Meeting date in ISO format' },
      },
      required: ['deal_id', 'meeting_title'],
    },
  },
  {
    name: 'list_deals',
    description: 'List deals, optionally filtered by stage or owner',
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Filter by stage (optional)' },
        limit: { type: 'number', description: 'Max results, default 10' },
      },
    },
  },
  {
    name: 'respond_to_user',
    description: 'Send a response message to the user when no API call is needed, or after completing an action',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to send to the user in Turkish' },
        success: { type: 'boolean', description: 'Whether the operation succeeded' },
      },
      required: ['message'],
    },
  },
]

// HubSpot API executor
async function executeHubSpotTool(toolName, toolInput, accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
  const base = 'https://api.hubapi.com'

  switch (toolName) {
    case 'search_deals': {
      const res = await fetch(`${base}/crm/v3/objects/deals/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups: [],
          query: toolInput.query,
          properties: ['dealname', 'dealstage', 'amount', 'closedate', 'hubspot_owner_id'],
          limit: 10,
        }),
      })
      const data = await res.json()
      return data.results || []
    }

    case 'update_deal_stage': {
      const res = await fetch(`${base}/crm/v3/objects/deals/${toolInput.deal_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: { dealstage: toolInput.stage } }),
      })
      return await res.json()
    }

    case 'add_note_to_deal': {
      // Create note
      const noteRes = await fetch(`${base}/crm/v3/objects/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            hs_note_body: toolInput.note,
            hs_timestamp: new Date().toISOString(),
          },
        }),
      })
      const note = await noteRes.json()

      // Associate note with deal
      await fetch(`${base}/crm/v3/associations/notes/deals/batch/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inputs: [{
            from: { id: note.id },
            to: { id: toolInput.deal_id },
            type: 'note_to_deal',
          }],
        }),
      })
      return note
    }

    case 'create_contact': {
      const res = await fetch(`${base}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ properties: toolInput }),
      })
      return await res.json()
    }

    case 'search_contacts': {
      const res = await fetch(`${base}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: toolInput.query,
          properties: ['firstname', 'lastname', 'email', 'company', 'jobtitle'],
          limit: 10,
        }),
      })
      const data = await res.json()
      return data.results || []
    }

    case 'create_deal': {
      const res = await fetch(`${base}/crm/v3/objects/deals`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            dealname: toolInput.dealname,
            amount: toolInput.amount,
            dealstage: toolInput.stage || 'appointmentscheduled',
            closedate: toolInput.closedate,
          },
        }),
      })
      return await res.json()
    }

    case 'update_deal_score': {
      const res = await fetch(`${base}/crm/v3/objects/deals/${toolInput.deal_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: { hs_priority: toolInput.score > 66 ? 'high' : toolInput.score > 33 ? 'medium' : 'low' } }),
      })
      return await res.json()
    }

    case 'log_meeting': {
      const res = await fetch(`${base}/crm/v3/objects/meetings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            hs_meeting_title: toolInput.meeting_title,
            hs_meeting_body: toolInput.meeting_notes || '',
            hs_timestamp: toolInput.meeting_date || new Date().toISOString(),
            hs_meeting_outcome: 'COMPLETED',
          },
        }),
      })
      const meeting = await res.json()

      // Associate with deal
      if (meeting.id) {
        await fetch(`${base}/crm/v3/associations/meetings/deals/batch/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            inputs: [{
              from: { id: meeting.id },
              to: { id: toolInput.deal_id },
              type: 'meeting_to_deal',
            }],
          }),
        })
      }
      return meeting
    }

    case 'list_deals': {
      const res = await fetch(`${base}/crm/v3/objects/deals?limit=${toolInput.limit || 10}&properties=dealname,dealstage,amount,closedate`, {
        headers,
      })
      const data = await res.json()
      return data.results || []
    }

    case 'respond_to_user':
      return { message: toolInput.message, success: toolInput.success !== false }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}

async function executeCrmCommand(slackUserId, userCommand, recentMeetingContext = '') {
  const installation = await db.getCrmInstallation(slackUserId)
  if (!installation) {
    return { success: false, message: 'HubSpot bağlı değil. `/ashera crm bağla` komutunu deneyin.' }
  }

  const systemPrompt = `Sen Ashera'sın, bir satış asistanı. Kullanıcının Türkçe CRM komutlarını HubSpot API işlemlerine çeviriyorsun.

Görevin:
1. Kullanıcının ne yapmak istediğini anla
2. Uygun HubSpot araçlarını çağır
3. İşlemi tamamla
4. Sonucu Türkçe olarak kullanıcıya bildir (respond_to_user ile)

Eğer bir deal bulmadan önce stage güncelleme gibi bir işlem yapılacaksa, önce search_deals ile doğru deal'ı bul.
Eğer kullanıcı "son toplantıyı kaydet" diyorsa, aşağıdaki toplantı bağlamını kullan.
Tüm yanıtları Türkçe yaz.

${recentMeetingContext ? `Son toplantı bağlamı:\n${recentMeetingContext}` : ''}`

  const messages = [{ role: 'user', content: userCommand }]

  // Agentic loop — Claude may call multiple tools in sequence
  let result = { success: false, message: 'İşlem tamamlanamadı.' }
  let iterations = 0
  const MAX_ITERATIONS = 5

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: CRM_TOOLS,
      messages,
    })

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      // Claude is done — extract final text if any
      const textBlock = response.content.find(b => b.type === 'text')
      if (textBlock) {
        result = { success: true, message: textBlock.text }
      }
      break
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        if (block.name === 'respond_to_user') {
          result = { success: block.input.success !== false, message: block.input.message }
          // Don't break — let Claude finish
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ sent: true }),
          })
          continue
        }

        let toolResult
        try {
          toolResult = await executeHubSpotTool(block.name, block.input, installation.access_token)
        } catch (err) {
          toolResult = { error: err.message }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(toolResult),
        })
      }

      messages.push({ role: 'user', content: toolResults })
    }
  }

  return result
}

module.exports = { executeCrmCommand }
```

---

## Step 6 — Update handlers/commands.js

Add CRM command routing. Find the `handleCommand` function and add:

```javascript
// Add this import at the top:
const { executeCrmCommand } = require('../services/crmExecutor')

// Add this case in the command routing inside handleCommand:
if (subcommand.startsWith('crm')) {
  await handleCrm(user_id, team_id, text, installation.bot_token)
  return
}

// Add this new function:
async function handleCrm(slackUserId, workspaceId, fullText, botToken) {
  // Extract the CRM command part after "crm"
  const crmCommand = fullText.replace(/^crm\s*/i, '').trim()

  if (!crmCommand || crmCommand === 'bağla') {
    // Send connect link
    const connectUrl = `http://localhost:8076/crm/oauth/install?slack_user_id=${slackUserId}&workspace_id=${workspaceId}`
    await sendDM(botToken, slackUserId, [], `HubSpot'a bağlanmak için: ${connectUrl}`)
    return
  }

  // Get recent meeting context
  const recentMeeting = await db.getRecentMeetingForUser(slackUserId)
  let meetingContext = ''
  if (recentMeeting) {
    const segments = await db.getTranscriptSegments(recentMeeting.id)
    meetingContext = segments.slice(-20).map(s => `${s.speaker}: ${s.text}`).join('\n')
  }

  const result = await executeCrmCommand(slackUserId, crmCommand, meetingContext)

  const emoji = result.success ? '✅' : '❌'
  await sendDM(botToken, slackUserId, [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *CRM*\n${result.message}` }
    }
  ], result.message)
}
```

Also add the `sendDM` import at the top of `commands.js` if not already there:
```javascript
const { buildPostMeetingBlocks, buildPreMeetingBlocks, buildHelpBlocks, sendDM } = require('../services/slackSender')
```

---

## Step 7 — Update config.js

Add HubSpot config:

```javascript
hubspot: {
  clientId: process.env.HUBSPOT_CLIENT_ID,
  clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
  redirectUri: process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:8076/crm/oauth/callback',
},
```

---

## Step 8 — Update main.js

Add CRM routes:

```javascript
const crm = require('./handlers/crm')

// Add alongside existing routes:
fastify.get('/crm/oauth/install', crm.handleCrmInstall)
fastify.get('/crm/oauth/callback', crm.handleCrmCallback)
fastify.get('/crm/installation/status', crm.handleCrmStatus)
```

---

## Step 9 — Update help message

In `services/slackSender.js`, update `buildHelpBlocks()` to include CRM commands:

```javascript
function buildHelpBlocks() {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Ashera Komutları*\n\n` +
          `\`/ashera rapor\` — Son toplantının raporunu gönderir\n` +
          `\`/ashera hazırla\` — Toplantı öncesi hazırlık brifingi\n` +
          `\`/ashera yardım\` — Bu yardım mesajı\n\n` +
          `*CRM Komutları (doğal dil)*\n` +
          `\`/ashera crm bağla\` — HubSpot'a bağlan\n` +
          `\`/ashera crm <herhangi bir komut>\` — Örnekler:\n` +
          `  • \`/ashera crm TechCorp dealını bul\`\n` +
          `  • \`/ashera crm deal stage güncelle Proposal\`\n` +
          `  • \`/ashera crm not ekle "SSO sorunu konuşuldu"\`\n` +
          `  • \`/ashera crm son toplantıyı kaydet\`\n` +
          `  • \`/ashera crm contact oluştur Can Demir, TechCorp CTO\``
      }
    }
  ]
}
```

---

## Step 10 — Update desktop app API settings

In `ashera-desktop/app/index.jsx`, add HubSpot CRM group to `ApiScreen`:

```jsx
<ApiGroup icon="database" iconColor="rgba(255,255,255,0.4)" title="HubSpot CRM" connected={crm.connected}>
  <ApiRow
    label="portal"
    value={crm.domain || 'Bağlı değil'}
    btnText={crm.connected ? 'yeniden bağla' : 'HubSpot ile bağlan'}
    btnStyle="oauth"
    onAction={connectCrm}
  />
</ApiGroup>
```

Add state and handler:
```javascript
const [crm, setCrm] = useState({ connected: false, domain: '' })

const connectCrm = () => window.appAPI.connectCrm()
```

Add to `preload.js`:
```javascript
connectCrm: () => ipcRenderer.send('api:connect', { provider: 'crm' }),
```

Add to `main.js` `api:connect` handler:
```javascript
if (provider === 'crm') {
  const { shell } = require('electron')
  shell.openExternal('http://localhost:8076/crm/oauth/install?slack_user_id=PLACEHOLDER&workspace_id=PLACEHOLDER')
}
```

---

## Definition of Done

1. `npm start` starts without errors, `crm_installations` table created
2. `GET http://localhost:8076/crm/oauth/install?slack_user_id=U123&workspace_id=T456` redirects to HubSpot OAuth
3. After OAuth, row appears in `crm_installations` table
4. `GET http://localhost:8076/crm/installation/status?slack_user_id=U123` returns `{"connected":true,...}`
5. `/ashera crm TechCorp dealını bul` sends a DM with search results
6. `/ashera crm not ekle "test notu"` adds a note to a found deal and confirms via DM
7. `/ashera crm bağla` sends the HubSpot OAuth link as DM
8. `/ashera yardım` now shows CRM commands in the help message
9. Desktop app shows HubSpot CRM connection group in API settings

## What NOT to do

- Do not modify vexa-lite, assemblyai-proxy, call-receiver
- Do not add Salesforce or Pipedrive in this task
- Do not add fixed button mappings — all CRM actions go through Claude's natural language interpretation
- Do not implement user session management — use placeholder slack_user_id for desktop app buttons
- Do not write tests
