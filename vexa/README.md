# Vexa Lite Deployment Guide

## 🚀 Quick Start - Railway Deployment

### Prerequisites
- Railway account (https://railway.app)
- Groq API key (zaten Ashera backend'de var)

### Step 1: Railway CLI Setup

```bash
# Railway CLI kur (Windows - PowerShell)
npm install -g @railway/cli

# Railway'e login
railway login

# Browser açılacak, login ol
```

### Step 2: Railway Project Oluştur

```bash
# Yeni Railway project
railway init

# Project adı: ashera-vexa-lite
```

### Step 3: PostgreSQL Ekle

```bash
# Railway dashboard'da veya CLI ile
railway add postgresql

# Otomatik DATABASE_URL environment variable oluşacak
```

### Step 4: Environment Variables Ayarla

Railway dashboard'da (https://railway.app/dashboard):

1. Project seç
2. Variables sekmesine git
3. Şunları ekle:

```
ADMIN_API_TOKEN=super-secret-admin-token-buraya-yaz
GROQ_API_KEY=your_groq_api_key_here
TRANSCRIBER_URL=https://api.groq.com/openai/v1/audio/transcriptions
PORT=8056
```

### Step 5: Deploy!

```bash
# Railway'e deploy et
railway up

# Deploy logs izle
railway logs
```

**Railway URL:** `https://ashera-vexa-lite-production.up.railway.app`

---

## 🧪 Manual Test (Railway'de)

### Test 1: Health Check

```bash
curl https://ashera-vexa-lite-production.up.railway.app/health
```

**Beklenen Response:**
```json
{"status": "ok", "database": "connected"}
```

### Test 2: Admin User Oluştur

```bash
curl -X POST https://ashera-vexa-lite-production.up.railway.app/admin/users \
  -H "Authorization: Bearer super-secret-admin-token-buraya-yaz" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User"
  }'
```

**Beklenen Response:**
```json
{
  "userId": "uuid-here",
  "apiToken": "user-api-token-here",
  "email": "test@example.com",
  "name": "Test User"
}
```

**API token'ı kaydet!** (Ashera DB'ye kaydedilecek)

### Test 3: Bot Başlat (Gerçek Google Meet)

Google Meet meeting oluştur: https://meet.google.com/new
Meeting code'u al (örn: `abc-defg-hij`)

```bash
curl -X POST https://ashera-vexa-lite-production.up.railway.app/bots \
  -H "X-API-Key: user-api-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "google_meet",
    "native_meeting_id": "abc-defg-hij",
    "language": "tr",
    "bot_name": "Ashera Bot"
  }'
```

**Beklenen Response:**
```json
{
  "botId": "uuid",
  "meetingId": "abc-defg-hij",
  "platform": "google_meet",
  "status": "joining"
}
```

**Google Meet'e git ve bot'un katılmasını bekle** (10-15 saniye)

### Test 4: Transcript Al

Toplantıda 2-3 dakika konuş, sonra:

```bash
curl https://ashera-vexa-lite-production.up.railway.app/transcripts/google_meet/abc-defg-hij \
  -H "X-API-Key: user-api-token-here"
```

**Beklenen Response:**
```json
{
  "meetingId": "abc-defg-hij",
  "platform": "google_meet",
  "segments": [
    {
      "speaker": "Speaker 1",
      "text": "Merhaba, bu bir test",
      "timestamp": "00:00:12"
    }
  ]
}
```

### Test 5: Bot'u Durdur

```bash
curl -X DELETE https://ashera-vexa-lite-production.up.railway.app/bots/google_meet/abc-defg-hij \
  -H "X-API-Key: user-api-token-here"
```

---

## 🖥️ Local Test (Docker Compose)

Railway'den önce local'de test etmek istersen:

```bash
# .env.vexa dosyasını .env olarak kopyala
cp .env.vexa .env

# Groq API key'i güncelle (.env dosyasında)
# GROQ_API_KEY=your_groq_api_key_here

# Docker Compose ile başlat
docker-compose -f docker-compose.vexa.yml up -d

# Logs izle
docker-compose -f docker-compose.vexa.yml logs -f

# Test et
curl http://localhost:8056/health
```

**Durdur:**
```bash
docker-compose -f docker-compose.vexa.yml down
```

---

## 🔧 Troubleshooting

### Problem: Railway deploy başarısız

**Çözüm:**
```bash
# Railway logs kontrol et
railway logs

# Common issue: DATABASE_URL missing
# Railway dashboard'da PostgreSQL eklendi mi kontrol et
```

### Problem: Admin API 401 Unauthorized

**Çözüm:**
- `ADMIN_API_TOKEN` environment variable doğru mu?
- Authorization header doğru mu? `Bearer TOKEN` formatında olmalı

### Problem: Bot toplantıya katılamıyor

**Çözüm:**
- Google Meet link public mi? (Güvenlik ayarları)
- Meeting code doğru mu? (xxx-xxxx-xxx formatı)
- Bot 10-15 saniye sonra katılıyor, bekle

### Problem: Transcript boş geliyor

**Çözüm:**
- Groq API key doğru mu?
- Toplantıda sesli konuşma var mı?
- En az 30 saniye konuş, sonra transcript iste

---

## 📊 Railway Monitoring

Railway dashboard'da:
- **Metrics:** CPU, RAM, Network usage
- **Logs:** Real-time logs
- **Variables:** Environment variables
- **Deployments:** Deployment history

---

## 💰 Railway Costs

**Free Trial:**
- $5 credit (yeni hesap)
- 512MB RAM
- ~500 hours/mo

**Hobby Plan:**
- $5/mo
- 512MB RAM
- Unlimited hours

**Test için:** Free trial yeterli (1-2 hafta)

---

## 🚀 Production'a Taşıma (Sonra)

Railway test başarılı olursa:

1. **Sunucu al** (4GB RAM, İzmir DC)
2. **docker-compose.vexa.yml kopyala**
3. **Deploy** (aynı komutlar)
4. **Nginx + SSL** kur
5. **Domain** ayarla

Detaylar sonra!

---

## ❓ Yardım

Sorun olursa:
- Railway logs kontrol et
- Vexa GitHub issues: https://github.com/Vexa-ai/vexa/issues
- Bana sor!
