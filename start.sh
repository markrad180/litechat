#!/usr/bin/env bash
# Start Litechat: installs dependencies, launches the dev server, opens the browser.
set -u
cd "$(dirname "$0")" || exit 1
URL="http://localhost:5173"

# --- Node.js check (Vite 8 needs ^20.19.0 || >=22.12.0) ---
if ! command -v node >/dev/null 2>&1; then
	echo "Node.js is not installed."
	case "$(uname)" in
	Darwin) echo "Install it with:  brew install node   (Homebrew: https://brew.sh)" ;;
	*) echo "Install Node.js 22 LTS from https://nodejs.org (or your distro's package manager)." ;;
	esac
	read -r -p "Press Enter to close this window..." _
	exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)'; then
	echo "This project needs Node.js 20.19+ or 22.12+ (you have $(node -v))."
	echo "Upgrade with:  brew upgrade node   (or https://nodejs.org)"
	read -r -p "Press Enter to close this window..." _
	exit 1
fi

# --- Already running? ---
if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then
	echo "Litechat is already running at $URL (pid $(cat server.pid))."
	echo "Close its terminal window to stop it."
	read -r -p "Press Enter to close this window..." _
	exit 0
fi
rm -f server.pid

echo "Installing dependencies (quick if you've done this before)..."
npm ci || { echo "npm install failed — see the error above."; read -r -p "Press Enter to close this window..." _; exit 1; }

echo "$$" > server.pid
DEV_PID=""
trap 'rm -f server.pid; [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null' EXIT

echo "Starting Litechat..."
npm run dev & DEV_PID=$!

ready=0
for _ in $(seq 1 120); do
	if curl -sf "$URL" >/dev/null 2>&1; then ready=1; break; fi
	sleep 0.5
done

if [ "$ready" = 1 ]; then
	echo ""
	echo "Litechat is running at $URL — opening your browser..."
	case "$(uname)" in
	Darwin) open "$URL" ;;
	*) command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" ;;
	esac
	wait "$DEV_PID"
else
	echo "The server didn't respond within 60 seconds."
	echo "If another app is using port 5173, close it and run this again."
	kill "$DEV_PID" 2>/dev/null
	exit 1
fi
