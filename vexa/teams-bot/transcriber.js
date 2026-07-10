const WebSocket = require('ws')

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?' + new URLSearchParams({
  model: 'nova-2',
  language: 'multi',
  diarize: 'true',
  punctuate: 'true',
  smart_format: 'true',
  filler_words: 'false',
  interim_results: 'true',
  endpointing: '300',
  encoding: 'linear16',
  sample_rate: '48000',  // Teams uses 48kHz
  channels: '1',
}).toString()

class RealtimeTranscriber {
  constructor(onSegment) {
    this.onSegment = onSegment
    this.ws = null
    this.connected = false
    this.buffer = []
    this.keepAliveInterval = null
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(DEEPGRAM_URL, {
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        }
      })

      this.ws.on('open', () => {
        this.connected = true
        console.log('[Deepgram Teams] Connected')

        // Flush buffered audio
        this.buffer.forEach(chunk => this.ws.send(chunk))
        this.buffer = []

        // Keep-alive
        this.keepAliveInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }))
          }
        }, 5000)

        resolve()
      })

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())

          if (msg.type === 'Results' && msg.is_final) {
            const alt = msg.channel?.alternatives?.[0]
            if (!alt || !alt.transcript || alt.transcript.trim() === '') return

            const words = alt.words || []
            const speaker = words[0]?.speaker !== undefined
              ? `Speaker ${words[0].speaker + 1}`
              : 'Speaker'

            this.onSegment({
              text: alt.transcript.trim(),
              speaker,
              start: msg.start ? Math.round(msg.start * 1000) : null,
              end: msg.start && msg.duration
                ? Math.round((msg.start + msg.duration) * 1000)
                : null,
              language: msg.channel?.detected_language || 'tr',
            })
          }
        } catch (err) {
          console.error('[Deepgram Teams] Parse error:', err.message)
        }
      })

      this.ws.on('error', reject)
      this.ws.on('close', () => {
        this.connected = false
        clearInterval(this.keepAliveInterval)
      })
    })
  }

  // Receives Float32Array buffer from Playwright bot
  sendFloat32(float32Buffer) {
    const float32 = new Float32Array(float32Buffer)
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    const pcmBuffer = Buffer.from(int16.buffer)

    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcmBuffer)
    } else {
      this.buffer.push(pcmBuffer)
    }
  }

  async close() {
    clearInterval(this.keepAliveInterval)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }))
      await new Promise(r => setTimeout(r, 500))
      this.ws.close()
    }
  }
}

module.exports = RealtimeTranscriber
