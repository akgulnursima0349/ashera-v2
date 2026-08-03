const db = require('../db')
const { transcribeAudio } = require('../services/deepgramClient')
const { generateLiveBrief } = require('../services/briefGenerator')
const { generateMeetingReport } = require('../services/reportGenerator')

function segmentsToText(segments) {
  return segments.map(s => `${s.speaker || 'Speaker'}: ${s.text}`).join('\n')
}

async function handleTranscribe(request, reply) {
  const { audio, encoding, sample_rate, language } = request.body || {}
  if (!audio) {
    return reply.status(400).send({ error: 'audio (base64) required' })
  }

  try {
    const result = await transcribeAudio({
      audioBase64: audio,
      encoding,
      sampleRate: sample_rate,
      language,
    })
    return reply.send(result)
  } catch (err) {
    request.log.error(err)
    return reply.status(502).send({ error: 'Transcription failed' })
  }
}

async function handleBrief(request, reply) {
  const { segments, transcript } = request.body || {}
  if (!segments && !transcript) {
    return reply.status(400).send({ error: 'segments or transcript required' })
  }

  try {
    const brief = await generateLiveBrief(segments || transcript)
    return reply.send(brief)
  } catch (err) {
    request.log.error(err)
    return reply.status(502).send({ error: 'Brief generation failed' })
  }
}

async function handleReport(request, reply) {
  const { transcript, segments, slack_user_id, workspace_id, duration_mins, platform } = request.body || {}

  const transcriptText = transcript || (segments ? segmentsToText(segments) : '')
  if (!transcriptText.trim()) {
    return reply.status(400).send({ error: 'transcript or segments required' })
  }

  try {
    const report = await generateMeetingReport(transcriptText)

    const saved = await db.saveMeetingReport({
      slackUserId: slack_user_id,
      workspaceId: workspace_id,
      company: report.company,
      summary: report.summary,
      actions: report.actions,
      signals: report.signals,
      dealScore: report.dealScore,
      durationMins: duration_mins,
      platform,
    })

    return reply.send({ ...report, id: saved.id, createdAt: saved.created_at })
  } catch (err) {
    request.log.error(err)
    return reply.status(502).send({ error: 'Report generation failed' })
  }
}

async function handleListReports(request, reply) {
  const { slack_user_id } = request.query
  if (!slack_user_id) {
    return reply.status(400).send({ error: 'slack_user_id required' })
  }

  const reports = await db.getMeetingReportsByUser(slack_user_id)
  return reply.send({ reports })
}

async function handleGetReport(request, reply) {
  const { id } = request.params
  const report = await db.getMeetingReportById(id)
  if (!report) {
    return reply.status(404).send({ error: 'Report not found' })
  }
  return reply.send(report)
}

module.exports = { handleTranscribe, handleBrief, handleReport, handleListReports, handleGetReport }
