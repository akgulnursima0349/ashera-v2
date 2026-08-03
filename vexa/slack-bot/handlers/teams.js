const { BotFrameworkAdapter, ActivityTypes } = require('botbuilder')
const db = require('../db')
const { generatePostMeetingReport, generatePreMeetingReport } = require('../services/reportGenerator')
const { executeCrmCommand } = require('../services/crmExecutor')
const config = require('../config')

const adapter = new BotFrameworkAdapter({
  appId: config.teams.appId,
  appPassword: config.teams.appPassword,
})

adapter.onTurnError = async (context, error) => {
  console.error('Teams bot error:', error)
  await context.sendActivity('Something went wrong. Please try again.')
}

async function handleTeamsMessage(req, reply) {
  // Fastify req/res → Node http req/res conversion
  await adapter.processActivity(req.raw, reply.raw, async (context) => {
    if (context.activity.type !== ActivityTypes.Message) return

    const text = (context.activity.text || '').trim().toLowerCase()
    const userId = context.activity.from.id
    const tenantId = context.activity.conversation.tenantId

    if (text.startsWith('/ashera') || text.startsWith('ashera')) {
      const command = text.replace(/^\/?(ashera\s*)/i, '').trim()
      await handleCommand(context, command, userId, tenantId)
    }
  })
}

async function handleCommand(context, command, userId, tenantId) {
  if (command === 'help' || command === '') {
    await context.sendActivity(
      '**Ashera Commands**\n\n' +
      '`ashera report` — Send last meeting report\n' +
      '`ashera brief` — Pre-meeting preparation brief\n' +
      '`ashera crm <command>` — Natural language CRM commands\n' +
      '`ashera help` — This help message'
    )
    return
  }

  if (command === 'report') {
    await context.sendActivity('Preparing report...')
    const meeting = await db.getRecentMeetingForUser(userId)
    if (!meeting) {
      await context.sendActivity('No completed meeting found. Join a meeting first.')
      return
    }
    const segments = await db.getTranscriptSegments(meeting.id)
    const report = await generatePostMeetingReport(segments)
    await context.sendActivity(formatReportForTeams(report, meeting.id))
    return
  }

  if (command === 'brief') {
    await context.sendActivity('Preparing brief...')
    const meeting = await db.getRecentMeetingForUser(userId)
    const segments = meeting ? await db.getTranscriptSegments(meeting.id) : []
    const report = await generatePreMeetingReport(segments)
    await context.sendActivity(formatBriefForTeams(report))
    return
  }

  if (command.startsWith('crm')) {
    const crmCommand = command.replace(/^crm\s*/i, '').trim()
    await context.sendActivity('Processing CRM command...')
    const result = await executeCrmCommand(userId, crmCommand, '')
    const emoji = result.success ? '✅' : '❌'
    await context.sendActivity(`${emoji} **CRM**\n${result.message}`)
    return
  }

  await context.sendActivity('Unknown command. Type `ashera help` to see all commands.')
}

function formatReportForTeams(report, meetingId) {
  const signalEmojis = { positive: '🟢', neutral: '🟡', negative: '🔴' }
  const actions = report.actions.map(a => `☐ ${a.text}${a.deadline ? ` — ${a.deadline}` : ''}`).join('\n')
  const signals = report.signals.map(s => `${signalEmojis[s.type] || '⚪'} ${s.text}`).join('\n')
  const score = report.dealScore >= 75 ? '🟢' : report.dealScore >= 50 ? '🟡' : '🔴'

  return `📋 **Meeting Report — ${report.company}**\n\n` +
    `**SUMMARY**\n${report.summary}\n\n` +
    `**ACTIONS**\n${actions || 'No action items detected'}\n\n` +
    `**SALES SIGNALS**\n${signals || 'No signals detected'}\n\n` +
    `**Deal score:** ${score} ${report.dealScore}/100`
}

function formatBriefForTeams(report) {
  const warnings = report.warnings.map(w => `⚠️ ${w}`).join('\n')
  const prep = report.preparation.map(p => `• ${p}`).join('\n')
  return `🎯 **Pre-Meeting Brief**\n\n` +
    `**WATCH OUT**\n${warnings || 'No specific warnings'}\n\n` +
    `**PREPARATION**\n${prep || 'No preparation notes'}\n\n` +
    `_${report.context}_`
}

module.exports = { handleTeamsMessage }
