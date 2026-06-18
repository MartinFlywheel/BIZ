#!/bin/bash
# Test Meta webhook POST with mock Instagram payload
# Usage:
#   Local:  bash scripts/test-webhook.sh http://localhost:3000
#   Prod:   bash scripts/test-webhook.sh https://holding-chi.vercel.app

BASE_URL="${1:-http://localhost:3000}"

echo "=== Step 1: Diagnostics ==="
echo "GET $BASE_URL/api/debug/webhook-test"
curl -s "$BASE_URL/api/debug/webhook-test" | npx -y json 2>/dev/null || curl -s "$BASE_URL/api/debug/webhook-test"
echo ""
echo ""

echo "=== Step 2: Mock Instagram message webhook ==="
echo "POST $BASE_URL/api/integrations/meta/webhook"
curl -s -X POST "$BASE_URL/api/integrations/meta/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "instagram",
    "entry": [
      {
        "id": "123456789",
        "time": 1700000000,
        "messaging": [
          {
            "sender": { "id": "987654321" },
            "recipient": { "id": "123456789" },
            "timestamp": 1700000000,
            "message": {
              "mid": "m_test_001",
              "text": "Hola, quiero info sobre el servicio"
            }
          }
        ]
      }
    ]
  }'
echo ""
echo ""

echo "=== Step 3: Verify insertion ==="
echo "GET $BASE_URL/api/debug/webhook-test"
curl -s "$BASE_URL/api/debug/webhook-test" | npx -y json 2>/dev/null || curl -s "$BASE_URL/api/debug/webhook-test"
echo ""
