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

const MEETING_REPORT_SYSTEM_PROMPT = `Sen deneyimli bir satış analisti ve koçusun. Aşağıdaki satış görüşmesi transkriptinden profesyonel bir toplantı sonrası rapor üret.

Raporda şunlar olsun:
1. Şirket adını transkriptten çıkar
2. Özet: ne konuşuldu, nereye varıldı (3-4 cümle, yöneticiye iletebilecek kalitede)
3. Aksiyon maddeleri: kimin ne yapacağı, tarihi varsa tarihi (maksimum 5 madde)
4. Satış sinyalleri: pozitif, negatif, dikkat edilmesi gerekenler
5. Deal skoru ve gerekçesi
6. Önerilen sonraki adım: satışçının hemen yapması gereken 1 şey

Kurallar:
- Transkriptte geçmeyen şeyleri uydurma
- Aksiyon maddelerini kimin aldığını belirt (satışçı mı, müşteri mi)
- Rakip ismi geçtiyse sinyaller bölümünde mutlaka belirt
- Konuşma dili Türkçe ise Türkçe, İngilizce ise İngilizce yanıt ver
- SADECE JSON çıktısı ver

Çıktı formatı:
{
  "company": "şirket adı veya 'Bilinmiyor'",
  "summary": "özet metni",
  "actions": [{"owner": "Satışçı|Müşteri", "text": "aksiyon", "deadline": "tarih veya null"}],
  "signals": [{"type": "positive|negative|neutral", "text": "sinyal açıklaması"}],
  "dealScore": 0-100,
  "dealScoreReason": "tek cümle gerekçe",
  "nextStep": "satışçının hemen yapması gereken 1 şey"
}`

async function generateMeetingReport(transcriptText) {
  if (!transcriptText || !transcriptText.trim()) {
    return {
      company: 'Bilinmiyor',
      summary: 'Transkript bulunamadı.',
      actions: [],
      signals: [],
      dealScore: 50,
      dealScoreReason: 'Transkript yok.',
      nextStep: 'Toplantı transkriptini yükleyin.',
    }
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: MEETING_REPORT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return {
      company: 'Bilinmiyor',
      summary: text.slice(0, 500),
      actions: [],
      signals: [],
      dealScore: 50,
      dealScoreReason: 'JSON parse hatası.',
      nextStep: 'Raporu manuel kontrol edin.',
    }
  }
}

module.exports = { generatePostMeetingReport, generatePreMeetingReport, generateMeetingReport }
