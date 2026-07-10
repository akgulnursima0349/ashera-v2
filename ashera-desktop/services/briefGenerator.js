const BRIEF_URL = process.env.BRIEF_URL || 'https://api.ashera.net/brief/generate'

let lastCallTime = 0
const MIN_GAP_MS = 20000

async function generateBrief(segments) {
  const now = Date.now()
  if (now - lastCallTime < MIN_GAP_MS) return null
  lastCallTime = now

  const text = segments.map(s => s.text).join('\n')
  if (!text.trim()) return null

  try {
    const response = await fetch(BRIEF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!response.ok) {
      console.error('Brief API error:', response.status)
      return null
    }

    return await response.json()
  } catch (err) {
    console.error('Brief generation error:', err.message)
    return null
  }
}

function reset() {
  lastCallTime = 0
}

module.exports = { generateBrief, reset }
