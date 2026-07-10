require('dotenv').config()

module.exports = {
  port: parseInt(process.env.PORT || '8077'),
  assemblyAiApiKey: process.env.ASSEMBLYAI_API_KEY,
  assemblyAiRealtimeUrl: 'wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
  databaseUrl: process.env.DATABASE_URL,
  backendUrl: process.env.BACKEND_URL || 'http://3.120.15.106:8056',
}
