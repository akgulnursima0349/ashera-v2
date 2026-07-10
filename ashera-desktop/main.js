require('dotenv').config()

const { app, BrowserWindow, ipcMain, screen, session, desktopCapturer } = require('electron')
const path = require('path')
const fs = require('fs')


let mainWindow = null
let overlayWindow = null
let transcriptPoller = null

const audioStreamer = require('./services/audioStreamer')
const { startWatcher } = require('./services/calendarWatcher')
const { startPolling } = require('./services/transcriptPoller')

const TEAMS_BOT_URL = process.env.TEAMS_BOT_URL || 'http://3.120.15.106:8077'

// --- Local session storage ---

function getSessionsDir() {
  return path.join(app.getPath('userData'), 'sessions')
}

function ensureSessionsDir() {
  const dir = getSessionsDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function saveSession(sessionId, segments, startTime) {
  try {
    const dir = ensureSessionsDir()
    const session = {
      id: sessionId,
      platform: 'desktop_audio',
      start_time: startTime,
      end_time: new Date().toISOString(),
      segments,
    }
    fs.writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify(session, null, 2))
    console.log(`Session saved: ${sessionId} (${segments.length} segments)`)
  } catch (err) {
    console.error('Failed to save session:', err.message)
  }
}

function listSessions() {
  try {
    const dir = ensureSessionsDir()
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    const sessions = files.map(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
        return {
          id: data.id,
          platform: data.platform,
          start_time: data.start_time,
          end_time: data.end_time,
          segment_count: (data.segments || []).length,
        }
      } catch { return null }
    }).filter(Boolean)
    // Sort by start_time descending
    sessions.sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
    return sessions
  } catch (err) {
    console.error('Failed to list sessions:', err.message)
    return []
  }
}

function getSession(sessionId) {
  try {
    const file = path.join(ensureSessionsDir(), `${sessionId}.json`)
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.error('Failed to read session:', err.message)
    return null
  }
}

ipcMain.handle('sessions:list', () => listSessions())
ipcMain.handle('sessions:get', (_, sessionId) => getSession(sessionId))

// ---

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0e0e11',
    icon: path.join(__dirname, 'assets/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  })
  mainWindow.loadFile('app/index.html')
}

function createOverlayWindow() {
  // Destroy any existing overlay before creating a new one
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy()
    overlayWindow = null
  }

  const display = screen.getDisplayNearestPoint({
    x: mainWindow.getBounds().x,
    y: mainWindow.getBounds().y,
  })
  const { x, y, width } = display.workArea

  overlayWindow = new BrowserWindow({
    width: 360,
    height: 200,
    x: Math.floor(x + width / 2 - 180),
    y: y + 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'overlay-preload.js'),
    }
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true)
  overlayWindow.loadFile('overlay/index.html')

  // Re-assert alwaysOnTop every 2 seconds during meeting
  const keepOnTop = setInterval(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    } else {
      clearInterval(keepOnTop)
    }
  }, 2000)
}


async function startTeamsBotSession(meetingUrl) {
  try {
    mainWindow.webContents.send('audio:status', 'joining')
    createOverlayWindow()

    const res = await fetch(`${TEAMS_BOT_URL}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: 'Ashera',
        native_meeting_id: extractTeamsMeetingId(meetingUrl),
      })
    })

    if (!res.ok) throw new Error(`Teams bot error: ${res.status}`)
    const data = await res.json()
    const meetingId = data.meeting_id

    mainWindow.webContents.send('meeting:active', {
      sessionId: meetingId,
      platform: 'teams',
    })

    overlayWindow.webContents.once('did-finish-load', () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('meeting:start')
      }
    })

    // Poll Teams bot for transcripts
    transcriptPoller = startPolling(meetingId, null, (segments) => {
      generateBrief(segments, meetingId)
    }, 'teams')

  } catch (err) {
    console.error('Teams bot start error:', err.message)
    mainWindow.webContents.send('audio:status', 'error')
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
  }
}

function extractTeamsMeetingId(url) {
  const match = url.match(/meet\/(\d+)/)
  return match ? match[1] : Date.now().toString()
}

// --- Audio capture IPC ---

// Per-session segment accumulator
let currentSessionId = null
let currentSessionStart = null
let accumulatedSegments = []
let briefInterval = null
let pendingCaptureLanguage = 'tr'

ipcMain.on('capture:start', async (event, data) => {
  const platform = data?.platform || 'audio'
  const meetingUrl = data?.meetingUrl || null
  pendingCaptureLanguage = data?.language || 'tr'

  if (platform === 'teams' && meetingUrl) {
    await startTeamsBotSession(meetingUrl)
  } else {
    mainWindow.webContents.send('audio:permission:request')
  }
})

ipcMain.on('audio:started', async (event) => {
  try {
    const sessionId = `desktop-${Date.now()}`
    currentSessionId = sessionId
    currentSessionStart = new Date().toISOString()
    accumulatedSegments = []

    // Reset brief cooldown for new session
    require('./services/briefGenerator').reset()

    // Start streaming immediately so chunks aren't lost during async meeting record creation
    audioStreamer.startStreaming(sessionId, null, (segments) => {
      accumulatedSegments.push(...segments)
      // Trigger brief on every 5th segment
      if (accumulatedSegments.length % 5 === 0) {
        generateBrief(accumulatedSegments, sessionId)
      }
    }, pendingCaptureLanguage)

    // Also update brief every 30 seconds regardless of segment count
    if (briefInterval) clearInterval(briefInterval)
    briefInterval = setInterval(() => {
      if (accumulatedSegments.length > 0) {
        generateBrief(accumulatedSegments, sessionId)
      }
    }, 30000)

    createOverlayWindow()

    mainWindow.webContents.send('meeting:active', {
      sessionId,
      meetingId: null,
    })

    // Wait for overlay page to load before sending meeting:start
    overlayWindow.webContents.once('did-finish-load', () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('meeting:start')
      }
    })

    // Attempt to create a meeting record in the background; non-fatal if endpoint doesn't exist
    const vexaUrl = process.env.VEXA_URL || 'http://3.120.15.106:8056'
    fetch(`${vexaUrl}/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'desktop_audio',
        platform_specific_id: sessionId,
        status: 'active',
      })
    }).then(async (response) => {
      // meeting record created; meeting_id not needed for Deepgram streaming
    }).catch(() => { /* endpoint may not exist — continue */ })

  } catch (err) {
    console.error('Failed to start audio session:', err.message)
    mainWindow.webContents.send('audio:status', 'error')
  }
})

ipcMain.on('audio:chunk', (event, arrayBuffer) => {
  audioStreamer.addChunk(arrayBuffer)
})

ipcMain.on('audio:error', (event, message) => {
  console.error('Audio capture error from renderer:', message)
  mainWindow.webContents.send('audio:status', 'error')
})

async function finishSession() {
  if (briefInterval) { clearInterval(briefInterval); briefInterval = null }
  audioStreamer.stopStreaming()
  if (transcriptPoller) { transcriptPoller(); transcriptPoller = null }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()

  // Save session to disk (always save, even if no segments — preserves the time record)
  console.log(`[session] finishSession: ${accumulatedSegments.length} segments for ${currentSessionId}`)
  if (currentSessionId) {
    saveSession(currentSessionId, accumulatedSegments, currentSessionStart)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sessions:updated')
    }
  }
  currentSessionId = null
  currentSessionStart = null
  accumulatedSegments = []
}

ipcMain.on('audio:ended', (event) => {
  // Stream ended (user stopped sharing from OS dialog)
  finishSession()
})

ipcMain.on('capture:stop', (event) => {
  finishSession()
})

// --- Overlay handlers ---

ipcMain.on('overlay:close', () => {
  if (overlayWindow) {
    overlayWindow.destroy()
    overlayWindow = null
  }
})

ipcMain.on('overlay:height', (event, height) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const clamped = Math.min(Math.max(height, 180), 380)
    overlayWindow.setSize(360, clamped)
  }
})

ipcMain.on('api:connect', async (event, { provider }) => {
  if (provider === 'calendar') {
    const { shell } = require('electron')
    shell.openExternal('https://api.ashera.net/calendar/oauth/install?slack_user_id=PLACEHOLDER&workspace_id=PLACEHOLDER')
    return
  }
  if (provider === 'crm') {
    const { shell } = require('electron')
    shell.openExternal('https://api.ashera.net/crm/oauth/install?slack_user_id=PLACEHOLDER&workspace_id=PLACEHOLDER')
    return
  }
  if (provider === 'slack') {
    const { shell } = require('electron')
    shell.openExternal('https://api.ashera.net/slack/oauth/install?redirect_uri=https://api.ashera.net/slack/oauth/callback')
    return
  }
  if (provider === 'teams') {
    const { shell } = require('electron')
    shell.openExternal('https://api.ashera.net/teams/oauth/install')
    return
  }
  console.log('Connect requested:', provider)
})

async function generateBrief(segments, meetingId) {
  console.log(`[brief] generateBrief called, segments: ${segments.length}, overlay: ${overlayWindow && !overlayWindow.isDestroyed()}`)
  const { generateBrief: gen } = require('./services/briefGenerator')
  const brief = await gen(segments)
  console.log(`[brief] result: ${brief ? JSON.stringify(brief).slice(0, 80) : 'null (cooldown or error)'}`)
  if (!brief) return

  // Skip error/insufficient-context API responses
  const errorKeywords = ['eksik', 'yetersiz', 'analiz edilemedi', 'paylaşın', 'bekleniyor', 'insufficient', 'transcript']
  const allBriefText = (brief.briefs || []).map(b => b.text || '').join(' ').toLowerCase()
  const allAlertText = (brief.alerts || []).map(a => a.text || '').join(' ').toLowerCase()
  const isErrorResponse = errorKeywords.some(k => allBriefText.includes(k) || allAlertText.includes(k))
  if (isErrorResponse) {
    console.log('[brief] skipping error response:', allBriefText.slice(0, 60))
    return
  }

  const hasRealContent = (brief.briefs && brief.briefs.length > 0) ||
    (brief.alerts && brief.alerts.some(a => a.type !== 'neutral'))
  if (!hasRealContent) {
    console.log('[brief] skipping — no real content yet')
    return
  }

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('brief:update', brief)
    console.log('[brief] sent to overlay ✓')
  }
}

app.whenReady().then(() => {
  // Allow getDisplayMedia in renderer — required in Electron 28+
  // Windows: 'loopback' captures system audio without showing a picker dialog
  // Mac/Linux: fall back to screen picker (user selects source and enables "Share audio")
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      const audio = process.platform === 'win32' ? 'loopback' : true
      callback({ video: sources[0], audio })
    }).catch(err => {
      console.error('desktopCapturer error:', err.message)
      callback({})
    })
  })

  // Allow microphone access for getUserMedia
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true)
    callback(false)
  })

  createMainWindow()
  // Start calendar watcher after window loads
  setTimeout(() => {
    startWatcher(mainWindow, 'PLACEHOLDER_USER_ID', 'PLACEHOLDER_WORKSPACE_ID')
  }, 3000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
