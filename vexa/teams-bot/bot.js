const { chromium } = require('playwright-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const WebSocket = require('ws')
const RealtimeTranscriber = require('./transcriber')

chromium.use(StealthPlugin())

const JOIN_SELECTORS = [
  'button[data-tid="prejoin-join-button"]',
  'button[aria-label*="Join now"]',
  'button:has-text("Join now")',
  'button[aria-label*="Join"]',
  'button:has-text("Join")',
]

const CONTINUE_SELECTORS = [
  'button:has-text("Continue")',
  'button[aria-label*="Continue"]',
  'button[data-tid*="continue"]',
]

const LEAVE_INDICATORS = [
  'button[aria-label*="Leave"]',
  'button[aria-label*="leave"]',
  '[data-tid="call-controls-bar"]',
  'button[data-tid*="leave"]',
]

const LOBBY_TEXTS = [
  "Waiting for the organizer",
  "Someone in the meeting should let you in",
  "You're in the lobby",
  "Someone will let you in soon",
]

class TeamsBot {
  constructor({ meetingUrl, botName, meetingId, onSegment, onStatusChange }) {
    this.meetingUrl = meetingUrl
    this.botName = botName || 'Ashera'
    this.meetingId = meetingId
    this.onSegment = onSegment
    this.onStatusChange = onStatusChange
    this.browser = null
    this.page = null
    this.transcriber = null
    this.wsServer = null
    this.running = false
  }

  async start() {
    this.running = true
    this.transcriber = new RealtimeTranscriber(this.onSegment)
    await this.transcriber.connect()

    this.browser = await chromium.launch({
      headless: false,  // Must use Xvfb, not true headless
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--use-fake-ui-for-media-stream',
        '--use-file-for-fake-audio-capture=/dev/null',
        '--use-file-for-fake-video-capture=/dev/null',
        '--use-gl=swiftshader',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ]
    })

    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      permissions: ['microphone'],
      viewport: { width: 1280, height: 720 },
    })

    this.page = await context.newPage()

    // CRITICAL: Inject RTCPeerConnection hook BEFORE Teams JS loads
    await this.page.addInitScript(() => {
      const OrigRTC = window.RTCPeerConnection
      window.RTCPeerConnection = function(...args) {
        const pc = new OrigRTC(...args)
        pc.addEventListener('track', (event) => {
          if (event.track.kind === 'audio') {
            const audio = document.createElement('audio')
            audio.srcObject = event.streams[0]
            audio.autoplay = true
            audio.style.display = 'none'
            document.body.appendChild(audio)
            window.__remoteStreams = window.__remoteStreams || []
            window.__remoteStreams.push(event.streams[0])
          }
        })
        return pc
      }
      Object.assign(window.RTCPeerConnection, OrigRTC)
    })

    this.onStatusChange('joining')
    await this.page.goto(this.meetingUrl, { waitUntil: 'networkidle', timeout: 60000 })

    // Click Continue if shown
    for (const sel of CONTINUE_SELECTORS) {
      const btn = this.page.locator(sel).first()
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click()
        break
      }
    }

    // Turn off camera
    await this._tryClick([
      'button[data-tid*="camera"]',
      'button[aria-label*="camera"]',
      'button[aria-label*="Camera"]',
    ])

    // Enter bot name
    const nameInput = this.page.locator('input[placeholder*="name"], input[data-tid*="name"]').first()
    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nameInput.fill(this.botName)
    }

    // Click join
    let joined = false
    for (const sel of JOIN_SELECTORS) {
      const btn = this.page.locator(sel).first()
      if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await btn.click()
        joined = true
        break
      }
    }

    if (!joined) throw new Error('Could not find join button')

    this.onStatusChange('awaiting_admission')

    // Wait for admission (check lobby vs admitted)
    const admitted = await this._waitForAdmission(600000)
    if (!admitted) {
      this.onStatusChange('failed')
      await this.stop()
      return
    }

    this.onStatusChange('active')
    await this._startAudioCapture()

    // Monitor meeting end
    this._monitorMeetingEnd()
  }

  async _waitForAdmission(timeoutMs) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs && this.running) {
      // Check if admitted
      for (const sel of LEAVE_INDICATORS) {
        if (await this.page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false)) {
          return true
        }
      }
      // Check if in lobby
      const pageText = await this.page.evaluate(() => document.body.innerText).catch(() => '')
      const inLobby = LOBBY_TEXTS.some(t => pageText.includes(t))
      if (!inLobby && Date.now() - start > 30000) {
        // Not in lobby and not admitted after 30s — assume admitted
        return true
      }
      await this.page.waitForTimeout(2000)
    }
    return false
  }

  async _startAudioCapture() {
    // Start local WebSocket server to receive audio from page
    this.wsServer = new WebSocket.Server({ port: 0 })
    const wsPort = this.wsServer.address().port

    this.wsServer.on('connection', (ws) => {
      ws.on('message', (data) => {
        if (data instanceof Buffer) {
          this.transcriber.sendFloat32(data.buffer)
        }
      })
    })

    // Inject audio capture into page
    await this.page.evaluate(async (port) => {
      const audioEls = document.querySelectorAll('audio[style*="display: none"]')
      if (!audioEls.length && window.__remoteStreams && window.__remoteStreams.length === 0) {
        console.warn('No audio elements found')
        return
      }

      const audioCtx = new AudioContext({ sampleRate: 48000 })
      const destination = audioCtx.createMediaStreamDestination()

      // Connect all audio elements
      audioEls.forEach(el => {
        if (el.srcObject) {
          audioCtx.createMediaStreamSource(el.srcObject).connect(destination)
        }
      })

      // Also connect RTCPeerConnection streams
      if (window.__remoteStreams) {
        window.__remoteStreams.forEach(stream => {
          audioCtx.createMediaStreamSource(stream).connect(destination)
        })
      }

      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      const source = audioCtx.createMediaStreamSource(destination.stream)
      source.connect(processor)
      processor.connect(audioCtx.destination)

      const ws = new WebSocket(`ws://localhost:${port}`)
      await new Promise(r => ws.addEventListener('open', r))

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0) // Float32 @ 48kHz
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data.buffer)
        }
      }
    }, wsPort)
  }

  async _monitorMeetingEnd() {
    while (this.running) {
      await this.page.waitForTimeout(5000)
      const leaveVisible = await this.page.locator(LEAVE_INDICATORS[0]).first()
        .isVisible().catch(() => false)
      if (!leaveVisible) {
        console.log('Meeting ended (leave button gone)')
        this.onStatusChange('completed')
        await this.stop()
        break
      }
    }
  }

  async _tryClick(selectors) {
    for (const sel of selectors) {
      const btn = this.page.locator(sel).first()
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click().catch(() => {})
        return true
      }
    }
    return false
  }

  async stop() {
    this.running = false
    if (this.transcriber) await this.transcriber.close()
    if (this.wsServer) this.wsServer.close()
    if (this.browser) await this.browser.close()
  }
}

module.exports = TeamsBot
