// services/calendarWatcher.js
// Polls the slack-bot backend for upcoming calendar meetings and notifies renderer.

const BACKEND_URL = process.env.SLACK_BOT_URL || 'http://3.120.15.106:8076'
const POLL_INTERVAL_MS = 60 * 1000   // every 60 seconds
const NOTIFY_MINUTES_BEFORE = 10

let watcherInterval = null
let mainWindow = null

function detectPlatform(meeting) {
  const link = meeting.meetLink || meeting.description || ''
  if (link.includes('teams.live.com') || link.includes('teams.microsoft.com')) {
    return 'teams'
  }
  if (link.includes('meet.google.com')) {
    return 'meet'
  }
  return 'audio' // default to system audio
}

function extractTeamsLink(description) {
  if (!description) return null
  const match = description.match(/https:\/\/teams\.(live|microsoft)\.com\/meet\/[^\s"<>]+/)
  return match ? match[0] : null
}

async function checkUpcomingMeetings(slackUserId, workspaceId) {
  try {
    const res = await fetch(
      `${BACKEND_URL}/calendar/upcoming?slack_user_id=${slackUserId}&workspace_id=${workspaceId}`
    )
    if (!res.ok) return null

    const data = await res.json()
    if (!data.meetings || data.meetings.length === 0) return null

    const now = new Date()

    for (const meeting of data.meetings) {
      const startTime = new Date(meeting.start)
      const minsUntil = Math.round((startTime - now) / 1000 / 60)

      if (minsUntil <= NOTIFY_MINUTES_BEFORE && minsUntil > 0) {
        const meetLink = meeting.meetLink || extractTeamsLink(meeting.description) || null
        return {
          id: meeting.id,
          title: meeting.title || 'Upcoming meeting',
          minsUntil,
          startTime: meeting.start,
          meetLink,
          platform: detectPlatform({ meetLink, description: meeting.description }),
        }
      }
    }
    return null
  } catch (err) {
    console.error('Calendar watcher error:', err.message)
    return null
  }
}

function startWatcher(win, slackUserId, workspaceId) {
  mainWindow = win
  if (watcherInterval) clearInterval(watcherInterval)

  const notify = async () => {
    const upcoming = await checkUpcomingMeetings(slackUserId, workspaceId)
    if (upcoming && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('calendar:upcoming', upcoming)
    }
  }

  notify() // run immediately on start
  watcherInterval = setInterval(notify, POLL_INTERVAL_MS)
}

function stopWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval)
    watcherInterval = null
  }
}

module.exports = { startWatcher, stopWatcher }
