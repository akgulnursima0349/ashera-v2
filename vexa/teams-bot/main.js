require('dotenv').config()
const express = require('express')
const TeamsBot = require('./bot')

const app = express()
app.use(express.json())

const config = require('./config')

// Active bots: meetingId → { bot, segments, status }
const activeBots = new Map()

app.post('/bots', async (req, res) => {
  const { meeting_url, native_meeting_id, bot_name } = req.body

  if (!meeting_url) return res.status(400).json({ error: 'meeting_url required' })
  if (!meeting_url.includes('teams')) {
    return res.status(400).json({ error: 'Only Teams URLs supported' })
  }

  const meetingId = native_meeting_id || Date.now().toString()
  const segments = []
  const state = { bot: null, segments, status: 'requested' }
  activeBots.set(meetingId, state)

  const bot = new TeamsBot({
    meetingUrl: meeting_url,
    botName: bot_name || 'Ashera',
    meetingId,
    onSegment: (segment) => {
      segments.push({ ...segment, id: segments.length + 1 })
      console.log(`[${meetingId}] Segment: ${segment.text.slice(0, 50)}`)
    },
    onStatusChange: (status) => {
      state.status = status
      console.log(`[${meetingId}] Status: ${status}`)
    },
  })

  state.bot = bot

  // Start bot asynchronously
  bot.start().catch(err => {
    console.error(`Bot error for ${meetingId}:`, err.message)
    state.status = 'failed'
  })

  res.json({ meeting_id: meetingId, status: 'requested' })
})

app.delete('/bots/:meetingId', async (req, res) => {
  const state = activeBots.get(req.params.meetingId)
  if (!state) return res.status(404).json({ error: 'Bot not found' })
  await state.bot.stop()
  activeBots.delete(req.params.meetingId)
  res.json({ status: 'stopped' })
})

app.get('/transcripts/teams/:meetingId', (req, res) => {
  const state = activeBots.get(req.params.meetingId)
  if (!state) return res.status(404).json({ error: 'Meeting not found' })
  res.json({
    meeting_id: req.params.meetingId,
    status: state.status,
    segments: state.segments,
  })
})

app.get('/status/:meetingId', (req, res) => {
  const state = activeBots.get(req.params.meetingId)
  if (!state) return res.status(404).json({ error: 'Not found' })
  res.json({ status: state.status, segment_count: state.segments.length })
})

app.get('/health', (_, res) => res.json({ status: 'ok' }))

app.listen(config.port, () => {
  console.log(`Teams bot service running on port ${config.port}`)
})
