const config = require('../config')
const db = require('../db')

async function handleInstall(request, reply) {
  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: 'chat:write,im:write,users:read,commands,app_mentions:read,im:history',
    redirect_uri: config.slack.redirectUri,
  })
  return reply.redirect(`https://slack.com/oauth/v2/authorize?${params}`)
}

async function handleCallback(request, reply) {
  const { code, error } = request.query

  if (error || !code) {
    return reply.status(400).send('<html><body><h2>Bağlantı başarısız.</h2></body></html>')
  }

  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    client_secret: config.slack.clientSecret,
    code,
    redirect_uri: config.slack.redirectUri,
  })

  const res = await fetch(`https://slack.com/api/oauth.v2.access?${params}`, {
    method: 'POST',
  })
  const data = await res.json()

  if (!data.ok) {
    console.error('Slack OAuth error:', data.error)
    return reply.status(400).send('<html><body><h2>OAuth hatası: ' + data.error + '</h2></body></html>')
  }

  await db.saveInstallation({
    workspaceId: data.team.id,
    workspaceName: data.team.name,
    userId: data.authed_user.id,
    botToken: data.access_token,
  })

  return reply.type('text/html').send(`
    <html>
    <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e0e11;color:#fff;">
      <h2>✅ Ashera Slack'e bağlandı!</h2>
      <p>${data.team.name} workspace'ine başarıyla kuruldu.</p>
      <p style="color:#5DCAA5">Bu pencereyi kapatabilirsiniz.</p>
    </body>
    </html>
  `)
}

async function handleStatus(request, reply) {
  const { workspace_id, user_id } = request.query
  if (!workspace_id || !user_id) {
    return reply.status(400).send({ error: 'workspace_id and user_id required' })
  }

  const installation = await db.getInstallation(workspace_id, user_id)
  return {
    connected: !!installation,
    workspace: installation?.workspace_name || null,
  }
}

module.exports = { handleInstall, handleCallback, handleStatus }
