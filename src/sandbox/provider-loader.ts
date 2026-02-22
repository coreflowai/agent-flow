import type { SandboxProvider } from './types'
import { getIntegrationConfig } from '../db/slack'

let cachedProvider: SandboxProvider | null = null
let cachedPath: string | null = null

const REQUIRED_METHODS = ['createSession', 'getStatus', 'dispatchTask', 'destroySession'] as const

function validateProvider(mod: any): SandboxProvider {
  if (!mod.name || typeof mod.name !== 'string') {
    throw new Error('Provider module must export a `name` string')
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof mod[method] !== 'function') {
      throw new Error(`Provider module must export a \`${method}\` function`)
    }
  }
  return mod as SandboxProvider
}

/**
 * Load the sandbox provider from the configured script path.
 * Reads the path from integration_configs (key: 'sandbox', field: config.providerScript).
 * Falls back to the built-in Modal provider if no custom script is configured.
 */
export async function loadSandboxProvider(): Promise<SandboxProvider> {
  const config = getIntegrationConfig('sandbox')
  const providerScript = (config?.config as any)?.providerScript as string | undefined

  if (providerScript && providerScript !== cachedPath) {
    // Custom provider script — dynamic import
    cachedPath = providerScript
    cachedProvider = null
    const mod = await import(providerScript)
    cachedProvider = validateProvider(mod.default ?? mod)
    return cachedProvider
  }

  if (cachedProvider && (!providerScript || providerScript === cachedPath)) {
    return cachedProvider
  }

  // Default: built-in Modal provider
  const mod = await import('./providers/modal')
  cachedProvider = validateProvider(mod.default ?? mod)
  cachedPath = null
  return cachedProvider
}

/**
 * Clear the cached provider (useful when config changes).
 */
export function clearProviderCache() {
  cachedProvider = null
  cachedPath = null
}
