const { contextBridge, ipcRenderer } = require('electron')

// Expose platform so renderer can detect OS without nodeIntegration
contextBridge.exposeInMainWorld('platform', process.platform)

contextBridge.exposeInMainWorld('appAPI', {
  // Capture start — sends platform + meetingUrl to main, which decides Teams bot vs system audio
  startCapture: (data) => ipcRenderer.send('capture:start', data || {}),
  stopCapture: () => {
    window.dispatchEvent(new CustomEvent('ashera:stopCapture'))
    ipcRenderer.send('capture:stop')
  },

  // Called by audioCapture.js in renderer world after main grants permission
  triggerAudioCapture: () => {
    window.dispatchEvent(new CustomEvent('ashera:startCapture'))
  },

  // Called by audioCapture.js in renderer world
  sendAudioChunk: (buffer) => ipcRenderer.send('audio:chunk', buffer),
  audioStarted: () => ipcRenderer.send('audio:started'),
  audioError: (msg) => ipcRenderer.send('audio:error', msg),
  onAudioEnded: () => ipcRenderer.send('audio:ended'),

  // Events from main process → renderer
  onMeetingActive: (cb) => ipcRenderer.on('meeting:active', (_, data) => cb(data)),
  onAudioStatus: (cb) => ipcRenderer.on('audio:status', (_, status) => cb(status)),
  onUpcomingMeeting: (cb) => ipcRenderer.on('calendar:upcoming', (_, data) => cb(data)),
  onApiStatus: (cb) => ipcRenderer.on('api:status', (_, data) => cb(data)),
  // Main signals renderer to start system audio capture
  onAudioPermissionRequest: (cb) => ipcRenderer.on('audio:permission:request', () => cb()),

  // API connections
  connectSlack: () => ipcRenderer.send('api:connect', { provider: 'slack' }),
  connectCalendar: () => ipcRenderer.send('api:connect', { provider: 'calendar' }),
  connectPhone: () => ipcRenderer.send('api:connect', { provider: 'phone' }),
  connectCrm: () => ipcRenderer.send('api:connect', { provider: 'crm' }),
  connectTeams: () => ipcRenderer.send('api:connect', { provider: 'teams' }),

  // Local session storage
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  onSessionsUpdated: (cb) => ipcRenderer.on('sessions:updated', () => cb()),
})
