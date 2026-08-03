const config = require('../config')

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen'

async function transcribeAudio({ audioBase64, encoding = 'linear16', sampleRate = 16000, language = 'multi' }) {
  if (!config.deepgram.apiKey) {
    throw new Error('DEEPGRAM_API_KEY not configured')
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64')

  const params = new URLSearchParams({
    model: 'nova-2',
    language,
    punctuate: 'true',
    smart_format: 'true',
    diarize: 'true',
  })

  let contentType
  if (encoding === 'linear16') {
    params.set('encoding', 'linear16')
    params.set('sample_rate', String(sampleRate))
    contentType = 'audio/raw'
  } else {
    contentType = encoding
  }

  const response = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.deepgram.apiKey}`,
      'Content-Type': contentType,
    },
    body: audioBuffer,
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Deepgram error ${response.status}: ${errText}`)
  }

  const data = await response.json()
  const channel = data.results?.channels?.[0]
  const alternative = channel?.alternatives?.[0]

  return {
    transcript: alternative?.transcript || '',
    confidence: alternative?.confidence ?? null,
    words: alternative?.words || [],
  }
}

module.exports = { transcribeAudio }
