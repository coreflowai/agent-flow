import type Anthropic from '@anthropic-ai/sdk'
import { getIntegrationConfig } from '../../db/slack'
import { apiFetch, truncate, type ToolModule } from './types'

function getToken(): string | undefined {
  const config = getIntegrationConfig('github')
  const dbToken = (config?.config as any)?.token
  return dbToken || process.env.GITHUB_TOKEN
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  }
}

const definitions: Anthropic.Messages.Tool[] = [
  {
    name: 'github_search',
    description: 'Search code, issues, or PRs on GitHub. Returns top 10 results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (GitHub search syntax supported)' },
        type: { type: 'string', enum: ['code', 'issues'], description: 'Type of search: "code" for code/files, "issues" for issues and PRs. Defaults to "code".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_read_file',
    description: 'Read a file from a GitHub repository. Returns the decoded file content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner (user or org)' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path within the repository' },
        ref: { type: 'string', description: 'Branch, tag, or commit SHA. Defaults to the repo default branch.' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'github_list_repos',
    description: 'List repositories for a user or organization on GitHub.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub username or organization name' },
        type: { type: 'string', enum: ['user', 'org'], description: 'Whether owner is a user or org. Defaults to "user".' },
        sort: { type: 'string', enum: ['updated', 'pushed', 'created', 'full_name'], description: 'Sort order. Defaults to "updated".' },
        per_page: { type: 'number', description: 'Results per page (max 30). Defaults to 20.' },
      },
      required: ['owner'],
    },
  },
  {
    name: 'github_list_directory',
    description: 'List the contents of a directory in a GitHub repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Directory path (use "" or "/" for root)' },
        ref: { type: 'string', description: 'Branch, tag, or commit SHA' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_read_pr',
    description: 'Read a pull request including its description, diff stats, and recent comments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        number: { type: 'number', description: 'PR number' },
      },
      required: ['owner', 'repo', 'number'],
    },
  },
  {
    name: 'github_read_issue',
    description: 'Read a GitHub issue including its body and recent comments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        number: { type: 'number', description: 'Issue number' },
      },
      required: ['owner', 'repo', 'number'],
    },
  },
  {
    name: 'github_list_prs',
    description: 'List pull requests for a GitHub repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state. Defaults to "open".' },
        per_page: { type: 'number', description: 'Results per page (max 30). Defaults to 10.' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_list_issues',
    description: 'List issues for a GitHub repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state. Defaults to "open".' },
        labels: { type: 'string', description: 'Comma-separated list of label names to filter by' },
        per_page: { type: 'number', description: 'Results per page (max 30). Defaults to 10.' },
      },
      required: ['owner', 'repo'],
    },
  },
]

async function execute(name: string, input: Record<string, unknown>): Promise<string | null> {
  const token = getToken()
  if (!token) return 'GitHub token not configured. Set it in the dashboard under Integrations → GitHub, or set the GITHUB_TOKEN environment variable.'

  const headers = authHeaders(token)

  switch (name) {
    case 'github_search': return executeSearch(input as any, headers)
    case 'github_read_file': return executeReadFile(input as any, headers)
    case 'github_list_repos': return executeListRepos(input as any, headers)
    case 'github_list_directory': return executeListDirectory(input as any, headers)
    case 'github_read_pr': return executeReadPr(input as any, headers)
    case 'github_read_issue': return executeReadIssue(input as any, headers)
    case 'github_list_prs': return executeListPrs(input as any, headers)
    case 'github_list_issues': return executeListIssues(input as any, headers)
    default: return null
  }
}

async function executeSearch(
  input: { query: string; type?: string },
  headers: Record<string, string>,
): Promise<string> {
  const type = input.type || 'code'
  const endpoint = type === 'issues'
    ? `https://api.github.com/search/issues?q=${encodeURIComponent(input.query)}&per_page=10`
    : `https://api.github.com/search/code?q=${encodeURIComponent(input.query)}&per_page=10`

  const res = await apiFetch(endpoint, { headers })
  if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

  const data = await res.json() as any
  if (!data.items || data.items.length === 0) return `No results found for "${input.query}"`

  if (type === 'issues') {
    const lines = data.items.map((item: any) =>
      `- [${item.title}](${item.html_url}) — ${item.repository_url?.split('/').slice(-2).join('/') || ''} #${item.number} (${item.state})`,
    )
    return `Found ${data.total_count} results:\n${lines.join('\n')}`
  }

  const lines = data.items.map((item: any) =>
    `- ${item.repository.full_name}: \`${item.path}\` — ${item.html_url}`,
  )
  return `Found ${data.total_count} results:\n${lines.join('\n')}`
}

async function executeReadFile(
  input: { owner: string; repo: string; path: string; ref?: string },
  headers: Record<string, string>,
): Promise<string> {
  let url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${input.path}`
  if (input.ref) url += `?ref=${encodeURIComponent(input.ref)}`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

  const data = await res.json() as any
  if (data.type !== 'file') return `"${input.path}" is a ${data.type}, not a file`
  if (!data.content) return `No content found for "${input.path}"`

  const content = Buffer.from(data.content, 'base64').toString('utf-8')
  return truncate(content)
}

async function executeListRepos(
  input: { owner: string; type?: string; sort?: string; per_page?: number },
  headers: Record<string, string>,
): Promise<string> {
  const isOrg = input.type === 'org'
  const sort = input.sort || 'updated'
  const perPage = Math.min(input.per_page || 20, 30)
  const url = isOrg
    ? `https://api.github.com/orgs/${encodeURIComponent(input.owner)}/repos?sort=${sort}&per_page=${perPage}`
    : `https://api.github.com/users/${encodeURIComponent(input.owner)}/repos?sort=${sort}&per_page=${perPage}`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

  const repos = await res.json() as any[]
  if (repos.length === 0) return `No repositories found for "${input.owner}"`

  const lines = repos.map((r: any) => {
    const stars = r.stargazers_count ? ` ⭐${r.stargazers_count}` : ''
    const lang = r.language ? ` (${r.language})` : ''
    const desc = r.description ? ` — ${r.description.slice(0, 80)}` : ''
    return `- \`${r.full_name}\`${lang}${stars}${desc}`
  })
  return lines.join('\n')
}

async function executeListDirectory(
  input: { owner: string; repo: string; path?: string; ref?: string },
  headers: Record<string, string>,
): Promise<string> {
  const dirPath = input.path || ''
  let url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${dirPath}`
  if (input.ref) url += `?ref=${encodeURIComponent(input.ref)}`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

  const data = await res.json() as any
  if (!Array.isArray(data)) return `"${dirPath}" is not a directory`

  const lines = data.map((item: any) => {
    const icon = item.type === 'dir' ? '📁' : '📄'
    const size = item.type === 'file' ? ` (${item.size} bytes)` : ''
    return `${icon} ${item.name}${size}`
  })
  return lines.join('\n')
}

async function executeReadPr(
  input: { owner: string; repo: string; number: number },
  headers: Record<string, string>,
): Promise<string> {
  const base = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`

  const [prRes, commentsRes] = await Promise.all([
    apiFetch(`${base}/pulls/${input.number}`, { headers }),
    apiFetch(`${base}/pulls/${input.number}/comments?per_page=20`, { headers }),
  ])

  if (!prRes.ok) return `GitHub API error: HTTP ${prRes.status} ${prRes.statusText}`

  const pr = await prRes.json() as any
  const comments = commentsRes.ok ? (await commentsRes.json() as any[]) : []

  // Also get issue-level comments (review comments are separate)
  const issueCommentsRes = await apiFetch(`${base}/issues/${input.number}/comments?per_page=20`, { headers })
  const issueComments = issueCommentsRes.ok ? (await issueCommentsRes.json() as any[]) : []

  let result = `# PR #${pr.number}: ${pr.title}\n`
  result += `**State:** ${pr.state} | **Author:** ${pr.user?.login} | **Created:** ${pr.created_at}\n`
  result += `**Base:** ${pr.base?.ref} ← **Head:** ${pr.head?.ref}\n`
  result += `**Changes:** +${pr.additions} -${pr.deletions} across ${pr.changed_files} files\n`
  if (pr.merged) result += `**Merged** by ${pr.merged_by?.login} at ${pr.merged_at}\n`
  if (pr.body) result += `\n${pr.body}\n`

  const allComments = [
    ...issueComments.map((c: any) => ({ author: c.user?.login, body: c.body, at: c.created_at })),
    ...comments.map((c: any) => ({ author: c.user?.login, body: c.body, at: c.created_at, file: c.path })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  if (allComments.length > 0) {
    result += `\n## Comments (${allComments.length})\n`
    for (const c of allComments.slice(-15)) {
      const file = (c as any).file ? ` on \`${(c as any).file}\`` : ''
      result += `\n**${c.author}**${file} (${c.at}):\n${c.body}\n`
    }
  }

  return truncate(result)
}

async function executeReadIssue(
  input: { owner: string; repo: string; number: number },
  headers: Record<string, string>,
): Promise<string> {
  const base = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`

  const [issueRes, commentsRes] = await Promise.all([
    apiFetch(`${base}/issues/${input.number}`, { headers }),
    apiFetch(`${base}/issues/${input.number}/comments?per_page=20`, { headers }),
  ])

  if (!issueRes.ok) return `GitHub API error: HTTP ${issueRes.status} ${issueRes.statusText}`

  const issue = await issueRes.json() as any
  const comments = commentsRes.ok ? (await commentsRes.json() as any[]) : []

  let result = `# Issue #${issue.number}: ${issue.title}\n`
  result += `**State:** ${issue.state} | **Author:** ${issue.user?.login} | **Created:** ${issue.created_at}\n`
  const labels = issue.labels?.map((l: any) => l.name).join(', ')
  if (labels) result += `**Labels:** ${labels}\n`
  if (issue.assignee) result += `**Assignee:** ${issue.assignee.login}\n`
  if (issue.body) result += `\n${issue.body}\n`

  if (comments.length > 0) {
    result += `\n## Comments (${comments.length})\n`
    for (const c of comments.slice(-15)) {
      result += `\n**${c.user?.login}** (${c.created_at}):\n${c.body}\n`
    }
  }

  return truncate(result)
}

async function executeListPrs(
  input: { owner: string; repo: string; state?: string; per_page?: number },
  headers: Record<string, string>,
): Promise<string> {
  const state = input.state || 'open'
  const perPage = Math.min(input.per_page || 10, 30)
  const url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?state=${state}&per_page=${perPage}`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

  const prs = await res.json() as any[]
  if (prs.length === 0) return `No ${state} pull requests found`

  const lines = prs.map((pr: any) =>
    `- #${pr.number} [${pr.title}](${pr.html_url}) by ${pr.user?.login} (${pr.state}, ${pr.created_at.slice(0, 10)})`,
  )
  return lines.join('\n')
}

async function executeListIssues(
  input: { owner: string; repo: string; state?: string; labels?: string; per_page?: number },
  headers: Record<string, string>,
): Promise<string> {
  const state = input.state || 'open'
  const perPage = Math.min(input.per_page || 10, 30)
  let url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues?state=${state}&per_page=${perPage}`
  if (input.labels) url += `&labels=${encodeURIComponent(input.labels)}`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

  const issues = await res.json() as any[]
  if (issues.length === 0) return `No ${state} issues found`

  // Filter out PRs (GitHub returns PRs in issue endpoints)
  const realIssues = issues.filter((i: any) => !i.pull_request)
  if (realIssues.length === 0) return `No ${state} issues found (only pull requests matched)`

  const lines = realIssues.map((i: any) => {
    const labels = i.labels?.map((l: any) => l.name).join(', ')
    const labelStr = labels ? ` [${labels}]` : ''
    return `- #${i.number} [${i.title}](${i.html_url}) by ${i.user?.login}${labelStr} (${i.created_at.slice(0, 10)})`
  })
  return lines.join('\n')
}

export const githubTools: ToolModule = { definitions, execute }
