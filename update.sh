#!/usr/bin/env bash
# Update LiteChat: stops the running server, pulls the latest code,
# reinstalls dependencies, and starts the server again.
set -u
cd "$(dirname "$0")" || exit 1

# --- Stop the running server ---
if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then
	PID="$(cat server.pid)"
	echo "Stopping the running LiteChat server (pid $PID)..."
	kill "$PID" 2>/dev/null
	for _ in $(seq 1 10); do
		kill -0 "$PID" 2>/dev/null || break
		sleep 0.5
	done
	kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null
else
	[ -f server.pid ] && rm -f server.pid
	echo "Note: no running LiteChat server found. If one is running,"
	echo "close its terminal window first."
fi

# --- Pull latest code ---
if [ -n "$(git status --porcelain)" ]; then
	echo "There are uncommitted local changes (git status) — commit or"
	echo "discard them before updating."
	exit 1
fi
echo "Pulling the latest version..."
git pull --ff-only || { echo "git pull failed — see the error above."; exit 1; }
echo "Updating dependencies..."
npm ci
exec ./start.sh
