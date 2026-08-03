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
  const { slack_user_id, workspace_id } = request.query
  if (!slack_user_id || !workspace_id) {
    return reply.status(400).send({ error: 'slack_user_id and workspace_id required' })
  }

  const oauth2Client = getOAuthClient()
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
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

async function handleUpcoming(request, reply) {
  const { slack_user_id, workspace_id } = request.query
  if (!slack_user_id) return reply.status(400).send({ error: 'slack_user_id required' })

  const installation = await db.getCalendarInstallation(slack_user_id)
  if (!installation) return reply.send({ meetings: [] })

  try {
    const events = await getUpcomingMeetings(installation)

    const meetings = events.map(e => ({
      id: e.id,
      title: e.summary || 'Meeting',
      start: e.start.dateTime || e.start.date,
      meetLink: e.hangoutLink || null,
    }))

    return reply.send({ meetings })
  } catch (err) {
    console.error('Upcoming meetings error:', err)
    return reply.send({ meetings: [] })
  }
}

module.exports = {
  handleCalendarInstall,
  handleCalendarCallback,
  handleCalendarStatus,
  handleUpcoming,
  getUpcomingMeetings,
}
