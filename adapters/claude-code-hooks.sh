#!/bin/bash
# AgentFlow - Claude Code Hook Adapter
# Reads hook JSON from stdin, POSTs to AgentFlow server
# Captures user identity from git config and GitHub CLI
#
# Usage: Configure in .claude/settings.json with async: true
AGENT_FLOW_URL="${AGENT_FLOW_URL:-http://localhost:3333}"
AGENT_FLOW_API_KEY="${AGENT_FLOW_API_KEY:-}"
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')

# Incremental transcript reading for real-time assistant text
# Uses a position file to track lines already processed
if [ "$HOOK_EVENT" = "PreToolUse" ] || [ "$HOOK_EVENT" = "Stop" ]; then
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    POS_FILE="/tmp/agent-flow-${SESSION_ID}.pos"
    LAST_POS=0
    [ -f "$POS_FILE" ] && LAST_POS=$(cat "$POS_FILE")
    CURRENT_POS=$(awk 'END{print NR}' "$TRANSCRIPT")

    if [ "$CURRENT_POS" -gt "$LAST_POS" ]; then
      NEW_TEXT=$(awk "NR > $LAST_POS" "$TRANSCRIPT" | while IFS= read -r line; do
        T=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
        if [ "$T" = "assistant" ]; then
          echo "$line" | jq -r '[.message.content[]? | select(.type == "text") | .text] | join("\n")' 2>/dev/null
        fi
      done | sed '/^$/d')

      if [ -n "$NEW_TEXT" ]; then
        if [ "$HOOK_EVENT" = "Stop" ]; then
          # Attach to Stop event as result
          INPUT=$(echo "$INPUT" | jq --arg msg "$NEW_TEXT" '. + {result: $msg}')
        else
          # Send as separate intermediate assistant message
          curl -s -X POST "$AGENT_FLOW_URL/api/ingest" \
            -H "Content-Type: application/json" \
            ${AGENT_FLOW_API_KEY:+-H "x-api-key: $AGENT_FLOW_API_KEY"} \
            -d "$(jq -n --arg s "$SESSION_ID" --arg msg "$NEW_TEXT" \
              '{source:"claude-code",sessionId:$s,event:{hook_event_name:"message.assistant",session_id:$s,message:$msg}}')"
        fi
      fi
    fi

    echo "$CURRENT_POS" > "$POS_FILE"
    # Clean up position file on Stop
    [ "$HOOK_EVENT" = "Stop" ] && rm -f "$POS_FILE"
  fi
fi

# Gather user identity (all commands are fast/local except gh)
GIT_NAME=$(git config user.name 2>/dev/null || true)
GIT_EMAIL=$(git config user.email 2>/dev/null || true)
OS_USER="${USER:-$(whoami 2>/dev/null || true)}"

# GitHub identity (via gh CLI if available, with timeout)
GH_JSON=$(timeout 3 gh api user 2>/dev/null || true)
GH_LOGIN=""
GH_ID=""
if [ -n "$GH_JSON" ]; then
  GH_LOGIN=$(echo "$GH_JSON" | jq -r '.login // empty')
  GH_ID=$(echo "$GH_JSON" | jq -r '.id // empty')
fi

# Build user object (only include non-empty fields)
USER_OBJ=$(jq -n \
  --arg name "$GIT_NAME" \
  --arg email "$GIT_EMAIL" \
  --arg osUser "$OS_USER" \
  --arg ghUser "$GH_LOGIN" \
  --arg ghId "$GH_ID" \
  '{} +
   (if $name  != "" then {name: $name}       else {} end) +
   (if $email != "" then {email: $email}      else {} end) +
   (if $osUser != "" then {osUser: $osUser}   else {} end) +
   (if $ghUser != "" then {githubUsername: $ghUser} else {} end) +
   (if $ghId  != "" then {githubId: ($ghId | tonumber)} else {} end)')

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

curl -s -X POST "$AGENT_FLOW_URL/api/ingest" \
  -H "Content-Type: application/json" \
  ${AGENT_FLOW_API_KEY:+-H "x-api-key: $AGENT_FLOW_API_KEY"} \
  -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$INPUT" --argjson u "$USER_OBJ" --argjson g "$GIT_OBJ" \
    '{source:"claude-code",sessionId:$s,event:$e,user:$u,git:$g}')"
