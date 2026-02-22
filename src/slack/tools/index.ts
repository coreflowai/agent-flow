import type Anthropic from '@anthropic-ai/sdk'
import { githubTools } from './github'
import { discordTools } from './discord'
import { slackApiTools } from './slack-api'
import { webTools } from './web'
import { datadogTools } from './datadog'
import { sandboxTools } from './sandbox'
import type { ToolModule } from './types'

const modules: ToolModule[] = [
  githubTools,
  discordTools,
  slackApiTools,
  webTools,
  datadogTools,
  sandboxTools,
]

/** All integration tool definitions (pass to Anthropic API as `tools`). */
export const integrationToolDefinitions: Anthropic.Messages.Tool[] =
  modules.flatMap(m => m.definitions)

/**
 * Execute an integration tool by name.
 * Returns the tool result string, or null if no module handles this tool name.
 */
export async function executeIntegrationTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string | null> {
  for (const mod of modules) {
    const result = await mod.execute(name, input)
    if (result !== null) return result
  }
  return null
}
