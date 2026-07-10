const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  close: () => ipcRenderer.send('overlay:close'),
  reportHeight: (h) => ipcRenderer.send('overlay:height', h),
  onBriefUpdate: (cb) => ipcRenderer.on('brief:update', (_, data) => {
    console.log('[overlay] brief:update received', JSON.stringify(data).slice(0, 100))
    cb(data)
  }),
  onMeetingStart: (cb) => ipcRenderer.on('meeting:start', () => cb()),
})
