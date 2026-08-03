const Anthropic = require('@anthropic-ai/sdk')
const config = require('../config')

const client = new Anthropic({ apiKey: config.anthropic.apiKey })

const LIVE_BRIEF_SYSTEM_PROMPT = `Sen deneyimli bir satış koçusun. Aşağıdaki satış görüşmesi transkriptini analiz et ve satışçıya anlık koçluk yap.

Kurallar:
- Maksimum 2 uyarı (alerts), maksimum 3 brif maddesi
- Her madde maksimum 15 kelime
- Direkt ve aksiyon odaklı ol — "belki", "sanki" gibi kelimeler kullanma
- Fiyat itirazı varsa her zaman somut bir çözüm öner
- Rakip ismi geçtiyse mutlaka "dikkat" etiketi koy
- Deal skoru: alım sinyalleri artırır (fiyat sordu, referans istedi, takvim açtı), itirazlar azaltır
- Konuşma dili Türkçe ise Türkçe, İngilizce ise İngilizce yanıt ver
- SADECE JSON çıktısı ver

Çıktı formatı:
{
  "alerts": [{"type": "price|tech|hot|neutral", "text": "kısa uyarı"}],
  "briefs": [{"tag": "action|watch|info", "text": "aksiyon maddesi"}],
  "dealScore": 0-100
}`

function segmentsToText(segments) {
  return segments.map(s => `${s.speaker || 'Speaker'}: ${s.text}`).join('\n')
}

async function generateLiveBrief(input) {
  const transcriptText = Array.isArray(input) ? segmentsToText(input) : String(input || '')

  if (!transcriptText.trim()) {
    return { alerts: [], briefs: [], dealScore: 50 }
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: LIVE_BRIEF_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    return { alerts: [], briefs: [], dealScore: 50 }
  }
}

module.exports = { generateLiveBrief }
