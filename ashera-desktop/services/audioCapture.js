// services/audioCapture.js
// Runs in renderer process — has access to Web APIs
// Loaded via <script> tag in index.html, NOT by webpack.
//
// Captures system audio (loopback) + microphone, mixes with gain control.

let audioContext = null
let mediaStreams = []
let workletNode = null

async function startSystemAudioCapture() {
  try {
    audioContext = new AudioContext({ sampleRate: 16000 })
    if (audioContext.state === 'suspended') await audioContext.resume()

    await audioContext.audioWorklet.addModule('../services/pcm-processor.js')
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')

    workletNode.port.onmessage = (e) => {
      window.appAPI.sendAudioChunk(e.data)
    }
    workletNode.connect(audioContext.destination)

    let gotAnySource = false

    // 1. System audio via loopback — amplified 1.5x to help quiet system audio
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1 }, height: { max: 1 }, frameRate: { max: 1 } },
        audio: { echoCancellation: false, noiseSuppression: false },
      })

      const audioTracks = displayStream.getAudioTracks()
      if (audioTracks.length > 0) {
        const sysSource = audioContext.createMediaStreamSource(displayStream)
        const sysGain = audioContext.createGain()
        sysGain.gain.value = 1.0
        sysSource.connect(sysGain)
        sysGain.connect(workletNode)
        mediaStreams.push(displayStream)
        gotAnySource = true

        audioTracks[0].onended = () => {
          stopSystemAudioCapture()
          window.appAPI.onAudioEnded()
        }
      } else {
        displayStream.getTracks().forEach(t => t.stop())
      }
    } catch (e) {
      console.warn('[Audio] Loopback capture failed:', e.message)
    }

    // 2. Microphone — lower gain to reduce ambient noise interference
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 }
      })
      const micSource = audioContext.createMediaStreamSource(micStream)
      const micGain = audioContext.createGain()
      micGain.gain.value = 0.4
      micSource.connect(micGain)
      micGain.connect(workletNode)
      mediaStreams.push(micStream)
      gotAnySource = true
    } catch (e) {
      console.warn('[Audio] Microphone capture failed:', e.message)
    }

    if (!gotAnySource) throw new Error('No audio source available')

    window.appAPI.audioStarted()
    return true

  } catch (err) {
    console.error('Audio capture error:', err)
    window.appAPI.audioError(err.message || String(err))
    return false
  }
}

function stopSystemAudioCapture() {
  if (workletNode) { workletNode.disconnect(); workletNode = null }
  if (audioContext) { audioContext.close(); audioContext = null }
  mediaStreams.forEach(s => s.getTracks().forEach(t => t.stop()))
  mediaStreams = []
}

window.addEventListener('ashera:startCapture', () => startSystemAudioCapture())
window.addEventListener('ashera:stopCapture', () => stopSystemAudioCapture())
