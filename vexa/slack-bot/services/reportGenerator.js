const Anthropic = require('@anthropic-ai/sdk')
const config = require('../config')

const client = new Anthropic({ apiKey: config.anthropic.apiKey })

function segmentsToText(segments) {
  return segments
    .map(s => `${s.speaker || 'Speaker'}: ${s.text}`)
    .join('\n')
}

async function generatePostMeetingReport(segments, meetingData = {}) {
  if (!segments || segments.length === 0) {
    return {
      company: meetingData.company || 'Unknown',
      summary: 'Transcript not ready yet.',
      actions: [],
      signals: [],
      dealScore: 50,
    }
  }

  const transcriptText = segmentsToText(segments)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: `You are Ashera, a sales intelligence assistant.
Generate a post-meeting report from the given sales call transcript.

Output format — JSON only, nothing else:
{
  "company": "company name or 'Unknown'",
  "summary": "2-3 sentence summary",
  "actions": [
    { "text": "action item", "deadline": "date or null" }
  ],
  "signals": [
    { "type": "positive|neutral|negative", "text": "signal description" }
  ],
  "dealScore": 0-100
}

Rules:
- Summary maximum 3 sentences
- Maximum 5 action items
- Maximum 4 signals
- Deal score: buying signals increase it, objections decrease it, start at 50
- Write in English
- Output only JSON, no markdown or explanation`,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return {
      company: 'Unknown',
      summary: text.slice(0, 200),
      actions: [],
      signals: [],
      dealScore: 50,
    }
  }
}

async function generatePreMeetingReport(previousSegments, context = {}) {
  const transcriptText = previousSegments.length > 0
    ? segmentsToText(previousSegments)
    : 'No previous meeting transcript available.'

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are Ashera, a sales intelligence assistant.
Generate a pre-meeting preparation brief from the given previous meeting transcript.

Output format — JSON only:
{
  "warnings": ["watch out item 1", "item 2"],
  "preparation": ["preparation note 1", "note 2"],
  "context": "1-2 sentence general context"
}

Rules:
- Maximum 3 warnings
- Maximum 4 preparation notes
- Keep it short and action-oriented
- Write in English
- Output only JSON`,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return {
      warnings: [],
      preparation: ['Previous meeting data could not be analyzed.'],
      context: 'No preparation data available.',
    }
  }
}

module.exports = { generatePostMeetingReport, generatePreMeetingReport }
