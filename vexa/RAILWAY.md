# 🚀 Railway Vexa Lite - Hızlı Başlangıç

## ✅ ŞİMDİ YAPILACAKLAR (Sırayla!)

### 1️⃣ Railway Login Tamamla
Browser açıldı mı? Railway'e login ol (GitHub veya Google ile).

### 2️⃣ Groq API Key Hazırla
Ashera backend'den al:
```bash
# Backend .env dosyasından kopyala
GROQ_API_KEY=your_groq_api_key_here
```

### 3️⃣ Railway Project Oluştur

**Option A: Web UI (Kolay - Önerilen)**
1. https://railway.app/dashboard → "New Project"
2. "Deploy from Docker Image" seç
3. Docker image: `vexaai/vexa-lite:latest`
4. Project adı: `ashera-vexa-lite`

**Option B: CLI**
```bash
cd "c:\Users\NUR SİMA\.gemini\antigravity\scratch\ashera"
railway init
# Proje adı: ashera-vexa-lite
```

### 4️⃣ PostgreSQL Ekle

**Web UI'de:**
1. Project içinde → "New Service"
2. "Database" → "PostgreSQL" seç
3. Deploy!

**CLI'de:**
```bash
railway add postgresql
```

### 5️⃣ Vexa Lite Servisi Ekle

**Web UI'de (Önerilen):**
1. "New Service" → "Docker Image"
2. Image: `vexaai/vexa-lite:latest`
3. Service adı: `vexa-lite`

### 6️⃣ Environment Variables Ayarla

Railway dashboard → Vexa Lite service → Variables:

```env
# Database (PostgreSQL service'den otomatik gelecek reference ile)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Admin Token (Kendin belirle, güçlü bir token)
ADMIN_API_TOKEN=super-secret-token-buraya-random-yaz-123456

# Groq API (Ashera backend'den kopyala)
GROQ_API_KEY=your_groq_api_key_here

# Transcriber URL
TRANSCRIBER_URL=https://api.groq.com/openai/v1/audio/transcriptions

# Port
PORT=8056
```

**ÖNEMLI:**
- `DATABASE_URL` için Reference kullan: `${{Postgres.DATABASE_URL}}`
- Railway otomatik PostgreSQL connection string'i inject edecek

### 7️⃣ Deploy!

Railway otomatik deploy edecek. Logs izle:
- Dashboard → Deployments → Latest → Logs

**Deployment URL'i not et:**
- Örnek: `https://ashera-vexa-lite-production.up.railway.app`

---

## 🧪 TEST ZAMANI!

### Test 1: Health Check

```bash
curl https://YOUR-RAILWAY-URL.railway.app/health
```

**Beklenen:**
```json
{"status":"ok"}
```

✅ Çalışıyorsa → Test 2'ye geç!
❌ Çalışmıyorsa → Railway logs kontrol et

### Test 2: Admin User Oluştur

```bash
curl -X POST https://YOUR-RAILWAY-URL.railway.app/admin/users \
  -H "Authorization: Bearer ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","name":"Test User"}'
```

**Not:** `ADMIN_API_TOKEN`'ı environment variables'da ne yazdıysan onu kullan!

**Beklenen Response:**
```json
{
  "userId": "...",
  "apiToken": "vexa_user_token_12345...",
  "email": "test@test.com"
}
```

**API token'ı KAYDET!** → Sonraki testlerde kullanacağız.

### Test 3: Google Meet Bot Testi

**3.1. Google Meet Oluştur:**
1. https://meet.google.com/new
2. Meeting code'u kopyala (örn: `abc-defg-hij`)

**3.2. Bot'u Başlat:**
```bash
curl -X POST https://YOUR-RAILWAY-URL.railway.app/bots \
  -H "X-API-Key: YUKARIDAKI_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "google_meet",
    "native_meeting_id": "abc-defg-hij",
    "language": "tr",
    "bot_name": "Ashera Test Bot"
  }'
```

**3.3. Google Meet'e Git:**
- Meeting'e gir
- 10-15 saniye bekle
- **"Ashera Test Bot" katılacak!** 🎉

**3.4. Konuş:**
- 1-2 dakika sesli konuş (Türkçe)
- Birkaç cümle yeterli

**3.5. Transcript Al:**
```bash
curl https://YOUR-RAILWAY-URL.railway.app/transcripts/google_meet/abc-defg-hij \
  -H "X-API-Key: YUKARIDAKI_USER_TOKEN"
```

**Beklenen:**
```json
{
  "segments": [
    {"speaker": "Speaker 1", "text": "Merhaba bu bir test", "timestamp": "00:00:05"}
  ]
}
```

✅ **Transcript geldi mi?** → BAŞARILI! 🎉

### Test 4: Bot'u Durdur

```bash
curl -X DELETE https://YOUR-RAILWAY-URL.railway.app/bots/google_meet/abc-defg-hij \
  -H "X-API-Key: YUKARIDAKI_USER_TOKEN"
```

Bot Google Meet'ten ayrılacak.

---

## ✅ TEST BAŞARILI OLDUYSA:

**SONRAKI ADIM:** Ashera Backend Entegrasyonu

1. Vexa Admin Service oluştur
2. Google login hook'a Vexa user creation ekle
3. Meeting service'i güncelle

**Tahmini Süre:** 2-3 saat

---

## ❌ TEST BAŞARISIZ OLDUYSA:

### Problem 1: Health check 404/500

**Çözüm:**
```bash
# Railway logs kontrol et
railway logs

# Database connection hatası?
# → DATABASE_URL variable doğru mu kontrol et
```

### Problem 2: Admin API 401

**Çözüm:**
- `Authorization: Bearer TOKEN` formatı doğru mu?
- `ADMIN_API_TOKEN` environment variable doğru mu?

### Problem 3: Bot katılmıyor

**Çözüm:**
- Google Meet public mi? (Herkes katılabilir ayarı)
- Meeting code doğru mu? (xxx-xxxx-xxx format)
- 15-20 saniye bekle (bot join süresi)

### Problem 4: Transcript boş

**Çözüm:**
- Groq API key doğru mu?
- Groq API limit aşıldı mı? (Dashboard kontrol)
- Sesli konuştun mu? (30+ saniye)
- Railway logs kontrol et (transcription errors)

---

## 💰 Railway Maliyet

**Free Trial:**
- $5 credit (yeni hesap)
- Test için yeterli

**Sonrası:**
- Hobby: $5/mo
- Pro: $20/mo (production için)

**Test bittikten sonra:**
- Production sunucuya taşı
- Railway'i sil (cost save)

---

## 📞 Yardım

Takıldın mı? Bana sor!
