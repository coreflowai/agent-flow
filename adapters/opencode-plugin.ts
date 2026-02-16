/**
 * AgentFlow - Open Code Plugin Adapter
 *
 * Install: copy to .opencode/plugin/agent-flow.ts (project) or ~/.config/opencode/plugin/agent-flow.ts (global)
 * Or download from your AgentFlow server: curl -o .opencode/plugin/agent-flow.ts http://localhost:3333/setup/opencode-plugin.ts
 *
 * Environment variables:
 *   AGENT_FLOW_URL    - AgentFlow server URL (default: http://localhost:3333)
 *   AGENT_FLOW_API_KEY - Optional API key for authenticated servers
 */

const AGENT_FLOW_URL = process.env.AGENT_FLOW_URL || "http://localhost:3333";
const AGENT_FLOW_API_KEY = process.env.AGENT_FLOW_API_KEY || "";

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

const user = getUser();

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
    }),
  }).catch(() => {});
}

function extractSessionId(event: any): string | null {
  if (event.properties?.info?.id) return event.properties.info.id;
  if (event.properties?.sessionID) return event.properties.sessionID;
  if (event.properties?.info?.sessionID) return event.properties.info.sessionID;
  if (event.properties?.part?.sessionID) return event.properties.part.sessionID;
  if (event.properties?.session?.id) return event.properties.session.id;
  if (event.sessionId) return event.sessionId;
  return null;
}

export const AgentFlowPlugin = async () => {
  return {
    name: "agent-flow",
    event: async ({ event }: { event: any }) => {
      const sessionId = extractSessionId(event);
      if (!sessionId) return;
      post(sessionId, { type: event.type, properties: event.properties });
    },
  };
};
