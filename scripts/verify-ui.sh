#!/usr/bin/env bash
# Square UI browser verification — runs dev server + agent-browser in one session.
set -u
cd /home/z/my-project

pkill -f "next" 2>/dev/null || true
sleep 1

echo "=== starting dev server ==="
bun run dev > /home/z/my-project/dev.log 2>&1 &
DEV_PID=$!
echo "dev PID=$DEV_PID"

# Wait for server ready (max 40s)
ready=0
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then ready=1; echo "ready after ${i}s"; break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then echo "SERVER NOT READY"; kill $DEV_PID 2>/dev/null; exit 1; fi

mkdir -p /home/z/my-project/screenshots

echo "=== TEST 1: home desktop light (1440x900) ==="
agent-browser set viewport 1440 900 2>&1 | tail -1
agent-browser open http://127.0.0.1:3000/ 2>&1 | tail -1
sleep 4
agent-browser wait --load networkidle 2>&1 | tail -1
agent-browser get title 2>&1 | head -1
agent-browser screenshot /home/z/my-project/screenshots/01-home-desktop-light.png 2>&1 | tail -1
agent-browser errors 2>&1 | head -10
agent-browser errors --clear 2>&1 | tail -1

echo "=== TEST 2: home dark mode ==="
agent-browser set media dark 2>&1 | tail -1
sleep 1
agent-browser screenshot /home/z/my-project/screenshots/02-home-desktop-dark.png 2>&1 | tail -1
agent-browser set media light 2>&1 | tail -1

echo "=== TEST 3: home mobile (375x812) ==="
agent-browser set viewport 375 812 2>&1 | tail -1
sleep 1
agent-browser screenshot /home/z/my-project/screenshots/03-home-mobile-light.png 2>&1 | tail -1

echo "=== TEST 4: shop login ==="
agent-browser set viewport 1440 900 2>&1 | tail -1
agent-browser open http://127.0.0.1:3000/shop/login 2>&1 | tail -1
sleep 4
agent-browser wait --load networkidle 2>&1 | tail -1
agent-browser screenshot /home/z/my-project/screenshots/04-shop-login.png 2>&1 | tail -1
agent-browser snapshot -c 2>&1 | head -25

echo "=== TEST 5: shop register ==="
agent-browser open http://127.0.0.1:3000/shop/register 2>&1 | tail -1
sleep 4
agent-browser wait --load networkidle 2>&1 | tail -1
agent-browser screenshot /home/z/my-project/screenshots/05-shop-register.png 2>&1 | tail -1
agent-browser errors 2>&1 | head -10
agent-browser errors --clear 2>&1 | tail -1

echo "=== TEST 6: admin login ==="
agent-browser open http://127.0.0.1:3000/admin/login 2>&1 | tail -1
sleep 3
agent-browser screenshot /home/z/my-project/screenshots/06-admin-login.png 2>&1 | tail -1

echo "=== TEST 7: shop storefront (shops/slug) ==="
agent-browser open http://127.0.0.1:3000/shops/demo-shop 2>&1 | tail -1
sleep 4
agent-browser wait --load networkidle 2>&1 | tail -1
agent-browser screenshot /home/z/my-project/screenshots/07-shop-storefront.png 2>&1 | tail -1
agent-browser errors 2>&1 | head -10
agent-browser errors --clear 2>&1 | tail -1

echo "=== TEST 8: tablet viewport (768px) home ==="
agent-browser set viewport 768 1024 2>&1 | tail -1
agent-browser open http://127.0.0.1:3000/ 2>&1 | tail -1
sleep 3
agent-browser screenshot /home/z/my-project/screenshots/08-home-tablet.png 2>&1 | tail -1

echo "=== DONE — killing dev server ==="
kill $DEV_PID 2>/dev/null || true
pkill -f "next" 2>/dev/null || true
echo "screens saved to /home/z/my-project/screenshots/"
ls -la /home/z/my-project/screenshots/ 2>&1 | head -20
