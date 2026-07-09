const WebSocket = require('ws')

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?' + new URLSearchParams({
  model: 'nova-2',
  detect_language: 'true',
  diarize: 'true',
  punctuate: 'true',
  smart_format: 'true',
  filler_words: 'false',
  interim_results: 'true',
  endpointing: '300',
  encoding: 'linear16',
  sample_rate: '16000',
  channels: '1',
}).toString()

let dgSocket = null
let sessionId = null
let segmentBuffer = []
let onSegmentCallback = null
let keepAliveInterval = null

function startStreaming(sid, dbMeetingId, onSegment) {
  sessionId = sid
  segmentBuffer = []
  onSegmentCallback = onSegment

  dgSocket = new WebSocket(DEEPGRAM_URL, {
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
    }
  })

  dgSocket.on('open', () => {
    console.log('[Deepgram] Connected')
    // Keep-alive ping every 5 seconds
    keepAliveInterval = setInterval(() => {
      if (dgSocket && dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(JSON.stringify({ type: 'KeepAlive' }))
      }
    }, 5000)
  })

  dgSocket.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())

      // Only process final results (not interim)
      if (msg.type === 'Results' && msg.is_final) {
        const alt = msg.channel?.alternatives?.[0]
        if (!alt || !alt.transcript || alt.transcript.trim() === '') return

        const words = alt.words || []
        const speaker = words[0]?.speaker !== undefined
          ? `Speaker ${words[0].speaker + 1}`
          : 'Speaker'

        const segment = {
          text: alt.transcript.trim(),
          speaker,
          start: msg.start ? Math.round(msg.start * 1000) : null,
          end: msg.start && msg.duration
            ? Math.round((msg.start + msg.duration) * 1000)
            : null,
          language: msg.channel?.detected_language || 'tr',
          confidence: alt.confidence || 1,
        }

        segmentBuffer.push(segment)

        // Send to brief generator
        if (onSegmentCallback) {
          onSegmentCallback([segment])
        }

        console.log(`[Deepgram] ${speaker}: ${segment.text.slice(0, 60)}`)
      }
    } catch (err) {
      console.error('[Deepgram] Parse error:', err.message)
    }
  })

  dgSocket.on('error', (err) => {
    console.error('[Deepgram] WebSocket error:', err.message)
  })

  dgSocket.on('close', (code, reason) => {
    console.log(`[Deepgram] Disconnected: ${code} ${reason}`)
    clearInterval(keepAliveInterval)
  })
}

function addChunk(arrayBuffer) {
  if (dgSocket && dgSocket.readyState === WebSocket.OPEN) {
    // arrayBuffer is Float32 PCM from Web Audio API — convert to Int16
    const float32 = new Float32Array(arrayBuffer)
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    dgSocket.send(Buffer.from(int16.buffer))
  }
}

function stopStreaming() {
  clearInterval(keepAliveInterval)

  if (dgSocket && dgSocket.readyState === WebSocket.OPEN) {
    // Send CloseStream to flush remaining audio
    dgSocket.send(JSON.stringify({ type: 'CloseStream' }))
    setTimeout(() => {
      dgSocket.close()
      dgSocket = null
    }, 1000)
  }

  const finalSegments = [...segmentBuffer]
  segmentBuffer = []
  sessionId = null
  onSegmentCallback = null

  return finalSegments
}

function getSegments() {
  return [...segmentBuffer]
}

module.exports = { startStreaming, addChunk, stopStreaming, getSegments }
