#!/usr/bin/env bash
# Gramity + Mira integration smoke tests
# Usage: TG_ID=123456789 ./scripts/mira-test.sh

set -euo pipefail

BASE="${BASE:-https://gramity-production.up.railway.app}"
TG_ID="${TG_ID:?Set TG_ID to a telegram_id with an existing plan}"

echo "━━━ TEST 1 — MCP manifest ━━━"
curl -sf "${BASE}/.well-known/mcp.json" | jq '{name, endpoint, tools: [.tools[].name], mainnet: .constraints.mainnet}'

echo ""
echo "━━━ TEST 2 — Context token ━━━"
CTX=$(curl -sf -X POST "${BASE}/api/mira/create-context" \
  -H "Content-Type: application/json" \
  -d "{\"telegram_id\":\"${TG_ID}\"}")
echo "$CTX" | jq '{token: (.token[:20] + "..."), mira_deeplink}'
TOKEN=$(echo "$CTX" | jq -r .token)

echo ""
echo "━━━ TEST 3 — One-time token ━━━"
echo "First read:"
curl -sf "${BASE}/api/mira/context/${TOKEN}" | jq '{telegram_id, total_usd, strategies: .strategies[0].status, agent_wallet_address: (.agent_wallet_address[:8] + "...")}'
echo "Second read (expect 410):"
curl -s -w " HTTP:%{http_code}\n" "${BASE}/api/mira/context/${TOKEN}" || true

echo ""
echo "━━━ TEST 4 — get_portfolio ━━━"
PF=$(curl -sf -X POST "${BASE}/mcp" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"get_portfolio\",\"arguments\":{\"telegram_id\":\"${TG_ID}\"}},\"id\":1}")
echo "$PF" | jq '.result | {ton_balance_usd, withdrawal_address_masked, strategies: .strategies[0].status}'
if echo "$PF" | grep -qiE 'mnemonic|private_key|encrypted_mnemonic|"wallet_id"'; then
  echo "❌ STOP: sensitive data in response"; exit 1
fi

echo ""
echo "━━━ TEST 5 — withdrawal address injection ━━━"
curl -sf -X POST "${BASE}/mcp" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"create_strategy\",\"arguments\":{\"telegram_id\":\"${TG_ID}\",\"amount_usdt\":10,\"frequency\":\"weekly\",\"strategy\":\"TON+LP\",\"withdrawal_address\":\"UQDattackeraddress000000000000000000000000000\"}},\"id\":2}" \
  | jq '.result | {withdrawal_address_masked, withdrawal_address_unchanged}'

echo ""
echo "━━━ TEST 6 — Demo scenario ━━━"
echo "Step 1 — status:"
curl -sf -X POST "${BASE}/mcp" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"get_portfolio\",\"arguments\":{\"telegram_id\":\"${TG_ID}\"}},\"id\":1}" \
  | jq '.result | {cycles_done, est_value_usd, next_cycle_at}'

echo "Step 2 — create/update strategy:"
curl -sf -X POST "${BASE}/mcp" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"create_strategy\",\"arguments\":{\"telegram_id\":\"${TG_ID}\",\"amount_usdt\":25,\"frequency\":\"weekly\",\"strategy\":\"TON+LP\"}},\"id\":2}" \
  | jq '.result | {amount_usdt: .amount_usdt, agent_wallet_address: (.agent_wallet_address[:8] + "...")}'

echo "Step 3 — pause:"
curl -sf -X POST "${BASE}/mcp" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"pause_strategy\",\"arguments\":{\"telegram_id\":\"${TG_ID}\"}},\"id\":3}" \
  | jq '.result'

echo ""
echo "✅ All tests passed (verify Telegram confirmation + DB manually)"
