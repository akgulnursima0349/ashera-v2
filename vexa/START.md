# 🚀 Vexa Local Test - Hızlı Başlangıç

## 📁 Vexa Klasör Yapısı

```
ashera/
├── ashera-backend/          # Ashera Backend (NestJS)
├── ashera-front-main/       # Ashera Frontend (Next.js)
└── vexa/                    # Vexa Lite (Meeting Bot)
    ├── .env                 # Environment variables ✅
    ├── docker-compose.yml   # Docker config
    ├── README.md            # Detaylı döküman
    ├── test-vexa.ps1        # Windows test script
    └── START.md             # Bu dosya!
```

---

## ⚡ HIZLI BAŞLANGIÇ (3 Komut)

### 1️⃣ Vexa Klasörüne Git
```powershell
cd "c:\Users\NUR SİMA\.gemini\antigravity\scratch\ashera\vexa"
```

### 2️⃣ Başlat
```powershell
docker-compose up -d
```

**Beklenen:**
```
✅ Creating vexa-postgres ... done
✅ Creating vexa-lite ... done
```

### 3️⃣ Logs İzle (Opsiyonel)
```powershell
docker-compose logs -f
```

**Beklenen:**
```
✅ postgres  | database system is ready
✅ vexa-lite | Database migrations complete
✅ vexa-lite | Vexa Lite listening on port 8056
```

**CTRL+C** ile çık.

---

## 🧪 TEST ET!

### Test 1: Health Check
```powershell
curl http://localhost:8056/
```

**Beklenen:**
```json
{"message":"Welcome to the Vexa API Gateway"}
```

✅ **Çalıştı!**

---

### Test 2: Admin User Oluştur
```powershell
curl -X POST http://localhost:8056/admin/users `
  -H "x-admin-api-key: ashera-vexa-admin-secret-token-2026" `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"test@test.com\",\"name\":\"Test User\"}'
```

**Beklenen Response:**
```json
{"email":"test@test.com","name":"Test User","id":1,...}
```

**User ID'yi kaydet!** (response'ta `id` field'ı)

---

### Test 3: API Token Oluştur

User oluşturduktan sonra ona API token oluştur:

```powershell
curl -X POST http://localhost:8056/admin/users/1/tokens `
  -H "x-admin-api-key: ashera-vexa-admin-secret-token-2026" `
  -H "Content-Type: application/json"
```

**Beklenen Response:**
```json
{"user_id":1,"id":1,"token":"MrpCyvXE2nKQU1Z2U5eq3Luo40MYawGOf0qLsSdF",...}
```

**Token'ı kopyala!** Bu token ile bot oluşturacaksın.

---

### Test 4: Google Meet Bot Test

1. **Google Meet oluştur:** https://meet.google.com/new
2. **Meeting code kopyala** (örn: `abc-defg-hij`)
3. **Bot başlat:**

```powershell
curl -X POST http://localhost:8056/bots `
  -H "X-API-Key: MrpCyvXE2nKQU1Z2U5eq3Luo40MYawGOf0qLsSdF" `
  -H "Content-Type: application/json" `
  -d '{\"meeting_url\":\"https://meet.google.com/abc-defg-hij\",\"platform\":\"google_meet\",\"native_meeting_id\":\"abc-defg-hij\",\"bot_name\":\"Ashera Bot\"}'
```

**Beklenen Response:**
```json
{"id":1,"status":"requested","bot_container_id":"236",...}
```

4. **Google Meet'e git** → Bot 10-15 saniye sonra katılacak!
5. **Konuş** (1-2 dakika)
6. **Transcript al:**

```powershell
curl http://localhost:8056/transcripts/google_meet/abc-defg-hij `
  -H "X-API-Key: MrpCyvXE2nKQU1Z2U5eq3Luo40MYawGOf0qLsSdF"
```

**Transcript geldi mi?** 🎉 **BAŞARILI!**

---

## 🛑 DURDUR

```powershell
docker-compose down
```

---

## 🔧 TROUBLESHOOTING

### Docker çalışmıyor?
```powershell
# Docker Desktop açık mı kontrol et
docker --version
```

### Port 8056 kullanımda?
```powershell
# Port'u değiştir (docker-compose.yml'de)
ports:
  - "8057:8056"  # 8057 kullan
```

### Logs görmek istiyorsan:
```powershell
docker-compose logs vexa-lite
docker-compose logs postgres
```

---

## ✅ BAŞARILI OLDUYSA:

**Sonraki Adım:** Ashera Backend Entegrasyonu

1. User model'e `vexaApiToken` field ekle
2. Vexa Admin Service oluştur
3. Google login hook
4. Meeting service güncelle

**Tahmini:** 2-3 saat

---

## 📞 YARDIM

Sorun mu var? Bana sor! 🚀
