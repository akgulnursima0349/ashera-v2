# Implementation Spec — Desktop App UI Redesign

## Context

The Ashera desktop app is already built at `ashera-desktop/`. You are replacing the current UI with a new design. The functionality stays exactly the same — only the visual appearance changes.

Read the existing `ashera-desktop/app/index.jsx` and `ashera-desktop/app/index.html` before starting.

Do not touch `main.js`, `preload.js`, `overlay-preload.js`, `overlay/`, or `services/`. Only modify:
- `app/index.html`
- `app/index.jsx`

---

## Logo

The logo file is at `assets/logo.png`. It is a dark logo (black on white background).

In every place the logo appears, apply `filter: invert(1)` to make it white on the dark background.

Do not draw or generate any SVG logo. Use the actual `assets/logo.png` file everywhere.

---

## Global styles — replace everything in app/index.html

Replace the entire `<style>` block in `app/index.html` with this:

```html
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>Ashera</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: #09090b;
  font-family: 'Inter', sans-serif;
  color: rgba(255,255,255,0.85);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

#root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
</head>
<body>
<div id="root"></div>
<script src="bundle.js"></script>
</body>
</html>
```

---

## Full app/index.jsx — replace entirely

Replace the entire contents of `app/index.jsx` with the following. Do not modify any IPC calls or window.appAPI calls — keep them exactly as they are in the current file. Only the visual layer changes.

```jsx
import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

const C = {
  bg: '#09090b',
  bgDeep: '#050507',
  bgCard: 'rgba(255,255,255,0.02)',
  border: 'rgba(255,255,255,0.06)',
  borderMid: 'rgba(255,255,255,0.1)',
  text: 'rgba(255,255,255,0.85)',
  textMuted: 'rgba(255,255,255,0.3)',
  textFaint: 'rgba(255,255,255,0.15)',
  green: '#1d9e75',
  greenLight: '#5dcaa5',
  greenBg: 'rgba(29,158,117,0.12)',
  greenBorder: 'rgba(29,158,117,0.25)',
  purpleBg: 'rgba(83,74,183,0.1)',
  purpleLight: '#afa9ec',
}

// ─── Titlebar ────────────────────────────────────────────────
function Titlebar({ isLive, company }) {
  return (
    <div style={{
      height: 44,
      background: C.bg,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      borderBottom: `0.5px solid ${C.border}`,
      flexShrink: 0,
      position: 'relative',
      WebkitAppRegion: 'drag',
    }}>
      <div style={{ display: 'flex', gap: 7, WebkitAppRegion: 'no-drag' }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', display: 'block' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e', display: 'block' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', display: 'block' }} />
      </div>

      <div style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <img
          src="../assets/logo.png"
          style={{ width: 18, height: 18, objectFit: 'contain', filter: 'invert(1)', opacity: 0.85 }}
          alt=""
        />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.02em' }}>
          Ashera
        </span>
        {isLive && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: C.greenBg,
            border: `0.5px solid ${C.greenBorder}`,
            borderRadius: 20, padding: '3px 10px',
            fontSize: 11, color: C.greenLight,
            fontFamily: 'DM Mono, monospace',
            animation: 'fade-in 0.3s ease',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: C.green, display: 'block',
              animation: 'pulse-dot 2s infinite',
            }} />
            {company || 'Canlı'}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────
function Sidebar({ screen, onNav }) {
  const btn = (id, icon, label) => (
    <button
      key={id}
      onClick={() => onNav(id)}
      aria-label={label}
      style={{
        width: 38, height: 38,
        borderRadius: 10,
        border: 'none', cursor: 'pointer',
        background: screen === id ? C.greenBg : 'transparent',
        color: screen === id ? C.greenLight : C.textMuted,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
        transition: 'all 0.15s',
        position: 'relative',
      }}
    >
      {screen === id && (
        <span style={{
          position: 'absolute', left: -9,
          top: '50%', transform: 'translateY(-50%)',
          width: 2, height: 20,
          background: C.green, borderRadius: '0 2px 2px 0',
        }} />
      )}
      <i className={`ti ti-${icon}`} aria-hidden="true" />
    </button>
  )

  return (
    <div style={{
      width: 56,
      background: C.bgDeep,
      borderRight: `0.5px solid ${C.border}`,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '14px 0', gap: 2,
      flexShrink: 0,
    }}>
      <img
        src="../assets/logo.png"
        style={{ width: 26, height: 26, objectFit: 'contain', filter: 'invert(1)', opacity: 0.85, marginBottom: 14 }}
        alt="Ashera"
      />
      {btn('meet', 'video', 'Meet ekranı')}
      {btn('api', 'plug', 'Bağlantılar')}
      <div style={{ flex: 1 }} />
      <div style={{ width: 24, height: '0.5px', background: C.border, margin: '8px 0' }} />
      {btn('settings', 'settings', 'Ayarlar')}
    </div>
  )
}

// ─── Meet Screen ──────────────────────────────────────────────
function MeetScreen({ onJoin }) {
  const [url, setUrl] = useState('')
  const [isLive, setIsLive] = useState(false)
  const inputRef = useRef(null)

  const handleJoin = () => {
    if (!url.trim()) return
    onJoin(url.trim())
    setIsLive(true)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') handleJoin()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '18px 24px 14px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-video" style={{ fontSize: 15, color: C.textMuted }} aria-hidden="true" />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Google Meet</span>
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3, fontFamily: 'DM Mono, monospace' }}>
          toplantıya katıl — live brif otomatik açılır
        </div>
      </div>

      {isLive ? (
        <webview
          src={url}
          style={{ flex: 1 }}
          useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          allowpopups="true"
        />
      ) : (
        <div style={{
          flex: 1, background: C.bgDeep,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 14, position: 'relative',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: C.greenBg,
            border: `0.5px solid ${C.greenBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img
              src="../assets/logo.png"
              style={{ width: 34, height: 34, objectFit: 'contain', filter: 'invert(1)', opacity: 0.5 }}
              alt=""
            />
          </div>
          <div style={{ fontSize: 13, color: C.textFaint, textAlign: 'center', lineHeight: 1.6 }}>
            URL'yi yapıştır veya<br />aşağıdan son toplantıya dön
          </div>

          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: '10px 20px',
            borderTop: `0.5px solid ${C.border}`,
            background: C.bg,
          }}>
            <div style={{
              fontSize: 10, color: C.textFaint,
              fontFamily: 'DM Mono, monospace',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: 8,
            }}>son toplantılar</div>
            <RecentItem name="TechCorp — Demo görüşmesi" time="dün 14:30" />
          </div>
        </div>
      )}

      <div style={{
        display: 'flex', gap: 8, padding: '12px 18px',
        borderTop: `0.5px solid ${C.border}`,
        background: C.bg, flexShrink: 0,
      }}>
        <input
          ref={inputRef}
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={handleKey}
          placeholder="meet.google.com/abc-defg-hij"
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.04)',
            border: `0.5px solid ${C.borderMid}`,
            borderRadius: 10, padding: '10px 14px',
            fontSize: 13, color: 'rgba(255,255,255,0.7)',
            fontFamily: 'Inter, sans-serif', outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = C.greenBorder}
          onBlur={e => e.target.style.borderColor = C.borderMid}
        />
        <button
          onClick={handleJoin}
          style={{
            background: C.green, border: 'none', borderRadius: 10,
            padding: '10px 18px', fontSize: 13, fontWeight: 500,
            color: '#fff', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            whiteSpace: 'nowrap', transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.target.style.background = '#158f68'}
          onMouseLeave={e => e.target.style.background = C.green}
        >
          Katıl & Kaydı Başlat
        </button>
      </div>
    </div>
  )
}

function RecentItem({ name, time }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 8,
      background: 'rgba(255,255,255,0.03)',
      border: `0.5px solid ${C.border}`,
      cursor: 'pointer',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.greenLight, flexShrink: 0, display: 'block' }} />
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{name}</span>
      <span style={{ fontSize: 11, color: C.textFaint, fontFamily: 'DM Mono, monospace' }}>{time}</span>
    </div>
  )
}

// ─── API Screen ───────────────────────────────────────────────
function ConnGroup({ icon, iconColor, iconBg, title, desc, connected, children }) {
  return (
    <div style={{
      borderRadius: 12,
      border: `0.5px solid ${connected ? C.greenBorder : C.border}`,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        background: C.bgCard,
        borderBottom: `0.5px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: iconBg || 'rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: iconColor || C.textMuted,
          }}>
            <i className={`ti ti-${icon}`} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.75)' }}>{title}</div>
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 1 }}>{desc}</div>
          </div>
        </div>
        <span style={{
          fontSize: 10, fontFamily: 'DM Mono, monospace',
          padding: '3px 9px', borderRadius: 20, fontWeight: 500,
          background: connected ? C.greenBg : 'rgba(255,255,255,0.04)',
          color: connected ? C.greenLight : C.textFaint,
          border: `0.5px solid ${connected ? C.greenBorder : 'rgba(255,255,255,0.08)'}`,
        }}>
          {connected ? 'bağlı' : 'bağlı değil'}
        </span>
      </div>
      {children}
    </div>
  )
}

function ConnRow({ label, value, btnText, btnPrimary, onAction }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 16px',
      borderBottom: `0.5px solid rgba(255,255,255,0.03)`,
    }}>
      <span style={{ fontSize: 11, color: C.textFaint, fontFamily: 'DM Mono, monospace', width: 80, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{
        flex: 1, fontSize: 12, fontFamily: 'DM Mono, monospace',
        color: value ? 'rgba(255,255,255,0.45)' : C.textFaint,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value || '—'}
      </span>
      {btnText && (
        <button
          onClick={onAction}
          style={{
            background: 'transparent',
            border: `0.5px solid ${btnPrimary ? C.greenBorder : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 8, padding: '5px 12px',
            fontSize: 11, fontWeight: 500,
            color: btnPrimary ? C.greenLight : 'rgba(255,255,255,0.35)',
            cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = btnPrimary ? C.greenBg : 'rgba(255,255,255,0.05)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {btnText}
        </button>
      )}
    </div>
  )
}

function ApiScreen() {
  const [slack, setSlack] = useState({ connected: false, workspace: '', channel: '' })
  const [calendar, setCalendar] = useState({ connected: false, email: '' })
  const [phone, setPhone] = useState({ connected: false, provider: '', webhookUrl: '' })
  const [crm, setCrm] = useState({ connected: false, domain: '' })
  const [toast, setToast] = useState(null)

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    if (window.appAPI?.onApiStatus) {
      window.appAPI.onApiStatus((status) => {
        if (status.provider === 'slack') setSlack(s => ({ ...s, ...status }))
        if (status.provider === 'calendar') setCalendar(s => ({ ...s, ...status }))
        if (status.provider === 'phone') setPhone(s => ({ ...s, ...status }))
        if (status.provider === 'crm') setCrm(s => ({ ...s, ...status }))
      })
    }
  }, [])

  const connectSlack = () => { window.appAPI?.connectSlack?.(); showToast('Tarayıcı açılıyor...') }
  const connectCalendar = () => { window.appAPI?.connectCalendar?.(); showToast('Tarayıcı açılıyor...') }
  const connectPhone = () => { window.appAPI?.connectPhone?.(); showToast('yakında') }
  const connectCrm = () => { window.appAPI?.connectCrm?.(); showToast('Tarayıcı açılıyor...') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ padding: '18px 24px 14px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-plug" style={{ fontSize: 15, color: C.textMuted }} aria-hidden="true" />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Bağlantılar</span>
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3, fontFamily: 'DM Mono, monospace' }}>
          bir kez bağla, Ashera gerisini halleder
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ConnGroup icon="brand-slack" iconColor={C.greenLight} iconBg={C.greenBg} title="Slack" desc="Raporlar ve brif bildirimleri" connected={slack.connected}>
          <ConnRow label="workspace" value={slack.workspace} btnText={slack.connected ? 'yenile' : 'bağlan'} btnPrimary={!slack.connected} onAction={connectSlack} />
          {slack.connected && <ConnRow label="kanal" value={slack.channel} />}
        </ConnGroup>

        <ConnGroup icon="calendar" iconColor={C.textMuted} iconBg="rgba(255,255,255,0.05)" title="Google Calendar" desc="Toplantı öncesi otomatik brif" connected={calendar.connected}>
          <ConnRow label="hesap" value={calendar.email} btnText={calendar.connected ? 'yenile' : 'Google ile bağlan'} btnPrimary={!calendar.connected} onAction={connectCalendar} />
        </ConnGroup>

        <ConnGroup icon="phone" iconColor={C.textMuted} iconBg="rgba(255,255,255,0.05)" title="Telefon sistemi" desc="Arama kayıtları ve transkripti" connected={phone.connected}>
          <ConnRow label="sağlayıcı" value={phone.provider} btnText={phone.connected ? 'yenile' : 'bağlan'} btnPrimary={!phone.connected} onAction={connectPhone} />
          {phone.webhookUrl && <ConnRow label="webhook" value={phone.webhookUrl} />}
        </ConnGroup>

        <ConnGroup icon="database" iconColor={C.purpleLight} iconBg={C.purpleBg} title="HubSpot CRM" desc="Doğal dil ile CRM komutları" connected={crm.connected}>
          <ConnRow label="portal" value={crm.domain} btnText={crm.connected ? 'yenile' : 'HubSpot ile bağlan'} btnPrimary={!crm.connected} onAction={connectCrm} />
        </ConnGroup>
      </div>

      {toast && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)',
          border: `0.5px solid ${C.border}`,
          borderRadius: 8, padding: '8px 16px',
          fontSize: 12, color: 'rgba(255,255,255,0.6)',
          fontFamily: 'DM Mono, monospace',
          animation: 'fade-in 0.2s ease',
          whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── App root ─────────────────────────────────────────────────
function App() {
  const [screen, setScreen] = useState('meet')
  const [isLive, setIsLive] = useState(false)
  const [company, setCompany] = useState('')

  const handleJoin = (url) => {
    window.appAPI?.joinMeeting?.(url)
    setIsLive(true)
    setCompany('Toplantı')
  }

  useEffect(() => {
    if (window.appAPI?.onMeetingActive) {
      window.appAPI.onMeetingActive((data) => {
        setIsLive(true)
        setCompany(data?.companyName || 'Canlı')
      })
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Titlebar isLive={isLive} company={company} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar screen={screen} onNav={setScreen} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {screen === 'meet' && <MeetScreen onJoin={handleJoin} />}
          {screen === 'api' && <ApiScreen />}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
```

---

## What to check before finishing

1. Run `npm run build` — webpack should compile without errors
2. Run `npm start` — app opens, both screens visible
3. Logo appears in 3 places: titlebar center, sidebar top, Meet screen center circle
4. Sidebar active indicator: left green line appears on active button
5. Bağlantılar screen: all 4 connection groups visible with correct badges
6. "Katıl & Kaydı Başlat" button triggers `window.appAPI.joinMeeting` — verify IPC still works
7. All existing `window.appAPI.*` calls preserved exactly — do not rename or remove any

## What NOT to do

- Do not modify main.js, preload.js, overlay files, or services/
- Do not change any IPC channel names
- Do not add new screens or navigation items
- Do not use any hardcoded SVG for the logo — always use `../assets/logo.png` with `filter: invert(1)`
- Do not install new npm packages
