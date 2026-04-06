#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# setup-scheduler.sh - Install/uninstall the macOS launchd daily runner
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PLIST_LABEL="com.commandgarden.daily-runner"
PLIST_SOURCE="$PROJECT_DIR/scheduler/${PLIST_LABEL}.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: $(basename "$0") <install|uninstall>

Install or uninstall the Command Garden daily runner as a macOS LaunchAgent.

Commands:
  install     Copy plist to ~/Library/LaunchAgents, set paths, and load agent
  uninstall   Unload agent and remove plist

Options:
  --help      Show this help message
EOF
  exit 0
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
if [[ $# -eq 0 ]]; then
  echo -e "${RED}Error: Missing command. Use 'install' or 'uninstall'.${NC}" >&2
  usage
fi

ACTION="$1"

case "$ACTION" in
  --help)
    usage
    ;;
  install|uninstall)
    ;;
  *)
    echo -e "${RED}Error: Unknown command '$ACTION'. Use 'install' or 'uninstall'.${NC}" >&2
    usage
    ;;
esac

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
do_install() {
  echo -e "${YELLOW}Installing Command Garden daily runner...${NC}"

  # Validate node is available
  if ! command -v node &>/dev/null; then
    echo -e "${RED}Error: node is not available in PATH.${NC}" >&2
    echo "  Install Node.js from https://nodejs.org or via nvm/brew." >&2
    exit 1
  fi

  NODE_PATH=$(command -v node)
  echo "  Node.js: $NODE_PATH ($(node --version))"

  # Check source plist exists
  if [[ ! -f "$PLIST_SOURCE" ]]; then
    echo -e "${RED}Error: Plist template not found at $PLIST_SOURCE${NC}" >&2
    exit 1
  fi

  # Check runner script exists
  if [[ ! -f "$PROJECT_DIR/runner/daily-runner.js" ]]; then
    echo -e "${YELLOW}Warning: Runner script not found at $PROJECT_DIR/runner/daily-runner.js${NC}"
    echo "  The scheduler will be installed, but it will fail to run until the script exists."
  fi

  # Ensure LaunchAgents directory exists
  mkdir -p "$HOME/Library/LaunchAgents"

  # Copy and replace placeholders
  echo "  Copying plist to $PLIST_DEST..."
  cp "$PLIST_SOURCE" "$PLIST_DEST"
  sed -i '' "s|{{PROJECT_DIR}}|${PROJECT_DIR}|g" "$PLIST_DEST"

  # Unload first if already loaded (ignore errors)
  launchctl unload "$PLIST_DEST" 2>/dev/null || true

  # Load the agent
  echo "  Loading agent..."
  launchctl load "$PLIST_DEST"

  echo ""
  echo -e "${GREEN}Daily runner installed successfully!${NC}"
  echo ""
  echo "  Label:       $PLIST_LABEL"
  echo "  Plist:       $PLIST_DEST"
  echo "  Schedule:    Daily at 9:00 AM"
  echo "  Stdout log:  $PROJECT_DIR/runner/daily-runner.stdout.log"
  echo "  Stderr log:  $PROJECT_DIR/runner/daily-runner.stderr.log"
  echo ""
  echo "  To check status:  launchctl list | grep commandgarden"
  echo "  To run manually:  launchctl start $PLIST_LABEL"
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
do_uninstall() {
  echo -e "${YELLOW}Uninstalling Command Garden daily runner...${NC}"

  if [[ ! -f "$PLIST_DEST" ]]; then
    echo -e "${YELLOW}Warning: Plist not found at $PLIST_DEST. Nothing to uninstall.${NC}"
    exit 0
  fi

  # Unload the agent
  echo "  Unloading agent..."
  launchctl unload "$PLIST_DEST" 2>/dev/null || true

  # Remove the plist
  echo "  Removing $PLIST_DEST..."
  rm -f "$PLIST_DEST"

  echo ""
  echo -e "${GREEN}Daily runner uninstalled successfully.${NC}"
}

# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------
case "$ACTION" in
  install)
    do_install
    ;;
  uninstall)
    do_uninstall
    ;;
esac
