#!/bin/bash
# NanoClaw Briefing Generator
# This script is called by the agent in the container.

BRIEFING_DATE=$(date +%Y-%m-%d)
REPORTS_DIR="/workspace/group/daily_reports"
mkdir -p "$REPORTS_DIR"

RAW_FILE="$REPORTS_DIR/raw_briefing_$BRIEFING_DATE.txt"
PROMPT_FILE="/workspace/project/scripts/briefing-prompt.txt"
FETCH_SCRIPT="/workspace/project/scripts/fetch-news.js"

echo "Step 1: Fetching relative news..."
node "$FETCH_SCRIPT" > "$RAW_FILE" 2>&1

if [ $? -ne 0 ]; then
  echo "Error: News fetching failed."
  exit 1
fi

echo "Step 2: Raw news fetched to $RAW_FILE."
cat "$RAW_FILE"
echo "--- END RAW NEWS ---"
echo "### CRITICAL: FOLLOW THESE INSTRUCTIONS FROM $PROMPT_FILE EXACTLY ###"
cat "$PROMPT_FILE"
