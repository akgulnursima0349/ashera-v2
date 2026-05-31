const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('appAPI', {
  joinMeeting: (url) => ipcRenderer.send('meeting:join', { url }),
  connectSlack: () => ipcRenderer.send('api:connect', { provider: 'slack' }),
  connectPhone: () => ipcRenderer.send('api:connect', { provider: 'phone' }),
  connectCrm: () => ipcRenderer.send('api:connect', { provider: 'crm' }),
  connectCalendar: () => ipcRenderer.send('api:connect', { provider: 'calendar' }),
  onApiStatus: (cb) => ipcRenderer.on('api:status', (_, data) => cb(data)),
  onMeetingActive: (cb) => ipcRenderer.on('meeting:active', (_, data) => cb(data)),
})
