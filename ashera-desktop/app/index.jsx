import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

const C = {
  bg: '#0d1117',
  bgDeep: '#080d13',
  bgCard: 'rgba(255,255,255,0.02)',
  border: 'rgba(255,255,255,0.06)',
  borderMid: 'rgba(255,255,255,0.1)',
  text: 'rgba(255,255,255,0.85)',
  textMuted: 'rgba(255,255,255,0.3)',
  textFaint: 'rgba(255,255,255,0.15)',
  green: '#388bfd',
  greenLight: '#79b8ff',
  greenBg: 'rgba(56,139,253,0.12)',
  greenBorder: 'rgba(56,139,253,0.25)',
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
            {company || 'Live'}
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
        background: screen === id ? 'rgba(56,139,253,0.15)' : 'transparent',
        color: screen === id ? '#79b8ff' : C.textMuted,
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
      {btn('meet', 'video', 'Meet screen')}
      {btn('api', 'plug', 'Connections')}
      {btn('transcripts', 'file-text', 'Transcripts')}
      <div style={{ flex: 1 }} />
      <div style={{ width: 24, height: '0.5px', background: C.border, margin: '8px 0' }} />
      {btn('settings', 'settings', 'Settings')}
    </div>
  )
}

// ─── Meet Screen ──────────────────────────────────────────────
function MeetScreen({ onStop }) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [sessionId, setSessionId] = useState(null)
  const [upcomingMeeting, setUpcomingMeeting] = useState(null)
  const [audioStatus, setAudioStatus] = useState('idle') // idle | requesting | joining | capturing | error
  const [teamsUrl, setTeamsUrl] = useState('')
  const [language, setLanguage] = useState('en')

  // Timer
  useEffect(() => {
    if (!isCapturing) return
    const interval = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(interval)
  }, [isCapturing])

  // Listen for events from main process
  useEffect(() => {
    window.appAPI?.onMeetingActive?.((data) => {
      setIsCapturing(true)
      setSessionId(data.sessionId)
      setElapsed(0)
      setAudioStatus('capturing')
    })

    window.appAPI?.onAudioStatus?.((status) => {
      setAudioStatus(status)
      if (status === 'error') setIsCapturing(false)
    })

    window.appAPI?.onUpcomingMeeting?.((meeting) => {
      setUpcomingMeeting(meeting)
    })

    // Main grants audio permission — trigger DOM capture
    window.appAPI?.onAudioPermissionRequest?.(() => {
      window.appAPI?.triggerAudioCapture?.()
    })
  }, [])

  const formatTime = (s) => {
    const m = String(Math.floor(s / 60)).padStart(2, '0')
    const sec = String(s % 60).padStart(2, '0')
    return `${m}:${sec}`
  }

  const handleStart = (data) => {
    const platform = data?.platform || 'audio'
    setAudioStatus(platform === 'teams' ? 'joining' : 'requesting')
    window.appAPI?.startCapture?.({ language, ...data })
  }

  const handleStop = () => {
    window.appAPI?.stopCapture?.()
    setIsCapturing(false)
    setSessionId(null)
    setElapsed(0)
    setAudioStatus('idle')
    setUpcomingMeeting(null)
    if (onStop) onStop()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '18px 24px 14px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-waveform" style={{ fontSize: 15, color: C.textMuted }} aria-hidden="true" />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Live Transcription</span>
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3, fontFamily: 'DM Mono, monospace' }}>
          {isCapturing
            ? 'live brief is running'
            : audioStatus === 'joining'
              ? 'Teams bot is joining the meeting...'
              : 'join your meeting in the browser, then start capture here'}
        </div>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, background: C.bgDeep,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 16, position: 'relative', padding: '0 24px',
      }}>
        {isCapturing ? (
          /* Capturing state */
          <>
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: 'rgba(29,158,117,0.08)',
              border: `1px solid ${C.greenBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                background: C.green, display: 'block',
                animation: 'pulse-dot 1.5s infinite',
              }} />
              <span style={{
                position: 'absolute', inset: -8,
                borderRadius: '50%',
                border: `1px solid ${C.greenBorder}`,
                animation: 'pulse-dot 1.5s infinite',
                animationDelay: '0.3s',
              }} />
            </div>

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>
                Capturing audio
              </div>
              <div style={{
                fontSize: 22, fontWeight: 600,
                color: C.greenLight,
                fontFamily: 'DM Mono, monospace',
                letterSpacing: '0.05em',
              }}>
                {formatTime(elapsed)}
              </div>
              <div style={{ fontSize: 11, color: C.textFaint, fontFamily: 'DM Mono, monospace' }}>
                Live brief is active — check the overlay
              </div>
            </div>

            <button
              onClick={handleStop}
              style={{
                marginTop: 8,
                background: 'rgba(255,80,80,0.08)',
                border: '0.5px solid rgba(255,80,80,0.25)',
                borderRadius: 10, padding: '9px 22px',
                fontSize: 12, fontWeight: 500,
                color: '#ff7070', cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,80,80,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,80,80,0.08)'}
            >
              Stop & Generate Report
            </button>
          </>
        ) : (
          /* Idle state */
          <>
            {/* Upcoming meeting banner */}
            {upcomingMeeting && (
              <div style={{
                width: '100%',
                background: C.greenBg,
                border: `0.5px solid ${C.greenBorder}`,
                borderRadius: 10, padding: '10px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 8,
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: C.greenLight }}>
                    {upcomingMeeting.title}
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                    starts in {upcomingMeeting.minsUntil} min
                    {upcomingMeeting.platform === 'teams' && ' · Teams bot will join'}
                    {upcomingMeeting.platform === 'meet' && ' · system audio capture'}
                  </div>
                </div>
                <button
                  onClick={() => handleStart({
                    platform: upcomingMeeting.platform,
                    meetingUrl: upcomingMeeting.meetLink,
                  })}
                  style={{
                    background: C.green, border: 'none',
                    borderRadius: 8, padding: '6px 14px',
                    fontSize: 11, fontWeight: 500,
                    color: '#fff', cursor: 'pointer',
                  }}
                >
                  {upcomingMeeting.platform === 'teams' ? 'Send Bot' : 'Start Now'}
                </button>
              </div>
            )}

            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: C.greenBg,
              border: `0.5px solid ${C.greenBorder}`,
              overflow: 'hidden',
            }}>
              <img
                src="../assets/logo.png"
                style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '50%' }}
                alt=""
              />
            </div>

            <div style={{ fontSize: 13, color: C.textFaint, textAlign: 'center', lineHeight: 1.7 }}>
              Join your meeting in the browser first<br />
              <span style={{ fontSize: 11 }}>then start capture — Ashera listens to system audio</span>
            </div>

            {audioStatus === 'error' && (
              <div style={{
                fontSize: 11, color: '#ff7070',
                fontFamily: 'DM Mono, monospace',
                textAlign: 'center',
              }}>
                Audio capture failed — check permissions
              </div>
            )}

            {window.platform === 'darwin' && (
              <div style={{
                fontSize: 11, color: C.textFaint,
                fontFamily: 'DM Mono, monospace',
                textAlign: 'center', padding: '0 16px',
                lineHeight: 1.6,
              }}>
                Mac users: when the screen picker opens,<br />
                select a window or screen and enable "Share audio"
              </div>
            )}

            {/* Recent sessions */}
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
              }}>recent sessions</div>
              <RecentItem name="TechCorp — Demo call" time="yesterday 14:30" />
            </div>
          </>
        )}
      </div>

      {/* Start button — only when idle */}
      {!isCapturing && (
        <div style={{
          padding: '12px 18px',
          borderTop: `0.5px solid ${C.border}`,
          background: C.bg, flexShrink: 0,
        }}>
          {/* Language selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.textFaint, fontFamily: 'DM Mono, monospace' }}>lang</span>
            {['en', 'tr'].map(lang => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 6,
                  fontSize: 11, fontWeight: 500,
                  fontFamily: 'DM Mono, monospace',
                  cursor: 'pointer',
                  border: language === lang ? `0.5px solid ${C.green}` : `0.5px solid ${C.border}`,
                  background: language === lang ? C.greenBg : 'transparent',
                  color: language === lang ? C.greenLight : C.textMuted,
                  transition: 'all 0.1s',
                }}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleStart()}
            disabled={audioStatus === 'requesting' || audioStatus === 'joining'}
            style={{
              width: '100%',
              background: (audioStatus === 'requesting' || audioStatus === 'joining') ? 'rgba(29,158,117,0.5)' : C.green,
              border: 'none', borderRadius: 10,
              padding: '11px 18px', fontSize: 13, fontWeight: 500,
              color: '#fff', cursor: (audioStatus === 'requesting' || audioStatus === 'joining') ? 'not-allowed' : 'pointer',
              fontFamily: 'Inter, sans-serif',
              transition: 'background 0.15s',
            }}
          >
            {audioStatus === 'requesting' ? 'Requesting audio permission...' : audioStatus === 'joining' ? 'Teams bot joining...' : 'Start Capture'}
          </button>
          <div style={{ width: '100%', marginTop: 8, display: 'flex', gap: 8 }}>
            <input
              placeholder="Or paste Teams meeting URL..."
              value={teamsUrl}
              onChange={e => setTeamsUrl(e.target.value)}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.04)',
                border: `0.5px solid ${C.borderMid}`,
                borderRadius: 10, padding: '8px 12px',
                fontSize: 12, color: 'rgba(255,255,255,0.6)',
                fontFamily: 'Inter, sans-serif', outline: 'none',
              }}
            />
            <button
              onClick={() => {
                if (teamsUrl.includes('teams')) {
                  handleStart({ platform: 'teams', meetingUrl: teamsUrl })
                }
              }}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: `0.5px solid ${C.border}`,
                borderRadius: 10, padding: '8px 14px',
                fontSize: 12, color: C.textMuted,
                cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                whiteSpace: 'nowrap',
              }}
            >
              Send Bot
            </button>
          </div>
        </div>
      )}
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

// ─── Transcripts Screen ───────────────────────────────────────
function TranscriptsScreen() {
  const [meetings, setMeetings] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [segments, setSegments] = useState([])
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)

  // Fetch meeting list on mount
  useEffect(() => {
    fetchMeetings()
  }, [])

  async function fetchMeetings() {
    setListLoading(true)
    try {
      const sessions = await window.appAPI.listSessions()
      setMeetings(sessions || [])
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
      setMeetings([])
    } finally {
      setListLoading(false)
    }
  }

  async function selectMeeting(meeting) {
    setSelectedId(meeting.id)
    setSegments([])
    setLoading(true)
    try {
      const session = await window.appAPI.getSession(meeting.id)
      setSegments(session?.segments || [])
    } catch (err) {
      console.error('Failed to fetch session:', err)
      setSegments([])
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    })
  }

  function formatTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  function formatDuration(startStr, endStr) {
    if (!startStr || !endStr) return ''
    const diff = Math.round((new Date(endStr) - new Date(startStr)) / 1000 / 60)
    if (isNaN(diff) || diff < 0) return ''
    return `${diff} min`
  }

  function formatSegmentTime(ms) {
    if (ms == null) return ''
    const totalSec = Math.floor(ms / 1000)
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0')
    const s = String(totalSec % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  function getMeetingLabel(meeting) {
    if (meeting.data?.company) return meeting.data.company
    if (meeting.platform_specific_id) return meeting.platform_specific_id
    if (meeting.platform === 'desktop_audio') return 'Desktop Recording'
    return 'Meeting'
  }

  function getPlatformIcon(platform) {
    if (platform === 'teams') return 'brand-teams'
    if (platform === 'phone_call') return 'phone'
    if (platform === 'desktop_audio') return 'waveform'
    return 'video'
  }

  // Group segments by speaker for cleaner display
  function groupSegments(segs) {
    if (!segs || segs.length === 0) return []
    const grouped = []
    let current = null

    for (const seg of segs) {
      const speaker = seg.speaker || 'Speaker'
      if (current && current.speaker === speaker) {
        current.text += ' ' + seg.text
        current.end = seg.end || seg.end_time
      } else {
        if (current) grouped.push(current)
        current = {
          speaker,
          text: seg.text,
          start: seg.start || seg.start_time,
          end: seg.end || seg.end_time,
        }
      }
    }
    if (current) grouped.push(current)
    return grouped
  }

  const selectedMeeting = meetings.find(m => m.id === selectedId)
  const groupedSegments = groupSegments(segments)

  // Assign consistent colors to speakers
  const speakerColors = {}
  const colorPalette = ['#79b8ff', '#5DCAA5', '#FAC775', '#AFA9EC', '#F09595']
  let colorIndex = 0
  groupedSegments.forEach(seg => {
    if (!speakerColors[seg.speaker]) {
      speakerColors[seg.speaker] = colorPalette[colorIndex % colorPalette.length]
      colorIndex++
    }
  })

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* Left panel — meeting list */}
      <div style={{
        width: 220, flexShrink: 0,
        borderRight: `0.5px solid ${C.border}`,
        display: 'flex', flexDirection: 'column',
        background: C.bgDeep,
      }}>
        <div style={{ padding: '18px 16px 12px', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Transcripts</div>
          <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2, fontFamily: 'DM Mono, monospace' }}>
            {meetings.length} sessions
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {listLoading ? (
            <div style={{ padding: '20px 16px', fontSize: 12, color: C.textFaint, fontFamily: 'DM Mono, monospace' }}>
              Loading...
            </div>
          ) : meetings.length === 0 ? (
            <div style={{ padding: '20px 16px', fontSize: 12, color: C.textFaint, textAlign: 'center', lineHeight: 1.6 }}>
              No completed sessions yet
            </div>
          ) : (
            meetings.map(meeting => (
              <div
                key={meeting.id}
                onClick={() => selectMeeting(meeting)}
                style={{
                  padding: '10px 14px',
                  borderBottom: `0.5px solid ${C.border}`,
                  cursor: 'pointer',
                  background: selectedId === meeting.id
                    ? 'rgba(56,139,253,0.08)'
                    : 'transparent',
                  borderLeft: selectedId === meeting.id
                    ? '2px solid #388bfd'
                    : '2px solid transparent',
                  transition: 'all 0.1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <i
                    className={`ti ti-${getPlatformIcon(meeting.platform)}`}
                    style={{ fontSize: 12, color: C.textMuted }}
                    aria-hidden="true"
                  />
                  <span style={{ fontSize: 12, fontWeight: 500, color: selectedId === meeting.id ? '#79b8ff' : C.text }}>
                    {getMeetingLabel(meeting)}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: C.textFaint, fontFamily: 'DM Mono, monospace' }}>
                  {formatDate(meeting.start_time || meeting.created_at)}
                  {meeting.end_time && ` · ${formatDuration(meeting.start_time, meeting.end_time)}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel — transcript */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedMeeting ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 12, background: C.bgDeep,
          }}>
            <i className="ti ti-file-text" style={{ fontSize: 32, color: C.textFaint }} aria-hidden="true" />
            <div style={{ fontSize: 13, color: C.textFaint, textAlign: 'center', lineHeight: 1.6 }}>
              Select a session from the list<br />to view the full transcript
            </div>
          </div>
        ) : (
          <>
            {/* Transcript header */}
            <div style={{
              padding: '14px 20px',
              borderBottom: `0.5px solid ${C.border}`,
              flexShrink: 0,
              background: C.bg,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i
                  className={`ti ti-${getPlatformIcon(selectedMeeting.platform)}`}
                  style={{ fontSize: 14, color: C.textMuted }}
                  aria-hidden="true"
                />
                <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>
                  {getMeetingLabel(selectedMeeting)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3, fontFamily: 'DM Mono, monospace' }}>
                {formatDate(selectedMeeting.start_time || selectedMeeting.created_at)}
                {selectedMeeting.start_time && ` · ${formatTime(selectedMeeting.start_time)}`}
                {selectedMeeting.end_time && ` · ${formatDuration(selectedMeeting.start_time, selectedMeeting.end_time)}`}
                {groupedSegments.length > 0 && ` · ${segments.length} segments`}
              </div>
            </div>

            {/* Transcript body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: C.bgDeep }}>
              {loading ? (
                <div style={{ fontSize: 12, color: C.textFaint, fontFamily: 'DM Mono, monospace', paddingTop: 20 }}>
                  Loading transcript...
                </div>
              ) : groupedSegments.length === 0 ? (
                <div style={{ fontSize: 12, color: C.textFaint, textAlign: 'center', paddingTop: 40, lineHeight: 1.7 }}>
                  No transcript available for this session
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {groupedSegments.map((seg, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      {/* Speaker label */}
                      <div style={{ flexShrink: 0, width: 80, paddingTop: 2 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 500,
                          color: speakerColors[seg.speaker] || C.textMuted,
                          fontFamily: 'DM Mono, monospace',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          {seg.speaker}
                        </div>
                        {seg.start != null && (
                          <div style={{
                            fontSize: 9, color: C.textFaint,
                            fontFamily: 'DM Mono, monospace',
                            marginTop: 2,
                          }}>
                            {formatSegmentTime(seg.start)}
                          </div>
                        )}
                      </div>

                      {/* Speaker line */}
                      <div style={{
                        width: 2, flexShrink: 0,
                        background: speakerColors[seg.speaker] || C.border,
                        borderRadius: 1, opacity: 0.4,
                        alignSelf: 'stretch',
                        minHeight: 20,
                      }} />

                      {/* Text */}
                      <div style={{
                        flex: 1,
                        fontSize: 13,
                        color: 'rgba(255,255,255,0.8)',
                        lineHeight: 1.65,
                        paddingTop: 1,
                      }}>
                        {seg.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
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
          {connected ? 'connected' : 'not connected'}
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
  const [teams, setTeams] = useState({ connected: false, tenant: '' })
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
        if (status.provider === 'teams') setTeams(s => ({ ...s, ...status }))
      })
    }
  }, [])

  const connectSlack = () => { window.appAPI?.connectSlack?.(); showToast('Opening browser...') }
  const connectCalendar = () => { window.appAPI?.connectCalendar?.(); showToast('Opening browser...') }
  const connectPhone = () => { window.appAPI?.connectPhone?.(); showToast('coming soon') }
  const connectCrm = () => { window.appAPI?.connectCrm?.(); showToast('Opening browser...') }
  const connectTeams = () => { window.appAPI?.connectTeams?.(); showToast('Opening browser...') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ padding: '18px 24px 14px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-plug" style={{ fontSize: 15, color: C.textMuted }} aria-hidden="true" />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Connections</span>
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3, fontFamily: 'DM Mono, monospace' }}>
          connect once, Ashera handles the rest
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ConnGroup icon="brand-slack" iconColor={C.greenLight} iconBg={C.greenBg} title="Slack" desc="Reports and brief notifications" connected={slack.connected}>
          <ConnRow
            label="workspace"
            value={slack.workspace}
            btnText={slack.connected ? 'reconnect' : 'connect'}
            btnPrimary={!slack.connected}
            onAction={connectSlack}
          />
          {!slack.connected && (
            <div style={{
              padding: '10px 16px',
              fontSize: 11,
              color: 'rgba(255,255,255,0.25)',
              fontFamily: 'DM Mono, monospace',
              lineHeight: 1.6,
              borderTop: `0.5px solid rgba(255,255,255,0.04)`,
            }}>
              After connecting, type <span style={{ color: 'rgba(255,255,255,0.45)' }}>/ashera help</span> in any Slack channel. Reports and briefs will arrive in your DMs.
            </div>
          )}
          {slack.connected && (
            <div style={{
              padding: '10px 16px',
              fontSize: 11,
              color: 'rgba(255,255,255,0.25)',
              fontFamily: 'DM Mono, monospace',
              lineHeight: 1.6,
              borderTop: `0.5px solid rgba(255,255,255,0.04)`,
            }}>
              Type <span style={{ color: C.greenLight }}>/ashera help</span> in Slack to see all commands. Check your DMs for reports and briefs.
            </div>
          )}
        </ConnGroup>

        <ConnGroup icon="calendar" iconColor={C.textMuted} iconBg="rgba(255,255,255,0.05)" title="Google Calendar" desc="Automatic pre-meeting brief" connected={calendar.connected}>
          <ConnRow label="account" value={calendar.email} btnText={calendar.connected ? 'reconnect' : 'Connect with Google'} btnPrimary={!calendar.connected} onAction={connectCalendar} />
        </ConnGroup>

        <ConnGroup icon="phone" iconColor={C.textMuted} iconBg="rgba(255,255,255,0.05)" title="Phone system" desc="Call recordings and transcripts" connected={phone.connected}>
          <ConnRow label="provider" value={phone.provider} btnText={phone.connected ? 'reconnect' : 'connect'} btnPrimary={!phone.connected} onAction={connectPhone} />
          {phone.webhookUrl && <ConnRow label="webhook" value={phone.webhookUrl} />}
        </ConnGroup>

        <ConnGroup icon="database" iconColor={C.purpleLight} iconBg={C.purpleBg} title="HubSpot CRM" desc="Natural language CRM commands" connected={crm.connected}>
          <ConnRow label="portal" value={crm.domain} btnText={crm.connected ? 'reconnect' : 'Connect HubSpot'} btnPrimary={!crm.connected} onAction={connectCrm} />
        </ConnGroup>

        <ConnGroup icon="brand-teams" iconColor="#6264A7" iconBg="rgba(98,100,167,0.1)" title="Microsoft Teams" desc="Meeting bot and messaging commands" connected={teams.connected}>
          <ConnRow
            label="tenant"
            value={teams.tenant || '—'}
            btnText={teams.connected ? 'reconnect' : 'Connect Teams'}
            btnPrimary={!teams.connected}
            onAction={connectTeams}
          />
          {!teams.connected && (
            <div style={{
              padding: '10px 16px',
              fontSize: 11,
              color: 'rgba(255,255,255,0.25)',
              fontFamily: 'DM Mono, monospace',
              lineHeight: 1.6,
              borderTop: `0.5px solid rgba(255,255,255,0.04)`,
            }}>
              After connecting, type <span style={{ color: 'rgba(255,255,255,0.45)' }}>ashera help</span> in any Teams channel.
            </div>
          )}
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

  useEffect(() => {
    if (window.appAPI?.onMeetingActive) {
      window.appAPI.onMeetingActive((data) => {
        setIsLive(true)
        setCompany(data?.companyName || 'Live')
      })
    }
  }, [])

  const handleStop = () => {
    setIsLive(false)
    setCompany('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Titlebar isLive={isLive} company={company} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar screen={screen} onNav={setScreen} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {screen === 'meet' && <MeetScreen onStop={handleStop} />}
          {screen === 'api' && <ApiScreen />}
          {screen === 'transcripts' && <TranscriptsScreen />}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
