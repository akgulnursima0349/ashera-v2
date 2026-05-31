const Anthropic = require('@anthropic-ai/sdk')
const config = require('../config')

const client = new Anthropic({ apiKey: config.anthropic.apiKey })

function segmentsToText(segments) {
  return segments
    .map(s => `${s.speaker || 'Konuşmacı'}: ${s.text}`)
    .join('\n')
}

async function generatePostMeetingReport(segments, meetingData = {}) {
  if (!segments || segments.length === 0) {
    return {
      company: meetingData.company || 'Bilinmiyor',
      summary: 'Transkript henüz hazır değil.',
      actions: [],
      signals: [],
      dealScore: 50,
    }
  }

  const transcriptText = segmentsToText(segments)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: `Sen Ashera'sın, bir satış zekası asistanı.
Verilen satış görüşmesi transkriptinden Türkçe bir toplantı sonrası rapor üret.

Çıktı formatı — sadece JSON, başka hiçbir şey yazma:
{
  "company": "şirket adı veya 'Bilinmiyor'",
  "summary": "2-3 cümle özet",
  "actions": [
    { "text": "aksiyon maddesi", "deadline": "tarih veya null" }
  ],
  "signals": [
    { "type": "positive|neutral|negative", "text": "sinyal açıklaması" }
  ],
  "dealScore": 0-100
}

Kurallar:
- Özet maksimum 3 cümle
- Maksimum 5 aksiyon maddesi
- Maksimum 4 sinyal
- Deal skoru: alım sinyalleri artırır, itirazlar azaltır, başlangıç 50
- Türkçe yaz
- Sadece JSON çıktısı ver, markdown veya açıklama ekleme`,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return {
      company: 'Bilinmiyor',
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
    : 'Önceki görüşme transkripti yok.'

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `Sen Ashera'sın, bir satış zekası asistanı.
Verilen önceki toplantı transkriptinden toplantı öncesi hazırlık brifingi üret.

Çıktı formatı — sadece JSON:
{
  "warnings": ["dikkat edilecek madde 1", "madde 2"],
  "preparation": ["hazırlık notu 1", "not 2"],
  "context": "1-2 cümle genel bağlam"
}

Kurallar:
- Maksimum 3 uyarı
- Maksimum 4 hazırlık notu
- Kısa ve aksiyon odaklı yaz
- Türkçe yaz
- Sadece JSON çıktısı ver`,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return {
      warnings: [],
      preparation: ['Önceki görüşme verisi analiz edilemedi.'],
      context: 'Hazırlık verisi mevcut değil.',
    }
  }
}

module.exports = { generatePostMeetingReport, generatePreMeetingReport }
