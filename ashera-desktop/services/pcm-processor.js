// AudioWorklet processor — runs in dedicated audio thread
// Receives Float32 audio samples, converts to Int16 PCM, posts to main thread
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channelData = input[0]
    if (!channelData || channelData.length === 0) return true

    const pcm16 = new Int16Array(channelData.length)
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]))
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    // Transfer the buffer (zero-copy) to the main thread
    this.port.postMessage(pcm16.buffer, [pcm16.buffer])
    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
