#!/bin/bash
# ==================== StreamSnatcher Auto-Deploy Script ====================
# Location on server: /opt/streamsnatcher/deploy.sh
# This script pulls latest code from GitHub and restarts the services.

set -e

APP_DIR="/home/streamsnatcher/htdocs/streamsnatcher.com"
REPO_BRANCH="main"
LOG_FILE="/var/log/streamsnatcher-deploy.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "========== DEPLOY STARTED =========="

cd "$APP_DIR"

# Pull latest changes
log "Pulling from origin/$REPO_BRANCH..."
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/$REPO_BRANCH)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "Already up to date. No deployment needed."
    exit 0
fi

git reset --hard origin/$REPO_BRANCH
log "Updated to: $(git rev-parse --short HEAD)"

# Install/update dependencies if requirements changed
if git diff --name-only "$LOCAL" "$REMOTE" | grep -q "requirements.txt"; then
    log "requirements.txt changed — installing dependencies..."
    source venv/bin/activate
    pip install -r requirements.txt --quiet
    deactivate
fi

# Restart the application
log "Restarting StreamSnatcher service..."
sudo systemctl restart streamsnatcher

# Wait and verify
sleep 3
if sudo systemctl is-active --quiet streamsnatcher; then
    log "StreamSnatcher is running."
else
    log "ERROR: StreamSnatcher failed to start!"
    sudo systemctl status streamsnatcher --no-pager | tee -a "$LOG_FILE"
    exit 1
fi

log "========== DEPLOY COMPLETE =========="
