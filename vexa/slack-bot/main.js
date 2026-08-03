require('dotenv').config()
const crypto = require('crypto')
const Fastify = require('fastify')
const config = require('./config')
const db = require('./db')
const oauth = require('./handlers/oauth')
const commands = require('./handlers/commands')
const notify = require('./handlers/notify')
const calendar = require('./handlers/calendar')
const { startPollingLoop } = require('./services/calendarPoller')
const crm = require('./handlers/crm')
const teamsHandler = require('./handlers/teams')
const meetings = require('./handlers/meetings')

const fastify = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 })

// Capture raw body for Slack signature verification
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

async function start() {
  await db.runMigrations()
  console.log('Database migrations complete')
  startPollingLoop()

  // OAuth routes
  fastify.get('/slack/oauth/install', oauth.handleInstall)
  fastify.get('/slack/oauth/callback', oauth.handleCallback)
  fastify.get('/slack/installation/status', oauth.handleStatus)

  // Slack slash commands — verify Slack signature
  fastify.post('/slack/commands', async (request, reply) => {
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

  // Calendar OAuth routes
  fastify.get('/calendar/oauth/install', calendar.handleCalendarInstall)
  fastify.get('/calendar/oauth/callback', calendar.handleCalendarCallback)
  fastify.get('/calendar/installation/status', calendar.handleCalendarStatus)
  fastify.get('/calendar/upcoming', calendar.handleUpcoming)

  // CRM OAuth routes
  fastify.get('/crm/oauth/install', crm.handleCrmInstall)
  fastify.get('/crm/oauth/callback', crm.handleCrmCallback)
  fastify.get('/crm/installation/status', crm.handleCrmStatus)

  // Internal endpoints (called by other Ashera services)
  fastify.post('/slack/notify/meeting-ended', notify.handleMeetingEnded)
  fastify.post('/slack/link-meeting', notify.handleLinkMeeting)

  // Teams Bot Framework webhook
  fastify.post('/teams/messages', async (request, reply) => {
    await teamsHandler.handleTeamsMessage(request, reply)
  })

  // Meeting intelligence endpoints (desktop app)
  fastify.post('/transcribe', meetings.handleTranscribe)
  fastify.post('/brief', meetings.handleBrief)
  fastify.post('/report', meetings.handleReport)
  fastify.get('/reports', meetings.handleListReports)
  fastify.get('/reports/:id', meetings.handleGetReport)

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }))

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`Slack bot running on port ${config.port}`)
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
