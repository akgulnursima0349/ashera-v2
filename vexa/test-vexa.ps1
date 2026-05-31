# Vexa Lite Test Script (PowerShell)
# Railway deploy olduktan sonra bu script ile test et

# RAILWAY URL'ini buraya yaz
$RAILWAY_URL = "https://YOUR-RAILWAY-URL.railway.app"

# Admin API Token (Railway environment variables'da ne yazdıysan)
$ADMIN_TOKEN = "super-secret-token-buraya-random-yaz-123456"

Write-Host "🚀 Vexa Lite Test Script" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Health Check
Write-Host "Test 1: Health Check" -ForegroundColor Yellow
try {
    $healthResponse = Invoke-RestMethod -Uri "$RAILWAY_URL/health" -Method Get
    Write-Host "Response: $($healthResponse | ConvertTo-Json)" -ForegroundColor Gray

    if ($healthResponse.status -eq "ok") {
        Write-Host "✅ Health check PASSED" -ForegroundColor Green
    } else {
        Write-Host "❌ Health check FAILED" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Health check FAILED: $_" -ForegroundColor Red
    Write-Host "Railway URL doğru mu? Logs kontrol et." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Test 2: Create Admin User
Write-Host "Test 2: Create Admin User" -ForegroundColor Yellow

$headers = @{
    "Authorization" = "Bearer $ADMIN_TOKEN"
    "Content-Type" = "application/json"
}

$body = @{
    email = "test@example.com"
    name = "Test User"
} | ConvertTo-Json

try {
    $userResponse = Invoke-RestMethod -Uri "$RAILWAY_URL/admin/users" -Method Post -Headers $headers -Body $body
    Write-Host "Response: $($userResponse | ConvertTo-Json)" -ForegroundColor Gray

    $USER_TOKEN = $userResponse.apiToken

    if ($USER_TOKEN) {
        Write-Host "✅ User created successfully" -ForegroundColor Green
        Write-Host "User API Token: $USER_TOKEN" -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠️  Bu token'ı kaydet! Sonraki testlerde kullanılacak." -ForegroundColor Yellow
    } else {
        Write-Host "❌ User creation FAILED" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ User creation FAILED: $_" -ForegroundColor Red
    Write-Host "Admin token doğru mu kontrol et: $ADMIN_TOKEN" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Basic tests PASSED!" -ForegroundColor Green
Write-Host ""
Write-Host "🎯 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Google Meet oluştur: https://meet.google.com/new" -ForegroundColor White
Write-Host "2. Meeting code'u kopyala (örn: abc-defg-hij)" -ForegroundColor White
Write-Host "3. Bot başlat:" -ForegroundColor White
Write-Host ""
Write-Host "curl -X POST $RAILWAY_URL/bots ``" -ForegroundColor Gray
Write-Host "  -H 'X-API-Key: $USER_TOKEN' ``" -ForegroundColor Gray
Write-Host "  -H 'Content-Type: application/json' ``" -ForegroundColor Gray
Write-Host "  -d '{`"platform`":`"google_meet`",`"native_meeting_id`":`"MEETING-CODE-BURAYA`",`"language`":`"tr`"}'" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Google Meet'e git ve bot'un katılmasını bekle (10-15 saniye)" -ForegroundColor White
Write-Host "5. Konuş (1-2 dakika)" -ForegroundColor White
Write-Host "6. Transcript al:" -ForegroundColor White
Write-Host ""
Write-Host "curl $RAILWAY_URL/transcripts/google_meet/MEETING-CODE-BURAYA ``" -ForegroundColor Gray
Write-Host "  -H 'X-API-Key: $USER_TOKEN'" -ForegroundColor Gray
