const WebSocket = require('ws')

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY

function buildDeepgramUrl(language = 'multi') {
  return 'wss://api.deepgram.com/v1/listen?' + new URLSearchParams({
    model: 'nova-2',
    language,
    diarize: 'true',
    punctuate: 'true',
    smart_format: 'true',
    filler_words: 'false',
    interim_results: 'true',
    utterance_end_ms: '1500',
    endpointing: '1000',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
  }).toString()
}

let dgSocket = null
let sessionId = null
let segmentBuffer = []
let onSegmentCallback = null
let keepAliveInterval = null
let chunkCount = 0
let chunkLogInterval = null

// Track latest interim result so we can emit it if final arrives empty
let lastInterim = null

function startStreaming(sid, dbMeetingId, onSegment, language = 'multi') {
  sessionId = sid
  segmentBuffer = []
  onSegmentCallback = onSegment
  lastInterim = null

  dgSocket = new WebSocket(buildDeepgramUrl(language), {
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
    }
  })

  dgSocket.on('open', () => {
    console.log('[Deepgram] Connected')
    chunkCount = 0
    // Log chunk count every 10 seconds
    chunkLogInterval = setInterval(() => {
      console.log(`[Deepgram] chunks sent in last 10s: ${chunkCount}`)
      chunkCount = 0
    }, 10000)
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

      if (msg.type !== 'Results') {
        if (msg.type === 'Error') console.error('[Deepgram] Error:', JSON.stringify(msg))
        return
      }

      const alt = msg.channel?.alternatives?.[0]
      const transcript = alt?.transcript?.trim() || ''

      if (!msg.is_final) {
        // Track latest interim so we can fall back to it if final arrives empty
        if (transcript) lastInterim = { alt, msg }
        return
      }

      // is_final: true — use final transcript if available, else fall back to last interim
      const useAlt = transcript ? alt : lastInterim?.alt
      const useMsg = transcript ? msg : lastInterim?.msg
      lastInterim = null

      if (!useAlt || !useAlt.transcript?.trim()) return

      const words = useAlt.words || []
      const speaker = words[0]?.speaker !== undefined
        ? `Speaker ${words[0].speaker + 1}`
        : 'Speaker'

      const segment = {
        text: useAlt.transcript.trim(),
        speaker,
        start: useMsg.start ? Math.round(useMsg.start * 1000) : null,
        end: useMsg.start && useMsg.duration
          ? Math.round((useMsg.start + useMsg.duration) * 1000)
          : null,
        language: useMsg.channel?.detected_language || 'tr',
        confidence: useAlt.confidence || 1,
      }

      segmentBuffer.push(segment)
      if (onSegmentCallback) onSegmentCallback([segment])
      console.log(`[Deepgram] ${speaker}: ${segment.text.slice(0, 60)}`)
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
    const buf = Buffer.from(arrayBuffer)
    dgSocket.send(buf)
    chunkCount++

    // Every 500 chunks, log max amplitude to check if audio has content
    if (chunkCount % 500 === 0) {
      const samples = new Int16Array(arrayBuffer)
      let maxAmp = 0
      for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i])
        if (abs > maxAmp) maxAmp = abs
      }
      console.log(`[Deepgram] chunk ${chunkCount}: maxAmplitude=${maxAmp} (0=silence, 32767=max)`)
    }
  }
}

function stopStreaming() {
  clearInterval(keepAliveInterval)
  clearInterval(chunkLogInterval)

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
