const db = require('../db')
const { generatePostMeetingReport, generatePreMeetingReport } = require('../services/reportGenerator')
const { buildPostMeetingBlocks, buildPreMeetingBlocks, buildHelpBlocks, sendDM } = require('../services/slackSender')
const { executeCrmCommand } = require('../services/crmExecutor')

async function handleCommand(request, reply) {
  const { text, user_id, team_id } = request.body
  const subcommand = (text || '').trim().toLowerCase()

  // Always respond within 3 seconds
  reply.status(200).send({ response_type: 'ephemeral', text: '⏳ Preparing...' })

  // Process in background
  setImmediate(async () => {
    try {
      const installation = await db.getInstallationByWorkspace(team_id)
      if (!installation) {
        console.error('No installation found for workspace:', team_id)
        return
      }

      if (subcommand === 'rapor' || subcommand === 'report') {
        await handleRapor(user_id, team_id, installation.bot_token)
      } else if (subcommand === 'hazırla' || subcommand === 'hazirla' || subcommand === 'prepare') {
        await handleHazirla(user_id, team_id, installation.bot_token)
      } else if (subcommand.startsWith('crm')) {
        await handleCrm(user_id, team_id, text, installation.bot_token)
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
    await sendDM(botToken, slackUserId, [], 'No completed meeting found. Join a meeting first.')
    return
  }

  const segments = await db.getTranscriptSegments(meeting.id)
  const report = await generatePostMeetingReport(segments, meeting.data || {})
  const blocks = buildPostMeetingBlocks(report, meeting.id)
  await sendDM(botToken, slackUserId, blocks, `Meeting report: ${report.company}`)
}

async function handleHazirla(slackUserId, workspaceId, botToken) {
  const meeting = await db.getRecentMeetingForUser(slackUserId)
  const segments = meeting ? await db.getTranscriptSegments(meeting.id) : []
  const report = await generatePreMeetingReport(segments, {})
  const companyName = meeting?.data?.company || 'Upcoming Meeting'
  const blocks = buildPreMeetingBlocks(report, companyName)
  await sendDM(botToken, slackUserId, blocks, 'Your pre-meeting brief is ready.')
}

async function handleYardim(slackUserId, botToken) {
  const blocks = buildHelpBlocks()
  await sendDM(botToken, slackUserId, blocks, 'Ashera commands')
}

async function handleCrm(slackUserId, workspaceId, fullText, botToken) {
  const crmCommand = (fullText || '').replace(/^crm\s*/i, '').trim()

  if (!crmCommand || crmCommand.toLowerCase() === 'bağla' || crmCommand.toLowerCase() === 'connect') {
    const connectUrl = `http://localhost:8076/crm/oauth/install?slack_user_id=${slackUserId}&workspace_id=${workspaceId}`
    await sendDM(botToken, slackUserId, [], `To connect to HubSpot: ${connectUrl}`)
    return
  }

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

module.exports = { handleCommand }
