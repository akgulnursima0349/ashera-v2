require('dotenv').config()

module.exports = {
  slack: {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    botToken: process.env.SLACK_BOT_TOKEN,
    redirectUri: process.env.SLACK_REDIRECT_URI,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8076/calendar/oauth/callback',
  },
  hubspot: {
    clientId: process.env.HUBSPOT_CLIENT_ID,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
    redirectUri: process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:8076/crm/oauth/callback',
  },
  vexaLiteUrl: process.env.VEXA_LITE_URL || 'http://localhost:8056',
  port: parseInt(process.env.PORT || '8076'),
}
