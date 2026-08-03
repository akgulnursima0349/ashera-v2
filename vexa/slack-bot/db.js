const { Pool } = require('pg')
const config = require('./config')

const pool = new Pool({ connectionString: config.database.url })

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slack_installations (
      id              SERIAL PRIMARY KEY,
      workspace_id    VARCHAR(50) NOT NULL,
      workspace_name  VARCHAR(255),
      user_id         VARCHAR(50) NOT NULL,
      bot_token       VARCHAR(255) NOT NULL,
      ashera_user_id  INTEGER,
      installed_at    TIMESTAMP DEFAULT NOW(),
      is_active       BOOLEAN DEFAULT TRUE,
      UNIQUE(workspace_id, user_id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_slack_links (
      id              SERIAL PRIMARY KEY,
      meeting_id      INTEGER,
      slack_user_id   VARCHAR(50) NOT NULL,
      workspace_id    VARCHAR(50) NOT NULL,
      notified        BOOLEAN DEFAULT FALSE,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_installations (
      id                SERIAL PRIMARY KEY,
      ashera_user_id    INTEGER,
      slack_user_id     VARCHAR(50) NOT NULL UNIQUE,
      workspace_id      VARCHAR(50) NOT NULL,
      google_email      VARCHAR(255),
      access_token      TEXT NOT NULL,
      refresh_token     TEXT,
      token_expiry      TIMESTAMP,
      installed_at      TIMESTAMP DEFAULT NOW(),
      is_active         BOOLEAN DEFAULT TRUE
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_notifications (
      id                SERIAL PRIMARY KEY,
      slack_user_id     VARCHAR(50) NOT NULL,
      calendar_event_id VARCHAR(255) NOT NULL,
      notified_at       TIMESTAMP DEFAULT NOW(),
      UNIQUE(slack_user_id, calendar_event_id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_installations (
      id              SERIAL PRIMARY KEY,
      slack_user_id   VARCHAR(50) NOT NULL UNIQUE,
      workspace_id    VARCHAR(50) NOT NULL,
      hub_id          VARCHAR(50),
      hub_domain      VARCHAR(255),
      access_token    TEXT NOT NULL,
      refresh_token   TEXT,
      token_expiry    TIMESTAMP,
      installed_at    TIMESTAMP DEFAULT NOW(),
      is_active       BOOLEAN DEFAULT TRUE
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_reports (
      id              SERIAL PRIMARY KEY,
      slack_user_id   VARCHAR(50),
      workspace_id    VARCHAR(50),
      company         VARCHAR(255),
      summary         TEXT,
      actions         JSONB DEFAULT '[]',
      signals         JSONB DEFAULT '[]',
      deal_score      INTEGER DEFAULT 50,
      duration_mins   INTEGER,
      platform        VARCHAR(50) DEFAULT 'desktop_audio',
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `)
}

async function saveInstallation({ workspaceId, workspaceName, userId, botToken }) {
  await pool.query(`
    INSERT INTO slack_installations (workspace_id, workspace_name, user_id, bot_token)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET bot_token = $4, workspace_name = $2, is_active = TRUE, installed_at = NOW()
  `, [workspaceId, workspaceName, userId, botToken])
}

async function getInstallation(workspaceId, userId) {
  const res = await pool.query(
    'SELECT * FROM slack_installations WHERE workspace_id = $1 AND user_id = $2 AND is_active = TRUE',
    [workspaceId, userId]
  )
  return res.rows[0] || null
}

async function getInstallationByWorkspace(workspaceId) {
  const res = await pool.query(
    'SELECT * FROM slack_installations WHERE workspace_id = $1 AND is_active = TRUE LIMIT 1',
    [workspaceId]
  )
  return res.rows[0] || null
}

async function linkMeetingToSlack({ meetingId, slackUserId, workspaceId }) {
  await pool.query(`
    INSERT INTO meeting_slack_links (meeting_id, slack_user_id, workspace_id)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
  `, [meetingId, slackUserId, workspaceId])
}

async function getMeetingSlackLink(meetingId) {
  const res = await pool.query(
    'SELECT * FROM meeting_slack_links WHERE meeting_id = $1 AND notified = FALSE',
    [meetingId]
  )
  return res.rows[0] || null
}

async function markNotified(meetingId) {
  await pool.query(
    'UPDATE meeting_slack_links SET notified = TRUE WHERE meeting_id = $1',
    [meetingId]
  )
}

async function getTranscriptSegments(meetingId) {
  const res = await pool.query(
    `SELECT speaker, text, start_time, end_time, language
     FROM transcriptions WHERE meeting_id = $1 ORDER BY start_time`,
    [meetingId]
  )
  return res.rows
}

async function getRecentMeetingForUser(slackUserId) {
  const res = await pool.query(`
    SELECT m.id, m.platform_specific_id, m.start_time, m.end_time, m.data
    FROM meetings m
    JOIN meeting_slack_links l ON l.meeting_id = m.id
    WHERE l.slack_user_id = $1 AND m.status = 'completed'
    ORDER BY m.end_time DESC LIMIT 1
  `, [slackUserId])
  return res.rows[0] || null
}

async function saveCalendarInstallation({ slackUserId, workspaceId, googleEmail, accessToken, refreshToken, tokenExpiry }) {
  await pool.query(`
    INSERT INTO calendar_installations
      (slack_user_id, workspace_id, google_email, access_token, refresh_token, token_expiry)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (slack_user_id) DO UPDATE
    SET access_token = $4, refresh_token = $5, token_expiry = $6,
        google_email = $3, is_active = TRUE, installed_at = NOW()
  `, [slackUserId, workspaceId, googleEmail, accessToken, refreshToken, tokenExpiry])
}

async function getCalendarInstallation(slackUserId) {
  const res = await pool.query(
    'SELECT * FROM calendar_installations WHERE slack_user_id = $1 AND is_active = TRUE',
    [slackUserId]
  )
  return res.rows[0] || null
}

async function getAllCalendarInstallations() {
  const res = await pool.query(
    'SELECT * FROM calendar_installations WHERE is_active = TRUE'
  )
  return res.rows
}

async function markEventNotified(slackUserId, calendarEventId) {
  await pool.query(`
    INSERT INTO calendar_notifications (slack_user_id, calendar_event_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
  `, [slackUserId, calendarEventId])
}

async function wasEventNotified(slackUserId, calendarEventId) {
  const res = await pool.query(
    'SELECT 1 FROM calendar_notifications WHERE slack_user_id = $1 AND calendar_event_id = $2',
    [slackUserId, calendarEventId]
  )
  return res.rows.length > 0
}

async function updateCalendarTokens(slackUserId, accessToken, tokenExpiry) {
  await pool.query(
    'UPDATE calendar_installations SET access_token = $2, token_expiry = $3 WHERE slack_user_id = $1',
    [slackUserId, accessToken, tokenExpiry]
  )
}

async function saveCrmInstallation({ slackUserId, workspaceId, hubId, hubDomain, accessToken, refreshToken, tokenExpiry }) {
  await pool.query(`
    INSERT INTO crm_installations
      (slack_user_id, workspace_id, hub_id, hub_domain, access_token, refresh_token, token_expiry)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (slack_user_id) DO UPDATE
    SET access_token = $5, refresh_token = $6, token_expiry = $7,
        hub_id = $3, hub_domain = $4, is_active = TRUE, installed_at = NOW()
  `, [slackUserId, workspaceId, hubId, hubDomain, accessToken, refreshToken, tokenExpiry])
}

async function getCrmInstallation(slackUserId) {
  const res = await pool.query(
    'SELECT * FROM crm_installations WHERE slack_user_id = $1 AND is_active = TRUE',
    [slackUserId]
  )
  return res.rows[0] || null
}

async function updateCrmTokens(slackUserId, accessToken, tokenExpiry) {
  await pool.query(
    'UPDATE crm_installations SET access_token = $2, token_expiry = $3 WHERE slack_user_id = $1',
    [slackUserId, accessToken, tokenExpiry]
  )
}

async function saveMeetingReport({ slackUserId, workspaceId, company, summary, actions, signals, dealScore, durationMins, platform }) {
  const res = await pool.query(`
    INSERT INTO meeting_reports
      (slack_user_id, workspace_id, company, summary, actions, signals, deal_score, duration_mins, platform)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    slackUserId || null,
    workspaceId || null,
    company || 'Unknown',
    summary || '',
    JSON.stringify(actions || []),
    JSON.stringify(signals || []),
    typeof dealScore === 'number' ? dealScore : 50,
    durationMins || null,
    platform || 'desktop_audio',
  ])
  return res.rows[0]
}

async function getMeetingReportsByUser(slackUserId) {
  const res = await pool.query(
    'SELECT * FROM meeting_reports WHERE slack_user_id = $1 ORDER BY created_at DESC',
    [slackUserId]
  )
  return res.rows
}

async function getMeetingReportById(id) {
  const res = await pool.query('SELECT * FROM meeting_reports WHERE id = $1', [id])
  return res.rows[0] || null
}

module.exports = {
  pool,
  runMigrations,
  saveInstallation,
  getInstallation,
  getInstallationByWorkspace,
  linkMeetingToSlack,
  getMeetingSlackLink,
  markNotified,
  getTranscriptSegments,
  getRecentMeetingForUser,
  saveCalendarInstallation,
  getCalendarInstallation,
  getAllCalendarInstallations,
  markEventNotified,
  wasEventNotified,
  updateCalendarTokens,
  saveCrmInstallation,
  getCrmInstallation,
  updateCrmTokens,
  saveMeetingReport,
  getMeetingReportsByUser,
  getMeetingReportById,
}
