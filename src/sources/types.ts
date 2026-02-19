import type { DataSource, SourceEntry, FieldMapping } from '../types'

export type SourceListener = {
  start(): Promise<void>
  stop(): Promise<void>
  /** Manual sync (mainly for RSS) */
  syncNow?(): Promise<{ added: number }>
}

export type SourceListenerFactory = (
  source: DataSource,
  onEntry: (entry: Omit<SourceEntry, 'id' | 'ingestedAt'>) => void,
  onError: (error: Error) => void,
  deps?: SourceListenerDeps,
) => SourceListener

export type SourceListenerDeps = {
  slackBot?: {
    registerChannelListener(channelId: string, cb: (msg: any, client?: any) => void): void
    unregisterChannelListener(channelId: string): void
  }
}

/** Default field mappings per source type */
export const DEFAULT_FIELD_MAPPINGS: Record<string, FieldMapping> = {
  slack: { author: 'user_profile.real_name', content: 'text', timestamp: 'ts' },
  discord: { author: 'author.username', content: 'content', timestamp: 'timestamp' },
  rss: { author: 'creator', content: 'contentSnippet', url: 'link', timestamp: 'isoDate' },
}
