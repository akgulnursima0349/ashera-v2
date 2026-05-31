let lastCallTime = 0
const MIN_GAP_MS = 8000

async function generateBrief(segments) {
  const now = Date.now()
  if (now - lastCallTime < MIN_GAP_MS) return null
  lastCallTime = now

  const transcriptText = segments.map(s => `${s.speaker}: ${s.text}`).join('\n')

  const systemPrompt = `You are Ashera, a real-time sales assistant. Analyze the transcript excerpt and generate sales coaching briefs in Turkish.

Output ONLY valid JSON with this exact structure:
{
  "alerts": [{"type": "price|tech|hot|neutral", "text": "short alert text"}],
  "briefs": [{"tag": "aksiyon|dikkat|bilgi", "text": "brief text, max 2 lines, HTML bold tags allowed"}],
  "dealScore": 0-100
}

Rules:
- Max 2 alerts, max 3 briefs
- Each brief max 15 words
- Be direct, no hedging words
- If price objection detected: always include an "aksiyon" brief with a concrete response
- If competitor mentioned: note it in "dikkat"
- Deal score: start at 50, increase for buying signals, decrease for objections
- Output only JSON, no other text`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcriptText }],
      })
    })

    const data = await response.json()
    const text = data.content[0].text.trim()
    return JSON.parse(text)
  } catch (err) {
    console.error('Brief generation error:', err)
    return null
  }
}

module.exports = { generateBrief }
