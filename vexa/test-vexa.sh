#!/bin/bash

# Vexa Lite Test Script
# Railway deploy olduktan sonra bu script ile test et

# RAILWAY URL'ini buraya yaz
RAILWAY_URL="https://YOUR-RAILWAY-URL.railway.app"

# Admin API Token (Railway environment variables'da ne yazdıysan)
ADMIN_TOKEN="super-secret-token-buraya-random-yaz-123456"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Vexa Lite Test Script"
echo "========================"
echo ""

# Test 1: Health Check
echo -e "${YELLOW}Test 1: Health Check${NC}"
HEALTH_RESPONSE=$(curl -s "$RAILWAY_URL/health")
echo "Response: $HEALTH_RESPONSE"

if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
    echo -e "${GREEN}✅ Health check PASSED${NC}"
else
    echo -e "${RED}❌ Health check FAILED${NC}"
    echo "Railway URL doğru mu? Logs kontrol et."
    exit 1
fi

echo ""

# Test 2: Create Admin User
echo -e "${YELLOW}Test 2: Create Admin User${NC}"
USER_RESPONSE=$(curl -s -X POST "$RAILWAY_URL/admin/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User"}')

echo "Response: $USER_RESPONSE"

# Extract API token (basit parsing)
USER_TOKEN=$(echo "$USER_RESPONSE" | grep -o '"apiToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$USER_TOKEN" ]; then
    echo -e "${RED}❌ User creation FAILED${NC}"
    echo "Admin token doğru mu kontrol et: $ADMIN_TOKEN"
    exit 1
else
    echo -e "${GREEN}✅ User created successfully${NC}"
    echo -e "${GREEN}User API Token: $USER_TOKEN${NC}"
    echo ""
    echo "⚠️  Bu token'ı kaydet! Sonraki testlerde kullanılacak."
fi

echo ""
echo "✅ Basic tests PASSED!"
echo ""
echo "🎯 Next Steps:"
echo "1. Google Meet oluştur: https://meet.google.com/new"
echo "2. Meeting code'u kopyala (örn: abc-defg-hij)"
echo "3. Bot başlat:"
echo ""
echo "curl -X POST $RAILWAY_URL/bots \\"
echo "  -H 'X-API-Key: $USER_TOKEN' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"platform\":\"google_meet\",\"native_meeting_id\":\"MEETING-CODE-BURAYA\",\"language\":\"tr\"}'"
echo ""
echo "4. Google Meet'e git ve bot'un katılmasını bekle (10-15 saniye)"
echo "5. Konuş (1-2 dakika)"
echo "6. Transcript al:"
echo ""
echo "curl $RAILWAY_URL/transcripts/google_meet/MEETING-CODE-BURAYA \\"
echo "  -H 'X-API-Key: $USER_TOKEN'"
