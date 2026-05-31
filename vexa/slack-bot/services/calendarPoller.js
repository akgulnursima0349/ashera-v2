const db = require('../db')
const { getUpcomingMeetings } = require('../handlers/calendar')
const { generatePreMeetingReport } = require('./reportGenerator')
const { buildPreMeetingBlocks, sendDM } = require('./slackSender')

function isMeetLink(event) {
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

function extractCompanyName(event) {
  const title = event.summary || 'Toplantı'
  const patterns = [
    /^(.+?)\s*[-–]\s*.+$/,
    /^.+?\s+with\s+(.+)$/i,
    /^(.+?)\s+(demo|call|meeting|görüşme|toplantı)/i,
  ]
  for (const pattern of patterns) {
    const match = title.match(pattern)
    if (match) return match[1].trim()
  }
  return title
}

async function pollOnce() {
  const installations = await db.getAllCalendarInstallations()

  for (const installation of installations) {
    try {
      const events = await getUpcomingMeetings(installation)

      for (const event of events) {
        const mins = minutesUntilStart(event)

        if (mins < 5 || mins > 10) continue

        const alreadyNotified = await db.wasEventNotified(installation.slack_user_id, event.id)
        if (alreadyNotified) continue

        const slackInstallation = await db.getInstallationByWorkspace(installation.workspace_id)
        if (!slackInstallation) continue

        const recentMeeting = await db.getRecentMeetingForUser(installation.slack_user_id)
        const segments = recentMeeting ? await db.getTranscriptSegments(recentMeeting.id) : []

        const companyName = extractCompanyName(event)
        const report = await generatePreMeetingReport(segments, { company: companyName, event })
        const blocks = buildPreMeetingBlocks(report, companyName)

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

function startPollingLoop() {
  console.log('Calendar poller started — checking every 60 seconds')
  pollOnce().catch(err => console.error('Initial calendar poll error:', err))
  setInterval(() => {
    pollOnce().catch(err => console.error('Calendar poll error:', err))
  }, 60 * 1000)
}

module.exports = { startPollingLoop }
