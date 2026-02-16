/**
 * AgentFlow - Open Code Plugin Adapter
 *
 * Install: copy to .opencode/plugin/agent-flow.ts (project) or ~/.config/opencode/plugin/agent-flow.ts (global)
 * Or download from your AgentFlow server: curl -o .opencode/plugin/agent-flow.ts http://localhost:3333/setup/opencode-plugin.ts
 *
 * Environment variables:
 *   AGENT_FLOW_URL    - AgentFlow server URL (default: http://localhost:3333)
 *   AGENT_FLOW_API_KEY - Optional API key for authenticated servers
 *   AGENT_FLOW_DEBUG  - Set to "1" to log raw events to /tmp/agent-flow-debug.jsonl
 */

const AGENT_FLOW_URL = process.env.AGENT_FLOW_URL || "http://localhost:3333";
const AGENT_FLOW_API_KEY = process.env.AGENT_FLOW_API_KEY || "";
const DEBUG = process.env.AGENT_FLOW_DEBUG === "1";

function getUser() {
  try {
    const { execSync } = require("child_process");
    let name = "";
    try { name = execSync("gh api user --jq .login", { encoding: "utf-8", timeout: 3000 }).trim(); } catch {}
    if (!name) try { name = execSync("git config user.name", { encoding: "utf-8" }).trim(); } catch {}
    const email = execSync("git config user.email", { encoding: "utf-8" }).trim();
    const osUser = process.env.USER || require("os").userInfo().username;
    const user: Record<string, unknown> = {};
    if (name) user.name = name;
    if (email) user.email = email;
    if (osUser) user.osUser = osUser;
    return user;
  } catch {
    return undefined;
  }
}

function getGitInfo() {
  try {
    const { execSync } = require("child_process");
    const run = (cmd: string) => { try { return execSync(cmd, { encoding: "utf-8" }).trim(); } catch { return ""; } };
    const commit = run("git rev-parse --short HEAD");
    const branch = run("git symbolic-ref --short HEAD");
    let remote = run("git remote get-url origin");
    const topLevel = run("git rev-parse --show-toplevel");
    const workDir = topLevel ? require("path").basename(topLevel) : "";
    let repoName = "";
    if (remote) {
      const m = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
      if (m) repoName = m[1];
      remote = remote.replace(/https:\/\/[^@]+@/, "https://");
    }
    const git: Record<string, string> = {};
    if (commit) git.commit = commit;
    if (branch) git.branch = branch;
    if (remote) git.remote = remote;
    if (repoName) git.repoName = repoName;
    if (workDir) git.workDir = workDir;
    return Object.keys(git).length > 0 ? git : undefined;
  } catch {
    return undefined;
  }
}

const user = getUser();
const gitInfo = getGitInfo();
const messageRoles = new Map<string, string>();
// Track which parts have already been forwarded in final form
const finalizedParts = new Set<string>();

function debugLog(event: any) {
  if (!DEBUG) return;
  try {
    const fs = require("fs");
    fs.appendFileSync("/tmp/agent-flow-debug.jsonl", JSON.stringify(event) + "\n");
  } catch {}
}

function post(sessionId: string, event: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AGENT_FLOW_API_KEY) headers["x-api-key"] = AGENT_FLOW_API_KEY;
  fetch(`${AGENT_FLOW_URL}/api/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "opencode" as const,
      sessionId,
      event,
      ...(user ? { user } : {}),
      ...(gitInfo ? { git: gitInfo } : {}),
    }),
  }).catch(() => {});
}

function extractSessionId(event: any): string | null {
  // Prefer explicit sessionID fields
  if (event.properties?.sessionID) return event.properties.sessionID;
  if (event.properties?.info?.sessionID) return event.properties.info.sessionID;
  if (event.properties?.part?.sessionID) return event.properties.part.sessionID;
  // Only use info.id for session.* events (info.id is the session ID there)
  // For other events info.id is a message/entity ID — not a session ID
  if (event.type?.startsWith("session.") && event.properties?.info?.id) return event.properties.info.id;
  return null;
}

export const AgentFlowPlugin = async () => {
  return {
    name: "agent-flow",
    event: async ({ event }: { event: any }) => {
      debugLog(event);
      const sessionId = extractSessionId(event);
      if (!sessionId) return;

      // Track message roles from message.updated events
      if (event.type === "message.updated" && event.properties?.info) {
        const msg = event.properties.info;
        if (msg.id && msg.role) messageRoles.set(msg.id, msg.role);
      }

      // For message.part.updated: deduplicate streaming updates
      // Only forward parts that are finalized (have time.end) or non-streaming types
      if (event.type === "message.part.updated") {
        const part = event.properties?.part;
        if (!part) return;
        const partId = part.id;
        const partType = part.type;

        // For text/reasoning parts, only forward the final update
        // User text parts have no time field (not streamed) — always forward
        // Assistant text parts stream: skip intermediates (time exists but no time.end)
        if (partType === "text" || partType === "reasoning") {
          if (part.time && !part.time.end) return; // skip streaming intermediate
          if (finalizedParts.has(partId)) return; // already sent final
          finalizedParts.add(partId);
        }

        // For tool parts, forward on state transitions (running → completed/error)
        if (partType === "tool") {
          const status = part.state?.status;
          const key = `${partId}:${status}`;
          if (finalizedParts.has(key)) return;
          finalizedParts.add(key);
        }

        // Inject role so normalizer can distinguish user vs assistant
        const role = part.messageID ? messageRoles.get(part.messageID) : undefined;
        const properties = role
          ? { ...event.properties, _role: role }
          : event.properties;
        post(sessionId, { type: event.type, properties });
        return;
      }

      post(sessionId, { type: event.type, properties: event.properties });
    },
  };
};
