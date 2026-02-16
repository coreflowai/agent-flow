#!/bin/bash
# AgentFlow - Open Code Pipe Adapter
# Wraps `opencode run --format json`, reads JSONL line-by-line, POSTs each event
# while passing through stdout for normal consumption.
#
# Usage: ./opencode-pipe.sh "your prompt here"
# Requires: opencode CLI, jq, curl

AGENT_FLOW_URL="${AGENT_FLOW_URL:-http://localhost:3333}"
AGENT_FLOW_API_KEY="${AGENT_FLOW_API_KEY:-}"
SESSION_ID="${SESSION_ID:-opencode-$(date +%s)-$$}"

if [ -z "$1" ]; then
  echo "Usage: $0 <prompt>" >&2
  exit 1
fi

# Gather git repo info
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || true)
GIT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || true)
GIT_REMOTE=$(git remote get-url origin 2>/dev/null || true)
GIT_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || true)
GIT_WORKDIR=""
[ -n "$GIT_TOPLEVEL" ] && GIT_WORKDIR=$(basename "$GIT_TOPLEVEL")
GIT_REPO_NAME=""
[ -n "$GIT_REMOTE" ] && GIT_REPO_NAME=$(echo "$GIT_REMOTE" | sed -E 's#(\.git)$##' | sed -E 's#^.+[:/]([^/]+/[^/]+)$#\1#')
[ -n "$GIT_REMOTE" ] && GIT_REMOTE=$(echo "$GIT_REMOTE" | sed -E 's#https://[^@]+@#https://#')

GIT_OBJ=$(jq -n \
  --arg commit "$GIT_COMMIT" --arg branch "$GIT_BRANCH" \
  --arg remote "$GIT_REMOTE" --arg repoName "$GIT_REPO_NAME" \
  --arg workDir "$GIT_WORKDIR" \
  '{} +
   (if $commit   != "" then {commit: $commit}     else {} end) +
   (if $branch   != "" then {branch: $branch}     else {} end) +
   (if $remote   != "" then {remote: $remote}     else {} end) +
   (if $repoName != "" then {repoName: $repoName} else {} end) +
   (if $workDir  != "" then {workDir: $workDir}   else {} end)')

opencode run --format json "$@" | while IFS= read -r line; do
  # Pass through to stdout
  echo "$line"

  # POST to AgentFlow in background
  curl -s -X POST "$AGENT_FLOW_URL/api/ingest" \
    -H "Content-Type: application/json" \
    ${AGENT_FLOW_API_KEY:+-H "x-api-key: $AGENT_FLOW_API_KEY"} \
    -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$line" --argjson g "$GIT_OBJ" \
      '{source:"opencode",sessionId:$s,event:$e,git:$g}')" &
done

wait
