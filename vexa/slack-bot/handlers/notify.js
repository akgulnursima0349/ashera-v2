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

      await sendDM(installation.bot_token, link.slack_user_id, blocks, `Meeting report: ${report.company}`)
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
