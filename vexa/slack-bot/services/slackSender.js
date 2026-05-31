const { WebClient } = require('@slack/web-api')

function buildPostMeetingBlocks(report, meetingId) {
  const scoreEmoji = report.dealScore >= 75 ? '🟢' : report.dealScore >= 50 ? '🟡' : '🔴'
  const signalEmojis = { positive: '🟢', neutral: '🟡', negative: '🔴' }

  const actionsText = report.actions.length > 0
    ? report.actions.map(a => `☐ ${a.text}${a.deadline ? ` — ${a.deadline}` : ''}`).join('\n')
    : 'Aksiyon maddesi tespit edilmedi.'

  const signalsText = report.signals.length > 0
    ? report.signals.map(s => `${signalEmojis[s.type] || '⚪'} ${s.text}`).join('\n')
    : 'Sinyal tespit edilmedi.'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 Toplantı Raporu — ${report.company}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*ÖZET*\n${report.summary}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*AKSİYONLAR*\n${actionsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*SATIŞ SİNYALLERİ*\n${signalsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Deal skoru:* ${scoreEmoji} ${report.dealScore}/100` }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: "CRM'e Aktar" },
          action_id: 'crm_transfer',
          value: String(meetingId),
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Transkripti Gör' },
          action_id: 'view_transcript',
          value: String(meetingId),
        },
      ]
    }
  ]
}

function buildPreMeetingBlocks(report, companyName) {
  const warningsText = report.warnings.length > 0
    ? report.warnings.map(w => `⚠️ ${w}`).join('\n')
    : 'Özel uyarı yok.'

  const prepText = report.preparation.length > 0
    ? report.preparation.map(p => `• ${p}`).join('\n')
    : 'Hazırlık notu yok.'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🎯 Toplantı Hazırlık Brifiniz — ${companyName}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*DİKKAT EDİLECEKLER*\n${warningsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*HAZIRLIK NOTLARI*\n${prepText}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `_${report.context}_` }
    },
  ]
}

function buildHelpBlocks() {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Ashera Komutları*\n\n` +
          `\`/ashera rapor\` — Son toplantının raporunu gönderir\n` +
          `\`/ashera hazırla\` — Toplantı öncesi hazırlık brifingi\n` +
          `\`/ashera yardım\` — Bu yardım mesajı\n\n` +
          `*CRM Komutları (doğal dil)*\n` +
          `\`/ashera crm bağla\` — HubSpot'a bağlan\n` +
          `\`/ashera crm <herhangi bir komut>\` — Örnekler:\n` +
          `  • \`/ashera crm TechCorp dealını bul\`\n` +
          `  • \`/ashera crm deal stage güncelle Proposal\`\n` +
          `  • \`/ashera crm not ekle "SSO sorunu konuşuldu"\`\n` +
          `  • \`/ashera crm son toplantıyı kaydet\`\n` +
          `  • \`/ashera crm contact oluştur Can Demir, TechCorp CTO\``
      }
    }
  ]
}

async function sendDM(token, slackUserId, blocks, text = 'Ashera raporu') {
  const client = new WebClient(token)

  const { channel } = await client.conversations.open({ users: slackUserId })
  await client.chat.postMessage({
    channel: channel.id,
    text,
    blocks,
  })
}

module.exports = {
  buildPostMeetingBlocks,
  buildPreMeetingBlocks,
  buildHelpBlocks,
  sendDM,
}
