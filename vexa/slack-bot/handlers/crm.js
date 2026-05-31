const config = require('../config')
const db = require('../db')

function getHubSpotAuthUrl(slackUserId, workspaceId) {
  const params = new URLSearchParams({
    client_id: config.hubspot.clientId,
    redirect_uri: config.hubspot.redirectUri,
    scope: [
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.deals.read',
      'crm.objects.deals.write',
      'crm.objects.notes.read',
      'crm.objects.notes.write',
      'crm.objects.companies.read',
      'crm.objects.companies.write',
    ].join(' '),
    state: `${slackUserId}:${workspaceId}`,
  })
  return `https://app.hubspot.com/oauth/authorize?${params}`
}

async function handleCrmInstall(request, reply) {
  const { slack_user_id, workspace_id } = request.query
  if (!slack_user_id || !workspace_id) {
    return reply.status(400).send({ error: 'slack_user_id and workspace_id required' })
  }
  return reply.redirect(getHubSpotAuthUrl(slack_user_id, workspace_id))
}

async function handleCrmCallback(request, reply) {
  const { code, state, error } = request.query

  if (error || !code || !state) {
    return reply.type('text/html').send(
      '<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff"><h2>Bağlantı başarısız.</h2></body></html>'
    )
  }

  const [slackUserId, workspaceId] = state.split(':')

  const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.hubspot.clientId,
      client_secret: config.hubspot.clientSecret,
      redirect_uri: config.hubspot.redirectUri,
      code,
    }),
  })

  const tokens = await res.json()
  if (tokens.error) {
    console.error('HubSpot OAuth error:', tokens)
    return reply.status(400).type('text/html').send('<html><body>OAuth hatası</body></html>')
  }

  // Get portal info
  const infoRes = await fetch('https://api.hubapi.com/account-info/v3/details', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = await infoRes.json()

  await db.saveCrmInstallation({
    slackUserId,
    workspaceId,
    hubId: String(info.portalId),
    hubDomain: info.uiDomain,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null,
  })

  return reply.type('text/html').send(`
    <html>
    <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff">
      <h2>✅ HubSpot bağlandı!</h2>
      <p>${info.uiDomain || 'HubSpot'} hesabı başarıyla bağlandı.</p>
      <p style="color:#5DCAA5">Bu pencereyi kapatabilirsiniz.</p>
    </body>
    </html>
  `)
}

async function handleCrmStatus(request, reply) {
  const { slack_user_id } = request.query
  if (!slack_user_id) return reply.status(400).send({ error: 'slack_user_id required' })

  const installation = await db.getCrmInstallation(slack_user_id)
  return {
    connected: !!installation,
    domain: installation?.hub_domain || null,
  }
}

module.exports = { handleCrmInstall, handleCrmCallback, handleCrmStatus }
