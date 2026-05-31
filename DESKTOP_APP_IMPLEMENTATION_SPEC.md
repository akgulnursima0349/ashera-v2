# Implementation Spec — Ashera Desktop App

## Context

Read `DESKTOP_APP_ARCHITECTURE.md` fully before writing any code. This spec tells you what to build. The architecture doc tells you why and how each piece works.

You are building an Electron desktop application. It has two windows: a main app window and a floating overlay window. The UI code for both windows is provided in this spec — use it exactly as given, do not redesign.

The Ashera backend is already running locally (vexa-lite on :8056, assemblyai-proxy on :8070, PostgreSQL on :5433). The desktop app connects to it.

---

## Exact UI to implement

### Overlay window HTML (`overlay/index.html`)

Use this HTML exactly. Do not change colors, fonts, layout, or structure.

```html
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ashera Live Brif</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;500;600&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: transparent;
  font-family: 'Syne', sans-serif;
  -webkit-app-region: drag;
  user-select: none;
}
.overlay {
  width: 360px;
  background: rgba(15, 15, 18, 0.92);
  border-radius: 14px;
  border: 0.5px solid rgba(255,255,255,0.1);
  overflow: hidden;
}
.overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 0.5px solid rgba(255,255,255,0.07);
}
.overlay-logo { display: flex; align-items: center; gap: 6px; }
.overlay-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #1D9E75;
  animation: pulse 2s infinite;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.overlay-name {
  font-size: 11px; font-weight: 500;
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-family: 'DM Mono', monospace;
}
.overlay-timer { font-size: 11px; color: rgba(255,255,255,0.3); font-family: 'DM Mono', monospace; }
.overlay-close {
  width: 18px; height: 18px;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
  border: none;
  color: rgba(255,255,255,0.4);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px;
  -webkit-app-region: no-drag;
}
.phase-bar { display: flex; padding: 6px 12px; gap: 4px; }
.phase-seg { height: 2px; flex: 1; border-radius: 1px; background: rgba(255,255,255,0.1); }
.phase-seg.active { background: #1D9E75; }
.phase-seg.done { background: rgba(29,158,117,0.4); }
.alert-section { padding: 8px 12px; display: flex; flex-direction: column; gap: 5px; }
.alert-chip {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 9px; border-radius: 6px;
  font-size: 12px; font-weight: 500;
}
.alert-chip.price { background: rgba(186,117,23,0.15); border: 0.5px solid rgba(186,117,23,0.3); color: #FAC775; }
.alert-chip.tech  { background: rgba(83,74,183,0.15);  border: 0.5px solid rgba(83,74,183,0.3);  color: #AFA9EC; }
.alert-chip.hot   { background: rgba(29,158,117,0.12); border: 0.5px solid rgba(29,158,117,0.25); color: #5DCAA5; }
.alert-chip.neutral { background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); }
.divider { height: 0.5px; background: rgba(255,255,255,0.06); margin: 0 12px; }
.brif-section { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.brif-item { display: flex; gap: 10px; align-items: flex-start; animation: fadeIn 0.3s ease; }
@keyframes fadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
.brif-item.old { opacity: 0.45; }
.brif-tag {
  font-size: 9px; font-family: 'DM Mono', monospace;
  letter-spacing: 0.06em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 4px;
  flex-shrink: 0; margin-top: 1px; font-weight: 500;
}
.brif-tag.aksiyon { background: rgba(29,158,117,0.2); color: #5DCAA5; }
.brif-tag.dikkat  { background: rgba(186,117,23,0.2); color: #FAC775; }
.brif-tag.bilgi   { background: rgba(83,74,183,0.2);  color: #AFA9EC; }
.new-badge {
  display: inline-block; font-size: 9px;
  font-family: 'DM Mono', monospace;
  padding: 1px 5px; border-radius: 3px;
  background: rgba(29,158,117,0.3); color: #5DCAA5;
  vertical-align: middle; margin-left: 4px;
}
.brif-text { font-size: 12.5px; color: rgba(255,255,255,0.82); line-height: 1.5; }
.brif-text strong { color: #fff; font-weight: 500; }
.overlay-footer {
  padding: 7px 12px;
  border-top: 0.5px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: space-between;
}
.footer-hint { font-size: 10px; color: rgba(255,255,255,0.25); font-family: 'DM Mono', monospace; }
.footer-score { display: flex; align-items: center; gap: 5px; }
.score-label { font-size: 10px; color: rgba(255,255,255,0.3); font-family: 'DM Mono', monospace; }
.score-val { font-size: 13px; font-weight: 600; color: #5DCAA5; }
.connecting-state {
  padding: 20px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(255,255,255,0.3);
  font-family: 'DM Mono', monospace;
}
</style>
</head>
<body>
<div class="overlay" id="overlay">
  <div class="overlay-header">
    <div class="overlay-logo">
      <div class="overlay-dot" id="status-dot"></div>
      <span class="overlay-name">Ashera</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="overlay-timer" id="timer">00:00</span>
      <button class="overlay-close" id="close-btn" onclick="window.overlayAPI.close()">✕</button>
    </div>
  </div>

  <div class="phase-bar" id="phase-bar">
    <div class="phase-seg" id="p0"></div>
    <div class="phase-seg" id="p1"></div>
    <div class="phase-seg" id="p2"></div>
    <div class="phase-seg" id="p3"></div>
    <div class="phase-seg" id="p4"></div>
  </div>

  <div id="main-content">
    <div class="connecting-state" id="connecting">Bağlanıyor...</div>
  </div>

  <div class="overlay-footer" id="footer" style="display:none;">
    <span class="footer-hint" id="last-update">—</span>
    <div class="footer-score">
      <span class="score-label">deal skoru</span>
      <span class="score-val" id="deal-score">—</span>
    </div>
  </div>
</div>

<script src="overlay.js"></script>
</body>
</html>
```

### Overlay JavaScript (`overlay/overlay.js`)

```javascript
let meetingStartTime = null
let timerInterval = null
let briefCount = 0
let phaseIndex = 0

function startTimer() {
  meetingStartTime = Date.now()
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000)
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    document.getElementById('timer').textContent = `${m}:${s}`
  }, 1000)
}

function advancePhase() {
  if (phaseIndex < 5) {
    for (let i = 0; i < phaseIndex; i++) {
      document.getElementById('p' + i).className = 'phase-seg done'
    }
    document.getElementById('p' + phaseIndex).className = 'phase-seg active'
    phaseIndex++
  }
}

function renderAlerts(alerts) {
  const section = document.createElement('div')
  section.className = 'alert-section'
  section.id = 'alert-section'
  alerts.forEach(a => {
    const chip = document.createElement('div')
    chip.className = `alert-chip ${a.type}`
    chip.textContent = a.text
    section.appendChild(chip)
  })
  return section
}

function renderBriefs(briefs) {
  const section = document.createElement('div')
  section.className = 'brif-section'
  section.id = 'brif-section'
  briefs.forEach(b => {
    section.appendChild(makeBrifItem(b, true))
  })
  return section
}

function makeBrifItem(b, isNew) {
  const item = document.createElement('div')
  item.className = 'brif-item'
  const newBadge = isNew ? '<span class="new-badge">yeni</span>' : ''
  item.innerHTML = `
    <span class="brif-tag ${b.tag}">${b.tag}${newBadge}</span>
    <span class="brif-text">${b.text}</span>
  `
  return item
}

function updateLastUpdated() {
  document.getElementById('last-update').textContent = 'şimdi güncellendi'
  setTimeout(() => {
    document.getElementById('last-update').textContent = 'son güncelleme 10s önce'
  }, 10000)
}

function updateDealScore(score) {
  const el = document.getElementById('deal-score')
  el.textContent = score
  el.style.color = score >= 75 ? '#5DCAA5' : score >= 50 ? '#FAC775' : '#F09595'
}

// IPC from main process
window.overlayAPI.onBriefUpdate((data) => {
  const content = document.getElementById('main-content')
  document.getElementById('connecting').style.display = 'none'
  document.getElementById('footer').style.display = 'flex'

  // Mark existing briefs as old
  document.querySelectorAll('.brif-item').forEach(el => el.classList.add('old'))

  // Remove and re-render alerts
  const existingAlerts = document.getElementById('alert-section')
  if (existingAlerts) existingAlerts.remove()

  const existingBriefs = document.getElementById('brif-section')
  if (existingBriefs) existingBriefs.remove()
  const divider = document.getElementById('main-divider')
  if (divider) divider.remove()

  if (data.alerts && data.alerts.length > 0) {
    content.appendChild(renderAlerts(data.alerts))
    const div = document.createElement('div')
    div.className = 'divider'
    div.id = 'main-divider'
    content.appendChild(div)
  }

  if (data.briefs && data.briefs.length > 0) {
    content.appendChild(renderBriefs(data.briefs))
  }

  if (data.dealScore !== undefined) updateDealScore(data.dealScore)
  updateLastUpdated()
  advancePhase()

  // Tell main process new content height for window resize
  window.overlayAPI.reportHeight(document.getElementById('overlay').scrollHeight)
})

window.overlayAPI.onMeetingStart(() => {
  startTimer()
})
```

### Main Window UI (`app/index.html` + `app/index.jsx`)

The main window is a React app. Use these exact styles and structure.

```html
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>Ashera</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;500;600&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0e0e11; font-family: 'Syne', sans-serif; color: rgba(255,255,255,0.85); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
#root { display: flex; flex-direction: column; height: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script src="bundle.js"></script>
</body>
</html>
```

```jsx
// app/index.jsx
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

const DARK = {
  bg: '#0e0e11',
  bgDeep: '#0a0a0d',
  border: 'rgba(255,255,255,0.07)',
  borderLight: 'rgba(255,255,255,0.04)',
  text: 'rgba(255,255,255,0.85)',
  textMuted: 'rgba(255,255,255,0.3)',
  textFaint: 'rgba(255,255,255,0.15)',
  green: '#1D9E75',
  greenLight: '#5DCAA5',
  greenBg: 'rgba(29,158,117,0.15)',
}

function Sidebar({ screen, onNav }) {
  const btn = (id, icon, label) => (
    <button
      key={id}
      onClick={() => onNav(id)}
      aria-label={label}
      style={{
        width: 36, height: 36, borderRadius: 8,
        border: 'none', cursor: 'pointer',
        background: screen === id ? DARK.greenBg : 'transparent',
        color: screen === id ? DARK.greenLight : DARK.textMuted,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 17, transition: 'all 0.15s',
      }}
    >
      <i className={`ti ti-${icon}`} aria-hidden="true" />
    </button>
  )
  return (
    <div style={{
      width: 52, background: DARK.bgDeep,
      borderRight: `0.5px solid ${DARK.border}`,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '12px 0', gap: 4,
    }}>
      {btn('meet', 'video', 'Meet ekranı')}
      {btn('api', 'plug', 'API bağlantıları')}
      <div style={{ flex: 1 }} />
      {btn('settings', 'settings', 'Ayarlar')}
    </div>
  )
}

function MeetScreen() {
  const [url, setUrl] = useState('')
  const [isLive, setIsLive] = useState(false)
  const [company, setCompany] = useState('')

  const handleJoin = () => {
    if (!url.trim()) return
    window.appAPI.joinMeeting(url.trim())
    setIsLive(true)
    setCompany('Toplantı')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px 12px', borderBottom: `0.5px solid ${DARK.border}` }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Google Meet</div>
        <div style={{ fontSize: 11, color: DARK.textMuted, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
          toplantıya katıl — live brif otomatik açılır
        </div>
      </div>

      {isLive && (
        <div style={{
          padding: '6px 16px',
          background: 'rgba(29,158,117,0.08)',
          borderBottom: '0.5px solid rgba(29,158,117,0.15)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: DARK.greenLight,
          fontFamily: 'DM Mono, monospace',
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: DARK.green,
            animation: 'pulse 1.5s infinite',
          }} />
          <span>Canlı · {company} · Live brif aktif</span>
        </div>
      )}

      <div style={{
        flex: 1, background: '#111114',
        display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 12,
        position: 'relative',
      }}>
        {isLive ? (
          <webview
            src={url}
            style={{ width: '100%', height: '100%' }}
            useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            allowpopups="true"
          />
        ) : (
          <>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.2)', fontSize: 28,
            }}>
              <i className="ti ti-video-off" aria-hidden="true" />
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
              Toplantı URL'sini girin<br />veya takvimden seçin
            </div>
          </>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 8, padding: '12px 16px',
        borderTop: `0.5px solid ${DARK.border}`,
        background: DARK.bg,
      }}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="meet.google.com/abc-defg-hij"
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.06)',
            border: '0.5px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '8px 12px',
            fontSize: 12, color: 'rgba(255,255,255,0.7)',
            fontFamily: 'Syne, sans-serif', outline: 'none',
          }}
        />
        <button
          onClick={handleJoin}
          style={{
            background: DARK.green, border: 'none',
            borderRadius: 8, padding: '8px 16px',
            fontSize: 12, fontWeight: 500,
            color: '#fff', cursor: 'pointer',
            fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap',
          }}
        >
          Katıl & Kaydı Başlat
        </button>
      </div>
    </div>
  )
}

function ApiGroup({ icon, iconColor, title, connected, children }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `0.5px solid ${connected ? 'rgba(29,158,117,0.2)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `0.5px solid rgba(255,255,255,0.06)`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className={`ti ti-${icon}`} style={{ fontSize: 15, color: iconColor || 'rgba(255,255,255,0.4)' }} aria-hidden="true" />
          {title}
        </div>
        <span style={{
          fontSize: 10, fontFamily: 'DM Mono, monospace', padding: '2px 7px', borderRadius: 4,
          background: connected ? 'rgba(29,158,117,0.2)' : 'rgba(255,255,255,0.06)',
          color: connected ? '#5DCAA5' : 'rgba(255,255,255,0.3)',
        }}>
          {connected ? 'bağlı' : 'bağlı değil'}
        </span>
      </div>
      {children}
    </div>
  )
}

function ApiRow({ label, value, btnText, btnStyle, onAction }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px',
      borderBottom: `0.5px solid rgba(255,255,255,0.04)`,
    }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'DM Mono, monospace', width: 90, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'DM Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
      {btnText && (
        <button
          onClick={onAction}
          style={{
            background: 'transparent',
            border: `0.5px solid ${btnStyle === 'oauth' ? 'rgba(29,158,117,0.4)' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 6, padding: '5px 12px',
            fontSize: 11,
            color: btnStyle === 'oauth' ? '#5DCAA5' : 'rgba(255,255,255,0.5)',
            cursor: 'pointer', fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap',
          }}
        >
          {btnText}
        </button>
      )}
    </div>
  )
}

function ApiScreen() {
  const [slack, setSlack] = useState({ connected: false, workspace: '', channel: '' })
  const [phone, setPhone] = useState({ connected: false, provider: '', webhookUrl: '' })
  const [crm, setCrm] = useState({ connected: false, provider: '' })

  const connectSlack = () => window.appAPI.connectSlack()
  const connectPhone = () => window.appAPI.connectPhone()
  const connectCrm = () => window.appAPI.connectCrm()

  useEffect(() => {
    window.appAPI.onApiStatus((status) => {
      if (status.provider === 'slack') setSlack(s => ({ ...s, ...status }))
      if (status.provider === 'phone') setPhone(s => ({ ...s, ...status }))
      if (status.provider === 'crm') setCrm(s => ({ ...s, ...status }))
    })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px 12px', borderBottom: `0.5px solid rgba(255,255,255,0.07)` }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>API bağlantıları</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
          bir kez bağla, Ashera gerisini halleder
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ApiGroup icon="brand-slack" iconColor="#5DCAA5" title="Slack" connected={slack.connected}>
          <ApiRow label="workspace" value={slack.workspace || '—'} btnText={slack.connected ? 'yeniden bağla' : 'OAuth ile bağlan'} btnStyle={slack.connected ? '' : 'oauth'} onAction={connectSlack} />
          <ApiRow label="kanal" value={slack.channel || '—'} />
        </ApiGroup>

        <ApiGroup icon="phone" iconColor="rgba(255,255,255,0.4)" title="Telefon sistemi" connected={phone.connected}>
          <ApiRow label="sağlayıcı" value={phone.provider || 'Alotech / Twilio / Diğer'} btnText="bağlan" btnStyle="oauth" onAction={connectPhone} />
          <ApiRow label="webhook url" value={phone.webhookUrl || '— bağlantıdan sonra üretilir'} />
        </ApiGroup>

        <ApiGroup icon="database" iconColor="rgba(255,255,255,0.4)" title="CRM" connected={crm.connected}>
          <ApiRow label="platform" value={crm.provider || 'HubSpot / Salesforce / Pipedrive'} btnText="OAuth ile bağlan" btnStyle="oauth" onAction={connectCrm} />
        </ApiGroup>
      </div>
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState('meet')
  return (
    <div style={{ display: 'flex', flex: 1, height: '100%' }}>
      <Sidebar screen={screen} onNav={setScreen} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {screen === 'meet' && <MeetScreen />}
        {screen === 'api' && <ApiScreen />}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
```

---

## Step 1 — Project setup

```bash
mkdir ashera-desktop && cd ashera-desktop
npm init -y
npm install electron electron-builder react react-dom
npm install electron-store
npm install --save-dev webpack webpack-cli babel-loader @babel/core @babel/preset-react @babel/preset-env
```

Create `.babelrc`:
```json
{ "presets": ["@babel/preset-env", "@babel/preset-react"] }
```

Create `webpack.config.js`:
```javascript
module.exports = {
  entry: './app/index.jsx',
  output: { path: __dirname + '/app', filename: 'bundle.js' },
  module: { rules: [{ test: /\.jsx?$/, use: 'babel-loader', exclude: /node_modules/ }] },
  resolve: { extensions: ['.js', '.jsx'] }
}
```

Add to `package.json`:
```json
{
  "main": "main.js",
  "scripts": {
    "build": "webpack",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder"
  }
}
```

---

## Step 2 — main.js

The Electron main process. Manages both windows, IPC, and backend communication.

```javascript
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
  // Stub — implement OAuth flows per provider
  console.log('Connect:', provider)
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
```

---

## Step 3 — preload.js (main window)

```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('appAPI', {
  joinMeeting: (url) => ipcRenderer.send('meeting:join', { url }),
  connectSlack: () => ipcRenderer.send('api:connect', { provider: 'slack' }),
  connectPhone: () => ipcRenderer.send('api:connect', { provider: 'phone' }),
  connectCrm: () => ipcRenderer.send('api:connect', { provider: 'crm' }),
  onApiStatus: (cb) => ipcRenderer.on('api:status', (_, data) => cb(data)),
  onMeetingActive: (cb) => ipcRenderer.on('meeting:active', (_, data) => cb(data)),
})
```

---

## Step 4 — overlay-preload.js

```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  close: () => ipcRenderer.send('overlay:close'),
  reportHeight: (h) => ipcRenderer.send('overlay:height', h),
  onBriefUpdate: (cb) => ipcRenderer.on('brief:update', (_, data) => cb(data)),
  onMeetingStart: (cb) => ipcRenderer.on('meeting:start', () => cb()),
})
```

---

## Step 5 — services/transcriptPoller.js

Polls the backend every 10 seconds for new transcript segments.

```javascript
let lastSegmentCount = 0

function startPolling(meetingId, onNewSegments) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:8056/transcripts/google_meet/${meetingId}`)
      if (!res.ok) return
      const data = await res.json()
      const segments = data.segments || []

      if (segments.length > lastSegmentCount) {
        const newSegments = segments.slice(lastSegmentCount)
        lastSegmentCount = segments.length
        onNewSegments(newSegments)
      }
    } catch (err) {
      console.error('Transcript poll error:', err)
    }
  }, 10000)

  return () => clearInterval(interval)
}

module.exports = { startPolling }
```

---

## Step 6 — services/briefGenerator.js

Calls Claude API to generate live briefs from transcript segments.

```javascript
let lastCallTime = 0
const MIN_GAP_MS = 8000

async function generateBrief(segments) {
  const now = Date.now()
  if (now - lastCallTime < MIN_GAP_MS) return null
  lastCallTime = now

  const transcriptText = segments.map(s => `${s.speaker}: ${s.text}`).join('\n')

  const systemPrompt = `You are Ashera, a real-time sales assistant. Analyze the transcript excerpt and generate sales coaching briefs in Turkish.

Output ONLY valid JSON with this exact structure:
{
  "alerts": [{"type": "price|tech|hot|neutral", "text": "short alert text"}],
  "briefs": [{"tag": "aksiyon|dikkat|bilgi", "text": "brief text, max 2 lines, HTML bold tags allowed"}],
  "dealScore": 0-100
}

Rules:
- Max 2 alerts, max 3 briefs
- Each brief max 15 words
- Be direct, no hedging words
- If price objection detected: always include an "aksiyon" brief with a concrete response
- If competitor mentioned: note it in "dikkat"
- Deal score: start at 50, increase for buying signals, decrease for objections
- Output only JSON, no other text`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcriptText }],
      })
    })

    const data = await response.json()
    const text = data.content[0].text.trim()
    return JSON.parse(text)
  } catch (err) {
    console.error('Brief generation error:', err)
    return null
  }
}

module.exports = { generateBrief }
```

---

## Step 7 — electron-builder.yml

```yaml
appId: net.ashera.desktop
productName: Ashera
directories:
  output: dist
files:
  - main.js
  - preload.js
  - overlay-preload.js
  - app/**
  - overlay/**
  - services/**
  - node_modules/**
mac:
  category: public.app-category.business
  target: dmg
win:
  target: nsis
linux:
  target: AppImage
```

---

## Environment

Create `.env` in project root:
```
ANTHROPIC_API_KEY=your_key_here
```

Load in `main.js` at the top:
```javascript
require('dotenv').config()
```

Install: `npm install dotenv`

---

## Definition of Done

1. `npm start` launches the app without errors
2. Main window opens with sidebar, Meet screen visible
3. Navigating to API settings shows three connection groups
4. Pasting a Meet URL and clicking "Katıl & Kaydı Başlat" opens the overlay window
5. Overlay appears centered at top of screen, above all other windows
6. Overlay stays visible when switching to another application
7. Overlay close button destroys the overlay window
8. Brief updates received via IPC render correctly in the overlay with fade-in animation
9. Deal score color changes correctly (green/amber/red thresholds)
10. App builds with `npm run dist` without errors

## What NOT to do

- Do not change the UI colors, fonts, or layout — use the provided code exactly
- Do not add screens beyond Meet and API settings
- Do not implement OAuth flows for Slack/CRM/Phone in this task — the buttons should log to console and show a "yakında" toast
- Do not add a database or local storage in this task — API connection state lives in React state only for now
- Do not modify the backend services (vexa-lite, assemblyai-proxy, call-receiver)
