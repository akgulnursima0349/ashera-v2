require('dotenv').config()

const { app, BrowserWindow, ipcMain, screen, session } = require('electron')
const path = require('path')

let mainWindow = null
let overlayWindow = null
let transcriptPoller = null

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
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  })
  mainWindow.loadFile('app/index.html')
}

function createOverlayWindow() {
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

// IPC handlers
ipcMain.on('meeting:join', async (event, { url }) => {
  const meetingId = extractMeetingId(url)
  createOverlayWindow()

  try {
    // Start bot on backend
    const response = await fetch('http://localhost:8056/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url: url,
        platform: 'google_meet',
        native_meeting_id: meetingId,
        bot_name: 'Ashera Bot',
        language: 'tr',
      })
    })

    if (response.ok) {
      // Start polling for transcripts
      const { startPolling } = require('./services/transcriptPoller')
      transcriptPoller = startPolling(meetingId, (segments) => {
        generateBrief(segments, meetingId)
      })

      // Notify overlay to start timer
      overlayWindow.webContents.send('meeting:start')
    }
  } catch (err) {
    console.error('Failed to start meeting bot:', err)
  }
})

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
    shell.openExternal('http://localhost:8076/calendar/oauth/install?slack_user_id=PLACEHOLDER&workspace_id=PLACEHOLDER')
    return
  }
  if (provider === 'crm') {
    const { shell } = require('electron')
    shell.openExternal('http://localhost:8076/crm/oauth/install?slack_user_id=PLACEHOLDER&workspace_id=PLACEHOLDER')
    return
  }
  console.log('Connect requested:', provider)
})

async function generateBrief(segments, meetingId) {
  const { generateBrief: gen } = require('./services/briefGenerator')
  const brief = await gen(segments)
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('brief:update', brief)
  }
}

function extractMeetingId(url) {
  const match = url.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)
  return match ? match[1] : url.split('/').pop()
}

// Allow microphone for Google Meet webview
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true)
    callback(false)
  })
  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
