const { WebClient } = require('@slack/web-api')

function buildPostMeetingBlocks(report, meetingId) {
  const scoreEmoji = report.dealScore >= 75 ? '🟢' : report.dealScore >= 50 ? '🟡' : '🔴'
  const signalEmojis = { positive: '🟢', neutral: '🟡', negative: '🔴' }

  const actionsText = report.actions.length > 0
    ? report.actions.map(a => `☐ ${a.text}${a.deadline ? ` — ${a.deadline}` : ''}`).join('\n')
    : 'No action items detected.'

  const signalsText = report.signals.length > 0
    ? report.signals.map(s => `${signalEmojis[s.type] || '⚪'} ${s.text}`).join('\n')
    : 'No signals detected.'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 Meeting Report — ${report.company}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*SUMMARY*\n${report.summary}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*ACTIONS*\n${actionsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*SALES SIGNALS*\n${signalsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Deal score:* ${scoreEmoji} ${report.dealScore}/100` }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Transfer to CRM' },
          action_id: 'crm_transfer',
          value: String(meetingId),
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Transcript' },
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
    : 'No special warnings.'

  const prepText = report.preparation.length > 0
    ? report.preparation.map(p => `• ${p}`).join('\n')
    : 'No preparation notes.'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🎯 Pre-Meeting Brief — ${companyName}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*WATCH OUT*\n${warningsText}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*PREPARATION NOTES*\n${prepText}` }
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
        text: `*Ashera Commands*\n\n` +
          `\`/ashera report\` — Send last meeting report\n` +
          `\`/ashera prepare\` — Pre-meeting preparation brief\n` +
          `\`/ashera help\` — This help message\n\n` +
          `*CRM Commands (natural language)*\n` +
          `\`/ashera crm connect\` — Connect to HubSpot\n` +
          `\`/ashera crm <any command>\` — Examples:\n` +
          `  • \`/ashera crm find TechCorp deal\`\n` +
          `  • \`/ashera crm update deal stage to Proposal\`\n` +
          `  • \`/ashera crm add note "SSO issue discussed"\`\n` +
          `  • \`/ashera crm save last meeting\`\n` +
          `  • \`/ashera crm create contact John Smith, TechCorp CTO\``
      }
    }
  ]
}

async function sendDM(token, slackUserId, blocks, text = 'Ashera report') {
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
