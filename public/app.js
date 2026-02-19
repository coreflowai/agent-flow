// AgentFlow Dashboard
const socket = io({ transports: ['websocket'] })

let sessions = []
let filteredSessions = []
let currentUserFilter = ''
let currentSessionId = null
let currentEvents = []
let selectedSessionIdx = -1
let selectedEventIdx = -1
let displayRows = []
let focusArea = 'sessions' // 'sessions' | 'events'
let currentView = 'bubbles' // 'bubbles' | 'list' | 'insights' | 'integrations' | 'feed'
const STALE_TIMEOUT = 7 * 24 * 60 * 60 * 1000 // 7 days

// Virtual scrolling constants
const ROW_HEIGHT = 30
const OVERSCAN = 15
const CHUNK_SIZE = 200

let totalEventCount = 0
let chunkLoading = false
let renderPending = false
const renderedRows = new Map()  // rowIndex -> DOM element
const rowPool = []              // recycled elements

// Source icons (Anthropic / OpenAI)
const ICON_CLAUDE = `<svg width="14" height="14" viewBox="0 0 248 248" fill="none"><path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="#D97757"/></svg>`
const ICON_OPENAI = `<svg width="14" height="14" viewBox="29 29 122 122" fill="currentColor"><path d="M75.91 73.628V62.232c0-.96.36-1.68 1.199-2.16l22.912-13.194c3.119-1.8 6.838-2.639 10.676-2.639 14.394 0 23.511 11.157 23.511 23.032 0 .839 0 1.799-.12 2.758l-23.752-13.914c-1.439-.84-2.879-.84-4.318 0L75.91 73.627Zm53.499 44.383v-27.23c0-1.68-.72-2.88-2.159-3.719L97.142 69.55l9.836-5.638c.839-.48 1.559-.48 2.399 0l22.912 13.195c6.598 3.839 11.035 11.995 11.035 19.912 0 9.116-5.397 17.513-13.915 20.992v.001Zm-60.577-23.99-9.836-5.758c-.84-.48-1.2-1.2-1.2-2.16v-26.39c0-12.834 9.837-22.55 23.152-22.55 5.039 0 9.716 1.679 13.676 4.678L70.993 55.516c-1.44.84-2.16 2.039-2.16 3.719v34.787-.002Zm21.173 12.234L75.91 98.339V81.546l14.095-7.917 14.094 7.917v16.793l-14.094 7.916Zm9.056 36.467c-5.038 0-9.716-1.68-13.675-4.678l23.631-13.676c1.439-.839 2.159-2.038 2.159-3.718V85.863l9.956 5.757c.84.48 1.2 1.2 1.2 2.16v26.389c0 12.835-9.957 22.552-23.27 22.552v.001Zm-28.43-26.75L47.72 102.778c-6.599-3.84-11.036-11.996-11.036-19.913 0-9.236 5.518-17.513 14.034-20.992v27.35c0 1.68.72 2.879 2.16 3.718l29.989 17.393-9.837 5.638c-.84.48-1.56.48-2.399 0Zm-1.318 19.673c-13.555 0-23.512-10.196-23.512-22.792 0-.959.12-1.919.24-2.879l23.63 13.675c1.44.84 2.88.84 4.32 0l30.108-17.392v11.395c0 .96-.361 1.68-1.2 2.16l-22.912 13.194c-3.119 1.8-6.837 2.639-10.675 2.639Z"/></svg>`
const ICON_OPENCODE = `<img src="https://opencode.ai/favicon-v3.ico" width="14" height="14" style="display:inline-block" />`

// DOM
const sessionList = document.getElementById('session-list')
const eventBody = document.getElementById('event-body')
const eventPanel = document.getElementById('event-panel')
const eventSentinel = document.getElementById('event-sentinel')
const emptyState = document.getElementById('empty-state')
// connection-dot is looked up in setConnectionState()
const detailPanel = document.getElementById('detail-panel')
const detailBadge = document.getElementById('detail-badge')
const detailTime = document.getElementById('detail-time')
const detailContent = document.getElementById('detail-content')
const detailClose = document.getElementById('detail-close')
const detailHandle = document.getElementById('detail-handle')
const sessionToolbar = document.getElementById('session-toolbar')
const btnCopyConversation = document.getElementById('btn-copy-conversation')
const userFilterBtn = document.getElementById('user-filter')
const userFilterMenu = document.getElementById('user-filter-menu')
const bubbleView = document.getElementById('bubble-view')
const listView = document.getElementById('list-view')
const cookingContainer = document.getElementById('cooking-container')
const waitingContainer = document.getElementById('waiting-container')
const sectionCooking = document.getElementById('section-cooking')
const sectionWaiting = document.getElementById('section-waiting')
const cookingCount = document.getElementById('cooking-count')
const waitingCount = document.getElementById('waiting-count')
const bubbleEmpty = document.getElementById('bubble-empty')
const bubbleCount = document.getElementById('bubble-count')
const bubbleUserFilterBtn = document.getElementById('bubble-user-filter')
const bubbleUserFilterMenu = document.getElementById('bubble-user-menu')
const btnTitle = document.getElementById('btn-title')

// Insights state
let insights = []
let insightsLoaded = false
let selectedInsightId = null

// Insights DOM
const insightsView = document.getElementById('insights-view')
const insightsList = document.getElementById('insights-list')
const insightsEmpty = document.getElementById('insights-empty')
const insightsCount = document.getElementById('insights-count')
const insightsUserFilterBtn = document.getElementById('insights-user-filter')
const insightsUserFilterMenu = document.getElementById('insights-user-menu')
const insightsBack = document.getElementById('insights-back')
const btnInsights = document.getElementById('btn-insights')
const insightsDetailEmpty = document.getElementById('insights-detail-empty')
const insightsDetail = document.getElementById('insights-detail')
const insightDetailUser = document.getElementById('insight-detail-user')
const insightDetailRepo = document.getElementById('insight-detail-repo')
const insightDetailMeta = document.getElementById('insight-detail-meta')
const insightDetailContent = document.getElementById('insight-detail-content')
const insightDetailDelete = document.getElementById('insight-detail-delete')

// Integrations DOM
const integrationsView = document.getElementById('integrations-view')
const btnIntegrations = document.getElementById('btn-integrations')
const integrationsBack = document.getElementById('integrations-back')

// --- View switching ---
function switchView(view) {
  currentView = view
  bubbleView.classList.add('hidden')
  listView.classList.add('hidden')
  insightsView.classList.add('hidden')
  integrationsView.classList.add('hidden')
  const feedViewEl = document.getElementById('feed-view')
  if (feedViewEl) feedViewEl.classList.add('hidden')

  if (view === 'bubbles') {
    bubbleView.classList.remove('hidden')
    renderBubbles()
  } else if (view === 'list') {
    listView.classList.remove('hidden')
  } else if (view === 'insights') {
    insightsView.classList.remove('hidden')
    if (!insightsLoaded) loadInsights()
    else renderInsights()
  } else if (view === 'integrations') {
    integrationsView.classList.remove('hidden')
    showIntegrationPanel(currentIntegration)
  } else if (view === 'feed') {
    if (feedViewEl) feedViewEl.classList.remove('hidden')
    if (!feedLoaded) {
      // Ensure dataSources is loaded for source name/icon resolution
      if (dataSources.length === 0) loadSources()
      loadFeedEntries()
    }
  }
}

btnTitle.addEventListener('click', () => switchView('bubbles'))
document.getElementById('btn-feed').addEventListener('click', () => switchView('feed'))
btnInsights.addEventListener('click', () => switchView('insights'))
btnIntegrations.addEventListener('click', () => switchView('integrations'))
integrationsBack.addEventListener('click', () => switchView('bubbles'))
insightsBack.addEventListener('click', () => switchView('bubbles'))
document.getElementById('feed-back').addEventListener('click', () => switchView('bubbles'))

// --- User filter (DaisyUI dropdown) ---
function setUserFilter(value) {
  currentUserFilter = value
  const label = value || 'All users'
  userFilterBtn.childNodes[0].textContent = label + ' '
  userFilterBtn.dataset.value = value
  bubbleUserFilterBtn.childNodes[0].textContent = label + ' '
  bubbleUserFilterBtn.dataset.value = value
  // Close dropdown by blurring
  document.activeElement?.blur()
  applyFilter()
  if (currentView === 'bubbles') renderBubbles()
}

function applyFilter() {
  filteredSessions = currentUserFilter
    ? sessions.filter(s => s.userId === currentUserFilter)
    : sessions
  renderSessionList()
  if (currentSessionId && !filteredSessions.find(s => s.id === currentSessionId)) {
    if (filteredSessions.length > 0) {
      selectedSessionIdx = 0
      selectSession(filteredSessions[0].id)
    } else {
      currentSessionId = null
      currentEvents = []
      selectedSessionIdx = -1
      selectedEventIdx = -1
      showEmptyState()
    }
  }
}

function updateUserFilterDropdown() {
  const users = [...new Set(sessions.map(s => s.userId).filter(Boolean))].sort()
  const items = `<li><a class="${!currentUserFilter ? 'active' : ''}" onclick="setUserFilter('')">All users</a></li>` +
    users.map(u => `<li><a class="${u === currentUserFilter ? 'active' : ''}" onclick="setUserFilter('${esc(u)}')">${esc(u)}</a></li>`).join('')
  userFilterMenu.innerHTML = items
  bubbleUserFilterMenu.innerHTML = items
}

// --- Connection ---
function setConnectionState(state) {
  const dot = document.getElementById('connection-dot')
  const overlay = document.getElementById('connection-overlay')
  const overlayText = document.getElementById('connection-overlay-text')

  if (state === 'connected') {
    if (dot) { dot.className = 'inline-block w-2 h-2 rounded-full bg-success'; dot.title = 'connected' }
    if (overlay) overlay.classList.add('hidden')
  } else if (state === 'disconnected') {
    if (dot) { dot.className = 'inline-block w-2 h-2 rounded-full bg-error'; dot.title = 'disconnected' }
    if (overlay) overlay.classList.remove('hidden')
    if (overlayText) overlayText.textContent = 'Reconnecting...'
  } else {
    if (dot) { dot.className = 'inline-block w-2 h-2 rounded-full bg-base-300 animate-pulse'; dot.title = 'connecting...' }
    if (overlay) overlay.classList.remove('hidden')
    if (overlayText) overlayText.textContent = 'Connecting...'
  }
}

socket.on('connect', () => {
  setConnectionState('connected')
  // Re-subscribe to current session after reconnect
  if (currentSessionId) socket.emit('subscribe', currentSessionId)
})
socket.on('disconnect', () => {
  setConnectionState('disconnected')
})

// --- Sessions ---
socket.on('sessions:list', (list) => {
  sessions = list
  updateUserFilterDropdown()
  applyFilter()
  if (currentView === 'bubbles') {
    renderBubbles()
  } else if (!currentSessionId && filteredSessions.length > 0) {
    selectedSessionIdx = 0
    selectSession(filteredSessions[0].id)
  }
})

socket.on('session:update', (session) => {
  if (!session) return
  const isNew = !sessions.find(s => s.id === session.id)
  const idx = sessions.findIndex(s => s.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.unshift(session)
  updateUserFilterDropdown()
  applyFilter()
  if (currentView === 'bubbles') {
    renderBubbles()
  } else if (isNew && (!currentUserFilter || session.userId === currentUserFilter)) {
    selectedSessionIdx = 0
    selectSession(session.id)
  }
})

socket.on('sessions:cleared', () => {
  sessions = []
  filteredSessions = []
  currentSessionId = null
  currentEvents = []
  selectedSessionIdx = -1
  selectedEventIdx = -1
  updateUserFilterDropdown()
  renderSessionList()
  showEmptyState()
  if (currentView === 'bubbles') renderBubbles()
})

// --- Events ---
socket.on('session:meta', ({ sessionId, totalEvents }) => {
  if (sessionId !== currentSessionId) return
  totalEventCount = totalEvents
  loadInitialChunk()
})

socket.on('event', (event) => {
  if (event.sessionId !== currentSessionId) return
  currentEvents.push(event)
  totalEventCount++
  displayRows = groupEvents(currentEvents)
  scheduleRender()
})

async function loadInitialChunk() {
  chunkLoading = true
  try {
    const res = await fetch(`/api/sessions/${currentSessionId}/events?limit=${CHUNK_SIZE}&offset=0`, { credentials: 'include' })
    const data = await res.json()
    if (data.events) {
      currentEvents = data.events
      totalEventCount = data.total
    }
  } catch {}
  chunkLoading = false
  displayRows = groupEvents(currentEvents)
  scheduleRender()
}

async function loadNextChunk() {
  if (chunkLoading) return
  const loaded = currentEvents.length
  if (loaded >= totalEventCount) return
  chunkLoading = true
  try {
    const res = await fetch(`/api/sessions/${currentSessionId}/events?limit=${CHUNK_SIZE}&offset=${loaded}`, { credentials: 'include' })
    const data = await res.json()
    if (data.events) {
      currentEvents.push(...data.events)
      totalEventCount = data.total
    }
  } catch {}
  chunkLoading = false
  displayRows = groupEvents(currentEvents)
  scheduleRender()
}

socket.on('session:deleted', (id) => {
  sessions = sessions.filter(s => s.id !== id)
  if (currentSessionId === id) {
    currentSessionId = null
    currentEvents = []
    displayRows = []
    selectedEventIdx = -1
    showEmptyState()
  }
  updateUserFilterDropdown()
  applyFilter()
  if (currentView === 'bubbles') {
    renderBubbles()
  } else if (!currentSessionId && filteredSessions.length > 0) {
    selectedSessionIdx = 0
    selectSession(filteredSessions[0].id)
  }
})

// --- Keyboard navigation ---
document.addEventListener('keydown', (e) => {
  // Don't handle keys when dialog is open
  if (document.querySelector('dialog[open]')) return
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return

  if (e.key === 'v') {
    e.preventDefault()
    switchView(currentView === 'bubbles' ? 'list' : 'bubbles')
    return
  }

  if (e.key === 'i') {
    e.preventDefault()
    switchView(currentView === 'insights' ? 'bubbles' : 'insights')
    return
  }

  if (e.key === 'f') {
    e.preventDefault()
    switchView(currentView === 'feed' ? 'bubbles' : 'feed')
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    if (currentView === 'list' && !detailPanel.classList.contains('hidden')) {
      closeDetail()
    } else if (currentView === 'list' && focusArea === 'events') {
      focusArea = 'sessions'
      sessionList.focus()
      highlightSession()
      mobileBack()
    } else if (currentView === 'list') {
      switchView('bubbles')
    }
    return
  }

  // List view keyboard nav only
  if (currentView !== 'list') return

  if (e.key === 'ArrowLeft' || e.key === 'h') {
    e.preventDefault()
    focusArea = 'sessions'
    sessionList.focus()
    highlightSession()
    mobileBack()
    return
  }

  if (e.key === 'ArrowRight' || e.key === 'l') {
    e.preventDefault()
    if (currentSessionId) {
      focusArea = 'events'
      eventPanel.focus()
      if (selectedEventIdx < 0 && currentEvents.length > 0) {
        selectedEventIdx = 0
        highlightEvent()
      }
    }
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    if (focusArea === 'sessions' && selectedSessionIdx >= 0 && selectedSessionIdx < filteredSessions.length) {
      selectSession(filteredSessions[selectedSessionIdx].id)
      focusArea = 'events'
      eventPanel.focus()
      selectedEventIdx = 0
      highlightEvent()
    }
    return
  }

  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault()
    if (focusArea === 'events') {
      navigateEvent(1)
    } else {
      focusArea = 'sessions'
      sessionList.focus()
      navigateSession(1)
    }
    return
  }

  if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault()
    if (focusArea === 'events') {
      navigateEvent(-1)
    } else {
      focusArea = 'sessions'
      sessionList.focus()
      navigateSession(-1)
    }
    return
  }
})

function navigateSession(delta) {
  const newIdx = Math.max(0, Math.min(filteredSessions.length - 1, selectedSessionIdx + delta))
  if (newIdx !== selectedSessionIdx) {
    selectedSessionIdx = newIdx
    selectSession(filteredSessions[selectedSessionIdx].id)
    highlightSession()
  }
}

function navigateEvent(delta) {
  const newIdx = Math.max(0, Math.min(displayRows.length - 1, selectedEventIdx + delta))
  if (newIdx !== selectedEventIdx) {
    selectedEventIdx = newIdx
    highlightEvent()
    // Proactive chunk loading when near bottom of loaded data
    if (displayRows.length - newIdx < 20) loadNextChunk()
  }
}

function highlightSession() {
  sessionList.querySelectorAll('.session-item').forEach(el => {
    const idx = parseInt(el.dataset.idx)
    el.classList.toggle('active', idx === selectedSessionIdx)
    if (idx === selectedSessionIdx) el.scrollIntoView({ block: 'nearest' })
  })
}

function highlightEvent() {
  if (selectedEventIdx >= 0) {
    const targetY = selectedEventIdx * ROW_HEIGHT
    const panelTop = eventPanel.scrollTop
    const panelBottom = panelTop + eventPanel.clientHeight
    if (targetY < panelTop) {
      eventPanel.scrollTop = targetY
    } else if (targetY + ROW_HEIGHT > panelBottom) {
      eventPanel.scrollTop = targetY + ROW_HEIGHT - eventPanel.clientHeight
    }
  }
  renderVisibleRows()
  renderDetail()
}

// --- Render sessions ---
function renderSessionList() {
  if (filteredSessions.length === 0) {
    sessionList.innerHTML = '<div class="p-4 text-center opacity-40 text-xs">No sessions yet</div>'
    return
  }

  // Group sessions by repo for display — reorder filteredSessions to match display order
  const repoGroups = groupByRepo(filteredSessions)
  filteredSessions = repoGroups.flatMap(([, group]) => group)
  let html = ''
  let flatIdx = 0

  for (const [repoKey, repoSessions] of repoGroups) {
    const displayName = repoKey || 'Other'
    html += `<div class="repo-group-header px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-40 bg-base-200/50 border-b border-base-200 sticky top-0 z-10">${esc(displayName)}</div>`

    for (const s of repoSessions) {
      const i = flatIdx++
      const isActive = s.id === currentSessionId
      const icon = s.source === 'claude-code' ? ICON_CLAUDE : s.source === 'opencode' ? ICON_OPENCODE : ICON_OPENAI
      const isWaitingForUser = s.status === 'active' && isSessionWaiting(s)
      const status = s.status === 'error' ? '<span class="text-error text-[10px]">err</span>'
        : s.status === 'archived' ? '<span class="opacity-40 text-[10px]">archived</span>'
        : s.status === 'active' && !isWaitingForUser ? '<span class="css-spinner"></span>'
        : ''
      const time = timeAgo(s.lastEventTime)
      const dur = s.lastEventTime - s.startTime
      const durStr = dur > 60000 ? Math.floor(dur / 60000) + 'm' : Math.floor(dur / 1000) + 's'

      const user = s.metadata?.user
      const userName = user?.githubUsername || user?.name || user?.osUser || ''
      const title = s.metadata?.title || userName || (s.id.length > 14 ? s.id.slice(0, 14) + '..' : s.id)

      const lastText = s.lastEventText ? esc(truncate(s.lastEventText, 40)) : ''
      const lastLabel = formatSessionLastEvent(s.lastEventType)

      const archiveBtn = s.status !== 'archived'
        ? `<button class="archive-btn btn btn-xs btn-ghost px-1" data-archive="${s.id}" title="Archive session"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg></button>`
        : ''

      html += `<div class="session-item px-3 py-2 border-b border-base-200 flex items-center gap-2.5 ${isActive ? 'active' : ''}" data-idx="${i}" data-sid="${s.id}" tabindex="0">
        <div class="opacity-60 flex-shrink-0">${icon}</div>
        <div class="flex-1 min-w-0">
          <div class="text-xs truncate font-medium">${lastText ? lastText : lastLabel}</div>
          <div class="text-[10px] opacity-50 truncate">${esc(title)}${lastText ? ' · ' + lastLabel : ''}</div>
          <div class="text-[10px] opacity-30">${time} · ${durStr}</div>
        </div>
        <div class="text-right flex-shrink-0 flex flex-col items-end gap-0.5">
          <div class="text-xs font-bold">${s.eventCount}</div>
          <div>${status}</div>
          ${archiveBtn}
        </div>
      </div>`
    }
  }

  sessionList.innerHTML = html

  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedSessionIdx = parseInt(el.dataset.idx)
      focusArea = 'sessions'
      selectSession(el.dataset.sid)
    })
  })

  sessionList.querySelectorAll('[data-archive]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      archiveSessionById(btn.dataset.archive)
    })
  })
}

function archiveSessionById(id) {
  fetch(`/api/sessions/${id}/archive`, { method: 'POST', credentials: 'include' }).catch(() => {})
}

function selectSession(sessionId) {
  if (currentSessionId) socket.emit('unsubscribe', currentSessionId)
  currentSessionId = sessionId
  currentEvents = []
  displayRows = []
  selectedEventIdx = -1
  totalEventCount = 0
  chunkLoading = false
  // Clear virtual scrolling state
  for (const [ri, el] of renderedRows) {
    releaseRow(el)
  }
  renderedRows.clear()
  eventSentinel.style.height = '0'
  emptyState.classList.add('hidden')
  eventPanel.classList.remove('hidden')
  sessionToolbar.classList.remove('hidden'); sessionToolbar.classList.add('flex')
  detailPanel.classList.add('hidden'); detailHandle.classList.add('hidden')
  socket.emit('subscribe', sessionId)
  renderSessionList()
  mobileShowEvents()
}

function showEmptyState() {
  emptyState.classList.remove('hidden')
  eventPanel.classList.add('hidden')
  sessionToolbar.classList.add('hidden'); sessionToolbar.classList.remove('flex')
  detailPanel.classList.add('hidden'); detailHandle.classList.add('hidden')
  for (const [ri, el] of renderedRows) releaseRow(el)
  renderedRows.clear()
  totalEventCount = 0
  mobileBack()
}

// --- Render events ---

// Event types hidden from the timeline (still stored in DB)
const HIDDEN_EVENT_TYPES = new Set([
  'session.updated', 'session.status', 'session.diff',
  'message.updated', 'step.start', 'step.finish',
])

// Group raw events into display rows (merge tool.start + tool.end pairs)
function groupEvents(events) {
  const rows = []
  const pendingTools = {} // toolName+idx -> start event
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (HIDDEN_EVENT_TYPES.has(e.type)) continue
    if (e.type === 'tool.start') {
      pendingTools[i] = e
    } else if (e.type === 'tool.end') {
      // Find matching start
      let matched = false
      for (const [si, se] of Object.entries(pendingTools)) {
        if (se.toolName === e.toolName) {
          rows.push({ kind: 'tool', start: se, end: e, startIdx: parseInt(si), endIdx: i })
          delete pendingTools[si]
          matched = true
          break
        }
      }
      if (!matched) rows.push({ kind: 'event', event: e, idx: i })
    } else {
      rows.push({ kind: 'event', event: e, idx: i })
    }
  }
  // Any unmatched tool.starts
  for (const [si, se] of Object.entries(pendingTools)) {
    rows.push({ kind: 'tool-pending', event: se, idx: parseInt(si) })
  }
  // Sort by timestamp desc (newest first)
  rows.sort((a, b) => {
    const ta = a.kind === 'tool' ? a.end.timestamp : a.event.timestamp
    const tb = b.kind === 'tool' ? b.end.timestamp : b.event.timestamp
    return tb - ta
  })
  return rows
}

function scheduleRender() {
  if (renderPending) return
  renderPending = true
  requestAnimationFrame(() => {
    renderPending = false
    renderVisibleRows()
  })
}

function renderVisibleRows() {
  const totalHeight = displayRows.length * ROW_HEIGHT
  eventSentinel.style.height = totalHeight + 'px'

  const scrollTop = eventPanel.scrollTop
  const clientHeight = eventPanel.clientHeight
  let startIdx = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN
  let endIdx = Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN
  startIdx = Math.max(0, startIdx)
  endIdx = Math.min(displayRows.length - 1, endIdx)

  // Remove rows outside the visible range
  for (const [ri, el] of renderedRows) {
    if (ri < startIdx || ri > endIdx) {
      releaseRow(el)
      renderedRows.delete(ri)
    }
  }

  // Create/update rows inside the visible range
  for (let ri = startIdx; ri <= endIdx; ri++) {
    let el = renderedRows.get(ri)
    if (!el) {
      el = acquireRow()
      populateRow(el, displayRows[ri], ri)
      el.style.transform = `translateY(${ri * ROW_HEIGHT}px)`
      eventBody.appendChild(el)
      renderedRows.set(ri, el)
    }
    el.classList.toggle('selected', ri === selectedEventIdx)
  }

  // Trigger chunk loading when near bottom of loaded data
  if (displayRows.length - endIdx < 20) loadNextChunk()
}

function populateRow(el, row, ri) {
  el.dataset.ri = ri
  if (row.kind === 'tool') {
    const e = row.end
    const time = timeAgo(row.start.timestamp)
    const dur = e.timestamp - row.start.timestamp
    const durStr = dur > 1000 ? (dur / 1000).toFixed(1) + 's' : dur + 'ms'
    el.innerHTML = `
      <div class="cell-time">
        <span class="text-[10px] opacity-40">${time}</span>
      </div>
      <div class="cell-content">
        <div class="flex items-center gap-1.5">
          <span class="text-warning text-xs font-semibold">${esc(e.toolName || '?')}</span>
          <span class="text-[10px] opacity-30">${durStr}</span>
        </div>
      </div>
    `
  } else if (row.kind === 'tool-pending') {
    const e = row.event
    const time = timeAgo(e.timestamp)
    el.innerHTML = `
      <div class="cell-time">
        <span class="text-[10px] opacity-40">${time}</span>
      </div>
      <div class="cell-content">
        <div class="flex items-center gap-1.5">
          <span class="text-warning text-xs font-semibold">${esc(e.toolName || '?')}</span>
          <span class="text-[10px] opacity-30">pending</span>
        </div>
      </div>
    `
  } else {
    const e = row.event
    const time = timeAgo(e.timestamp)
    const color = {
      session: 'text-info', message: 'text-success',
      error: 'text-error', system: 'opacity-40',
    }[e.category] || ''
    const label = formatLabel(e)
    const preview = formatPreview(e)
    el.innerHTML = `
      <div class="cell-time">
        <span class="text-[10px] opacity-40">${time}</span>
      </div>
      <div class="cell-content">
        <span class="${color} text-xs font-semibold">${label}</span>
        ${preview ? `<span class="text-[10px] opacity-50 ml-1">${preview}</span>` : ''}
      </div>
    `
  }
}

function acquireRow() {
  if (rowPool.length > 0) return rowPool.pop()
  const el = document.createElement('div')
  el.className = 'event-row border-b border-base-200 cursor-pointer'
  return el
}

function releaseRow(el) {
  el.remove()
  if (rowPool.length < 100) rowPool.push(el)
}

// Click delegation on event body
eventBody.addEventListener('click', (e) => {
  const row = e.target.closest('.event-row')
  if (!row) return
  selectedEventIdx = parseInt(row.dataset.ri)
  focusArea = 'events'
  highlightEvent()
})

// Scroll listener for virtual scrolling
eventPanel.addEventListener('scroll', () => {
  requestAnimationFrame(renderVisibleRows)
}, { passive: true })

function formatSessionLastEvent(type) {
  switch (type) {
    case 'session.start': return 'started'
    case 'session.end': return 'ended'
    case 'message.user': return 'user'
    case 'message.assistant': return 'assistant'
    case 'tool.start': return 'running'
    case 'tool.end': return 'tool'
    case 'turn.start': return 'turn'
    case 'error': return 'error'
    default: return type || ''
  }
}

function formatLabel(e) {
  switch (e.type) {
    case 'session.start': return 'session started'
    case 'session.end': return 'session ended'
    case 'message.user': return 'user'
    case 'message.assistant': return 'assistant'
    case 'tool.start': return `${e.toolName || '?'} (pending)`
    case 'tool.end': return e.toolName || '?'
    case 'turn.start': return 'turn'
    case 'error': return 'error'
    default: return e.type
  }
}

function formatPreview(e) {
  const parts = []
  if (e.text) parts.push(esc(truncate(e.text, 200)))
  if (e.error) parts.push(esc(truncate(e.error, 200)))
  return parts.join('\n')
}

// --- Copy conversation ---
function buildConversationText(events) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  const lines = []
  for (const e of sorted) {
    if (e.type === 'message.user' && e.text) {
      lines.push(`## User\n\n${e.text}`)
    } else if (e.type === 'message.assistant' && e.text) {
      lines.push(`## Assistant\n\n${e.text}`)
    } else if (e.type === 'tool.start' && e.toolName) {
      const input = e.toolInput ? '\n```\n' + stringify(e.toolInput) + '\n```' : ''
      lines.push(`### Tool: ${e.toolName}${input}`)
    } else if (e.type === 'tool.end' && e.toolOutput) {
      lines.push(`**Output:**\n\`\`\`\n${stringify(e.toolOutput)}\n\`\`\``)
    } else if (e.type === 'error' && e.error) {
      lines.push(`**Error:** ${e.error}`)
    }
  }
  return lines.join('\n\n')
}

btnCopyConversation.addEventListener('click', async () => {
  const text = buildConversationText(currentEvents)
  await navigator.clipboard.writeText(text)
  const span = btnCopyConversation.querySelector('span')
  const prev = span.textContent
  span.textContent = 'Copied!'
  setTimeout(() => { span.textContent = prev }, 1500)
})

function stringify(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function renderValuePreview(v, opacityClass = 'opacity-50', maxValLen = 120) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') {
    const t = truncate(v, maxValLen)
    return t ? `<pre class="event-detail text-[10px] ${opacityClass} mt-0.5 whitespace-pre-wrap break-all leading-tight">${esc(t)}</pre>` : ''
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v).filter(([, val]) => val !== null && val !== undefined && val !== '')
    if (entries.length === 0) return ''
    const rows = entries.map(([k, val]) => {
      const valStr = typeof val === 'string' ? val : JSON.stringify(val)
      return `<tr><td class="pr-2 opacity-40 whitespace-nowrap align-top">${esc(k)}</td><td class="break-all">${esc(truncate(valStr, maxValLen))}</td></tr>`
    }).join('')
    return `<table class="event-detail text-[10px] ${opacityClass} mt-0.5 leading-tight">${rows}</table>`
  }
  const t = truncate(stringify(v), maxValLen)
  return t ? `<pre class="event-detail text-[10px] ${opacityClass} mt-0.5 whitespace-pre-wrap break-all leading-tight">${esc(t)}</pre>` : ''
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 5000) return 'just now'
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  return Math.floor(diff / 86400000) + 'd ago'
}

function esc(s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function closeDetail() {
  selectedEventIdx = -1
  detailPanel.classList.add('hidden'); detailHandle.classList.add('hidden')
  renderVisibleRows()
}

function renderDetail() {
  if (selectedEventIdx < 0 || selectedEventIdx >= displayRows.length) {
    detailPanel.classList.add('hidden'); detailHandle.classList.add('hidden')
    return
  }
  const row = displayRows[selectedEventIdx]
  detailPanel.classList.remove('hidden'); detailHandle.classList.remove('hidden')

  if (row.kind === 'tool') {
    detailBadge.className = 'badge badge-sm text-[10px] badge-warning'
    detailBadge.textContent = row.end.toolName || '?'
    const dur = row.end.timestamp - row.start.timestamp
    const durStr = dur > 1000 ? (dur / 1000).toFixed(1) + 's' : dur + 'ms'
    detailTime.textContent = new Date(row.start.timestamp).toLocaleString() + ' · ' + durStr
    renderDetailFields([
      ['toolName', row.end.toolName],
      ['duration', durStr],
      ['toolInput', row.start.toolInput],
      ['toolOutput', row.end.toolOutput],
      ['id (start)', row.start.id],
      ['id (end)', row.end.id],
      ['meta', row.start.meta && Object.keys(row.start.meta).length ? row.start.meta : null],
    ])
  } else {
    const e = row.event
    const cat = e.category || 'system'
    const badgeColor = {
      session: 'badge-info', message: 'badge-success', tool: 'badge-warning',
      error: 'badge-error', system: 'badge-ghost',
    }[cat] || 'badge-ghost'
    detailBadge.className = `badge badge-sm text-[10px] ${badgeColor}`
    detailBadge.textContent = formatLabel(e)
    detailTime.textContent = new Date(e.timestamp).toLocaleString()
    renderDetailFields([
      ['id', e.id],
      ['source', e.source],
      ['type', e.type],
      ['role', e.role],
      ['text', e.text],
      ['toolName', e.toolName],
      ['toolInput', e.toolInput],
      ['toolOutput', e.toolOutput],
      ['error', e.error],
      ['meta', e.meta && Object.keys(e.meta).length ? e.meta : null],
    ])
  }
}

function renderDetailValue(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') {
    const isLong = v.length > 80 || v.includes('\n')
    return isLong
      ? `<pre class="whitespace-pre-wrap break-all leading-tight">${esc(v)}</pre>`
      : `<span>${esc(v)}</span>`
  }
  if (Array.isArray(v)) {
    const val = JSON.stringify(v, null, 2)
    return `<pre class="whitespace-pre-wrap break-all leading-tight">${esc(val)}</pre>`
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v).filter(([, val]) => val !== null && val !== undefined)
    if (entries.length === 0) return '<span class="opacity-30">{}</span>'
    const rows = entries.map(([k, val]) => {
      return `<tr class="border-b border-base-100 align-top">
        <td class="pr-3 py-0.5 opacity-40 whitespace-nowrap">${esc(k)}</td>
        <td class="py-0.5">${renderDetailValue(val)}</td>
      </tr>`
    }).join('')
    return `<table class="w-full">${rows}</table>`
  }
  return `<span>${esc(String(v))}</span>`
}

function renderDetailFields(fields) {
  const filtered = fields.filter(([, v]) => v != null)
  detailContent.innerHTML = `<table class="w-full text-[11px]">
    ${filtered.map(([k, v]) => {
      return `<tr class="border-b border-base-200 align-top">
        <td class="pr-3 py-1 opacity-40 whitespace-nowrap font-semibold w-0">${esc(k)}</td>
        <td class="py-1">${renderDetailValue(v)}</td>
      </tr>`
    }).join('')}
  </table>`
}

// --- Detail close button ---
detailClose.addEventListener('click', closeDetail)

// --- Sign out ---
const btnSignout = document.getElementById('btn-signout')
if (btnSignout) {
  btnSignout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' })
    } catch {}
    window.location.href = '/login.html'
  })
}

// --- Help dialog ---
const helpDialog = document.getElementById('help-dialog')
const btnHelp = document.getElementById('btn-help')

btnHelp.addEventListener('click', () => {
  populateHelpDialog()
  helpDialog.showModal()
  lucide.createIcons()
})

// Also open on ? key when not focused on inputs
document.addEventListener('keydown', (e) => {
  if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    e.preventDefault()
    populateHelpDialog()
    helpDialog.showModal()
    lucide.createIcons()
  }
})

// --- API Key management for setup snippets ---
async function getOrCreateApiKey() {
  // Check localStorage first (persists across sessions, unlike sessionStorage)
  const stored = localStorage.getItem('agentflow_api_key')
  if (stored) return stored

  try {
    // Always create a new key — listed keys are hashed, full key is only available at creation
    const createRes = await fetch('/api/auth/api-key/create', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'setup-' + Date.now(), expiresIn: null }),
    })
    if (createRes.ok) {
      const data = await createRes.json()
      if (data.key) {
        localStorage.setItem('agentflow_api_key', data.key)
        return data.key
      }
    }
  } catch {}

  return '<YOUR_API_KEY>'
}

async function populateHelpDialog() {
  const host = location.origin
  const apiKey = await getOrCreateApiKey()

  document.getElementById('claude-config').textContent =
`# 1. Download the hook script (API key is baked in)
mkdir -p ~/.claude/hooks
curl -H "x-api-key: ${apiKey}" -o ~/.claude/hooks/agent-flow.sh ${host}/setup/hook.sh
chmod +x ~/.claude/hooks/agent-flow.sh

# 2. Add to ~/.claude/settings.json (global)
cat <<'EOF' > ~/.claude/settings.json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/hooks/agent-flow.sh", "async": true }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/hooks/agent-flow.sh", "async": true }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/hooks/agent-flow.sh", "async": true }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/hooks/agent-flow.sh", "async": true }] }]
  }
}
EOF`

  document.getElementById('codex-config').textContent =
`# Pipe codex JSON output through to AgentFlow
SESSION_ID="codex-$(date +%s)"
codex exec --json "your prompt" | while IFS= read -r line; do
  echo "$line"
  curl -s -X POST ${host}/api/ingest \\
    -H "Content-Type: application/json" \\
    -H "x-api-key: ${apiKey}" \\
    -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$line" \\
      '{source:"codex",sessionId:$s,event:$e}')" &
done`

  document.getElementById('agent-sdk-ts-config').textContent =
`import { query } from "@anthropic-ai/claude-agent-sdk";

const URL = "${host}/api/ingest";
const API_KEY = "${apiKey}";

function hook(input) {
  fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ source: "claude-code", sessionId: input.session_id, event: input }),
  }).catch(() => {});
  return {};
}

for await (const msg of query({
  prompt: "Hello",
  options: {
    hooks: {
      PreToolUse:  [{ matcher: "", callback: hook }],
      PostToolUse: [{ matcher: "", callback: hook }],
      Stop:        [{ matcher: "", callback: hook }],
    },
  },
})) {
  console.log(msg);
}`

  document.getElementById('agent-sdk-py-config').textContent =
`from claude_agent_sdk import query
import httpx

URL = "${host}/api/ingest"
API_KEY = "${apiKey}"

def hook(event):
    httpx.post(URL, json={"source": "claude-code", "sessionId": event.get("session_id"), "event": event},
               headers={"x-api-key": API_KEY})
    return {}

for msg in query(
    prompt="Hello",
    options={"hooks": {
        "PreToolUse":  [{"matcher": "", "callback": hook}],
        "PostToolUse": [{"matcher": "", "callback": hook}],
        "Stop":        [{"matcher": "", "callback": hook}],
    }},
):
    print(msg)`

  document.getElementById('opencode-config').textContent =
`# Download the plugin globally (API key is baked in)
mkdir -p ~/.config/opencode/plugin
curl -H "x-api-key: ${apiKey}" -o ~/.config/opencode/plugin/agent-flow.ts ${host}/setup/opencode-plugin.ts

# Or install per-project:
# mkdir -p .opencode/plugin
# curl -H "x-api-key: ${apiKey}" -o .opencode/plugin/agent-flow.ts ${host}/setup/opencode-plugin.ts`

  document.getElementById('curl-config').textContent =
`curl -X POST ${host}/api/ingest \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: ${apiKey}' \\
  -d '{"source":"claude-code","sessionId":"test-1","event":{"hook_event_name":"PreToolUse","session_id":"test-1","tool_name":"Bash","tool_input":{"command":"echo hello"}}}'`
}

// --- Setup tab switching ---
document.getElementById('setup-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.setup-tab')
  if (!tab) return
  document.querySelectorAll('.setup-tab').forEach(t => t.classList.remove('tab-active'))
  document.querySelectorAll('.setup-panel').forEach(p => p.classList.add('hidden'))
  tab.classList.add('tab-active')
  document.getElementById(tab.dataset.tab)?.classList.remove('hidden')
})

// Copy buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn')
  if (!btn) return
  const target = document.getElementById(btn.dataset.target)
  if (!target) return
  navigator.clipboard.writeText(target.textContent).then(() => {
    btn.textContent = 'copied!'
    setTimeout(() => { btn.textContent = 'copy' }, 1500)
  })
})

// --- Resizable panels ---
function setupResize(handleId, target, axis) {
  const handle = document.getElementById(handleId)
  const el = document.getElementById(target)
  if (!handle || !el) return

  let startPos, startSize

  function onMouseDown(e) {
    e.preventDefault()
    handle.classList.add('active')
    startPos = axis === 'x' ? e.clientX : e.clientY
    startSize = axis === 'x' ? el.offsetWidth : el.offsetHeight
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  function onMouseMove(e) {
    const delta = axis === 'x'
      ? e.clientX - startPos
      : startPos - e.clientY // inverted for bottom panel (drag up = bigger)
    const newSize = Math.max(0, startSize + delta)
    el.style[axis === 'x' ? 'width' : 'height'] = newSize + 'px'
  }

  function onMouseUp() {
    handle.classList.remove('active')
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  handle.addEventListener('mousedown', onMouseDown)
}

setupResize('sidebar-handle', 'sidebar', 'x')
setupResize('detail-handle', 'detail-panel', 'y')
setupResize('insights-sidebar-handle', 'insights-sidebar', 'x')

// --- Mobile responsive ---
const sidebar = document.getElementById('sidebar')
const mainPanel = document.getElementById('main-panel')

function isMobile() { return window.innerWidth < 768 }

function mobileShowEvents() {
  if (!isMobile()) return
  sidebar.classList.add('mobile-hidden')
  mainPanel.classList.remove('mobile-hidden')
}

function mobileBack() {
  if (!isMobile()) return
  mainPanel.classList.add('mobile-hidden')
  sidebar.classList.remove('mobile-hidden')
  focusArea = 'sessions'
}

// --- Insights mobile ---
const insightsSidebar = document.getElementById('insights-sidebar')
const insightsMain = document.getElementById('insights-main')

function insightsMobileShowDetail() {
  if (!isMobile()) return
  insightsSidebar.classList.add('mobile-hidden')
  insightsMain.classList.remove('mobile-hidden')
}

function insightsMobileBack() {
  if (!isMobile()) return
  insightsMain.classList.add('mobile-hidden')
  insightsSidebar.classList.remove('mobile-hidden')
}

// On resize, remove mobile classes if switching to desktop
window.addEventListener('resize', () => {
  if (!isMobile()) {
    sidebar.classList.remove('mobile-hidden')
    mainPanel.classList.remove('mobile-hidden')
    insightsSidebar.classList.remove('mobile-hidden')
    insightsMain.classList.remove('mobile-hidden')
  }
})

// --- Repo grouping ---
function getRepoKey(s) {
  const git = s.metadata?.git
  return git?.repoName || git?.workDir || null
}

function groupByRepo(list) {
  const groups = new Map()
  for (const s of list) {
    const key = getRepoKey(s)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  // Sort: named repos alphabetically, null last
  const sorted = [...groups.entries()].sort((a, b) => {
    if (a[0] === null && b[0] !== null) return 1
    if (a[0] !== null && b[0] === null) return -1
    if (a[0] === null && b[0] === null) return 0
    return a[0].localeCompare(b[0])
  })
  return sorted
}

// --- Bubble view ---
function getActiveSessions() {
  const src = currentUserFilter
    ? sessions.filter(s => s.userId === currentUserFilter)
    : sessions
  return src.filter(s => s.status === 'active')
}

// Tools that block on user input or exit — not actually "cooking"
const BLOCKING_TOOLS = new Set(['ExitPlanMode', 'AskUserQuestion', 'UserPromptSubmit'])
const TOOL_STALE_MS = 2 * 60 * 1000 // 2 min

function isSessionWaiting(session) {
  if (session.lastEventType === 'message.assistant' || session.lastEventType === 'session.start' || session.lastEventType === 'session.end') return true
  if (session.lastEventType === 'tool.start' && BLOCKING_TOOLS.has(session.lastEventText)) return true
  // Any session idle for >2 min is not actively cooking
  if (Date.now() - session.lastEventTime > TOOL_STALE_MS) return true
  return false
}

function renderBubbles() {
  const active = getActiveSessions()
  const groups = groupByRepo(active)

  bubbleCount.textContent = active.length
  bubbleEmpty.classList.toggle('hidden', active.length > 0)
  const hasWaiting = active.some(s => isSessionWaiting(s))
  btnClearWaiting.classList.toggle('hidden', !hasWaiting)

  // Hide the static cooking/waiting sections (we generate everything dynamically)
  sectionCooking.classList.add('hidden')
  sectionWaiting.classList.add('hidden')

  const activeIds = new Set(active.map(s => s.id))

  // Exit bubbles for sessions no longer active
  document.querySelectorAll('#bubble-inner .agent-bubble').forEach(el => {
    if (!activeIds.has(el.dataset.sid)) {
      el.classList.add('exiting')
      el.addEventListener('transitionend', () => el.remove(), { once: true })
      setTimeout(() => { if (el.parentNode) el.remove() }, 500)
    }
  })

  // Track which repo groups are still needed
  const activeRepoKeys = new Set(groups.map(([key]) => key === null ? '__other__' : key))

  // Remove stale repo groups
  document.querySelectorAll('#bubble-inner .repo-group').forEach(el => {
    if (!activeRepoKeys.has(el.dataset.repo)) el.remove()
  })

  const bubbleScroll = document.getElementById('bubble-inner')

  for (const [repoKey, repoSessions] of groups) {
    const dataKey = repoKey === null ? '__other__' : repoKey
    const displayName = repoKey || 'Other'

    // Get or create repo group container
    let groupEl = bubbleScroll.querySelector(`.repo-group[data-repo="${dataKey}"]`)
    if (!groupEl) {
      groupEl = document.createElement('div')
      groupEl.className = 'repo-group'
      groupEl.dataset.repo = dataKey
      groupEl.innerHTML = `
        <div class="repo-header text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-3 bg-base-100 py-1">${esc(displayName)}</div>
        <div class="bubble-subsection cooking mb-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="css-spinner"></span>
            <span class="text-[10px] font-semibold uppercase tracking-wider opacity-50">Cooking</span>
            <span class="repo-cooking-count badge badge-xs badge-ghost text-[9px]">0</span>
          </div>
          <div class="cooking-container bubble-category flex flex-wrap gap-4"></div>
        </div>
        <div class="bubble-subsection waiting">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-[10px] opacity-30">&#9679;</span>
            <span class="text-[10px] font-semibold uppercase tracking-wider opacity-50">Waiting for response</span>
            <span class="repo-waiting-count badge badge-xs badge-ghost text-[9px]">0</span>
          </div>
          <div class="waiting-container bubble-category flex flex-wrap gap-4"></div>
        </div>
      `
      // Insert before #bubble-empty (keep empty state at top) or append
      bubbleScroll.appendChild(groupEl)
    }

    const cookingContainer = groupEl.querySelector('.cooking-container')
    const waitingContainer = groupEl.querySelector('.waiting-container')
    const cookingSub = groupEl.querySelector('.bubble-subsection.cooking')
    const waitingSub = groupEl.querySelector('.bubble-subsection.waiting')

    const cooking = repoSessions.filter(s => !isSessionWaiting(s))
    const waiting = repoSessions.filter(s => isSessionWaiting(s))

    cookingSub.classList.toggle('hidden', cooking.length === 0)
    waitingSub.classList.toggle('hidden', waiting.length === 0)
    groupEl.querySelector('.repo-cooking-count').textContent = cooking.length
    groupEl.querySelector('.repo-waiting-count').textContent = waiting.length

    // Place each session in the correct sub-container
    for (const s of repoSessions) {
      const targetContainer = isSessionWaiting(s) ? waitingContainer : cookingContainer
      const otherContainer = isSessionWaiting(s) ? cookingContainer : waitingContainer
      const category = isSessionWaiting(s) ? 'waiting' : 'cooking'

      // Find existing bubble anywhere in #bubble-scroll
      let el = bubbleScroll.querySelector(`.agent-bubble[data-sid="${s.id}"]`)

      if (el) {
        // Move to correct container if needed
        if (el.parentNode !== targetContainer) {
          el.classList.remove('cooking', 'waiting')
          el.classList.add(category)
          targetContainer.appendChild(el)
        }
        updateBubbleContent(el, s)
      } else {
        el = createBubbleElement(s, category)
        targetContainer.appendChild(el)
        requestAnimationFrame(() => el.classList.add('visible'))
      }
    }
  }
}

function createBubbleElement(session, category) {
  const el = document.createElement('div')
  el.className = `agent-bubble bg-base-100 ${category}`
  el.dataset.sid = session.id
  el.dataset.eventCount = session.eventCount || 0
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-bubble-archive]')) return
    bubbleSelectSession(session.id)
  })
  updateBubbleContent(el, session)
  return el
}

function updateBubbleContent(el, session) {
  const icon = session.source === 'claude-code' ? ICON_CLAUDE : session.source === 'opencode' ? ICON_OPENCODE : ICON_OPENAI
  const user = session.metadata?.user
  const userName = user?.githubUsername || user?.name || user?.osUser || ''
  const title = session.metadata?.title || userName || (session.id.length > 14 ? session.id.slice(0, 14) + '..' : session.id)

  const waiting = isSessionWaiting(session)
  const spinner = !waiting ? '<span class="css-spinner ml-1"></span>' : ''

  const lastLabel = formatSessionLastEvent(session.lastEventType)
  const lastText = session.lastEventText ? esc(truncate(session.lastEventText, 50)) : ''

  const dur = (session.lastEventTime || Date.now()) - session.startTime
  const durStr = dur > 60000 ? Math.floor(dur / 60000) + 'm' : Math.floor(dur / 1000) + 's'

  // Primary: task/message, Secondary: user name
  const primaryLine = lastText || lastLabel
  const secondaryLine = waiting && lastText
    ? `<div class="text-[10px] opacity-60 mt-1 line-clamp-2 leading-snug">${esc(title)}</div>`
    : `<div class="text-[10px] opacity-40 truncate">${esc(title)}${lastText ? ' · ' + lastLabel : ''}</div>`

  el.innerHTML = `
    <div class="flex items-center gap-1.5 mb-1">
      <span class="opacity-60 flex-shrink-0">${icon}</span>
      <span class="text-xs font-medium truncate flex-1">${primaryLine}</span>
      ${spinner}
      <button class="archive-btn btn btn-xs btn-ghost px-1" data-bubble-archive="${session.id}" title="Archive session"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg></button>
    </div>
    ${secondaryLine}
    <div class="flex items-center justify-between mt-1.5">
      <span class="text-[10px] opacity-30">${durStr}</span>
      <span class="badge badge-xs badge-ghost text-[9px]">${session.eventCount} events</span>
    </div>
  `

  // Pulse on new activity
  const prevCount = parseInt(el.dataset.eventCount || '0')
  if (session.eventCount > prevCount && prevCount > 0) {
    el.classList.remove('pulse')
    void el.offsetWidth
    el.classList.add('pulse')
    el.addEventListener('animationend', () => el.classList.remove('pulse'), { once: true })
  }
  el.dataset.eventCount = session.eventCount
}

function bubbleSelectSession(id) {
  switchView('list')
  selectedSessionIdx = filteredSessions.findIndex(s => s.id === id)
  selectSession(id)
}

// Clear all waiting sessions
const btnClearWaiting = document.getElementById('btn-clear-waiting')
btnClearWaiting.addEventListener('click', () => {
  const waiting = getActiveSessions().filter(s => isSessionWaiting(s))
  waiting.forEach(s => archiveSessionById(s.id))
})

// Event delegation for bubble archive buttons
document.getElementById('bubble-scroll').addEventListener('click', (e) => {
  const archiveBtn = e.target.closest('[data-bubble-archive]')
  if (archiveBtn) {
    e.stopPropagation()
    archiveSessionById(archiveBtn.dataset.bubbleArchive)
  }
})

// --- Bubble hover tooltip ---
const bubbleTooltip = document.getElementById('bubble-tooltip')
let tooltipHoveredBubble = null
const bubbleScrollEl = document.getElementById('bubble-scroll')

function showBubbleTooltip(bubble) {
  const sid = bubble.dataset.sid
  const session = sessions.find(s => s.id === sid)
  if (!session) return
  const text = session.lastEventText || formatSessionLastEvent(session.lastEventType) || ''
  if (!text) return
  tooltipHoveredBubble = bubble
  bubbleTooltip.textContent = text
  const rect = bubble.getBoundingClientRect()
  bubbleTooltip.style.left = rect.left + 'px'
  bubbleTooltip.style.top = (rect.bottom + 6) + 'px'
  bubbleTooltip.classList.add('visible')
  requestAnimationFrame(() => {
    const tr = bubbleTooltip.getBoundingClientRect()
    if (tr.right > window.innerWidth - 8) bubbleTooltip.style.left = (window.innerWidth - tr.width - 8) + 'px'
    if (tr.bottom > window.innerHeight - 8) bubbleTooltip.style.top = (rect.top - tr.height - 6) + 'px'
  })
}

function hideBubbleTooltip() {
  tooltipHoveredBubble = null
  bubbleTooltip.classList.remove('visible')
}

bubbleScrollEl.addEventListener('mousemove', (e) => {
  const bubble = e.target.closest('.agent-bubble')
  if (bubble) {
    if (bubble !== tooltipHoveredBubble) showBubbleTooltip(bubble)
  } else if (tooltipHoveredBubble) {
    hideBubbleTooltip()
  }
})

bubbleScrollEl.addEventListener('mouseleave', () => hideBubbleTooltip())

// --- Stale session cleanup (client-side) ---
setInterval(() => {
  let changed = false
  sessions.forEach(s => {
    if (s.status === 'active' && s.lastEventTime && Date.now() - s.lastEventTime > STALE_TIMEOUT) {
      s.status = 'completed'
      changed = true
    }
  })
  if (changed) {
    applyFilter()
    if (currentView === 'bubbles') renderBubbles()
  }
}, 10000)

// --- Invite dialog ---
const inviteDialog = document.getElementById('invite-dialog')
const btnInvite = document.getElementById('btn-invite')
const inviteEmail = document.getElementById('invite-email')
const inviteCreateBtn = document.getElementById('invite-create-btn')
const inviteLinkBox = document.getElementById('invite-link-box')
const inviteLinkInput = document.getElementById('invite-link-input')
const inviteCopyBtn = document.getElementById('invite-copy-btn')
const inviteList = document.getElementById('invite-list')

btnInvite.addEventListener('click', () => {
  inviteDialog.showModal()
  lucide.createIcons()
  inviteLinkBox.classList.add('hidden')
  inviteEmail.value = ''
  loadInvites()
})

inviteCreateBtn.addEventListener('click', async () => {
  inviteCreateBtn.disabled = true
  inviteCreateBtn.textContent = '...'
  try {
    const res = await fetch('/api/invites', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.value.trim() || undefined }),
    })
    const data = await res.json()
    if (data.ok) {
      inviteLinkInput.value = data.invite.url
      inviteLinkBox.classList.remove('hidden')
      inviteEmail.value = ''
      loadInvites()
    }
  } catch {}
  inviteCreateBtn.disabled = false
  inviteCreateBtn.textContent = 'Create'
})

inviteCopyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(inviteLinkInput.value).then(() => {
    inviteCopyBtn.textContent = 'copied!'
    setTimeout(() => { inviteCopyBtn.textContent = 'copy' }, 1500)
  })
})

async function loadInvites() {
  try {
    const res = await fetch('/api/invites', { credentials: 'include' })
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) {
      inviteList.innerHTML = '<div class="opacity-40">No invites yet</div>'
      return
    }
    inviteList.innerHTML = data.map(inv => {
      const now = Date.now()
      let status, statusClass
      if (inv.usedAt) {
        status = 'used'
        statusClass = 'badge-success'
      } else if (now > inv.expiresAt) {
        status = 'expired'
        statusClass = 'badge-ghost'
      } else {
        status = 'pending'
        statusClass = 'badge-warning'
      }
      const email = inv.email ? esc(inv.email) : '<span class="opacity-40">any</span>'
      const time = timeAgo(inv.createdAt)
      return `<div class="flex items-center gap-2 py-1.5 border-b border-base-200">
        <div class="flex-1 min-w-0">
          <span>${email}</span>
          <span class="opacity-30 ml-1">${time}</span>
        </div>
        <span class="badge badge-xs ${statusClass} text-[9px]">${status}</span>
        ${!inv.usedAt ? `<button class="btn btn-xs btn-ghost text-error opacity-60 invite-revoke-btn" data-id="${inv.id}">revoke</button>` : ''}
      </div>`
    }).join('')

    inviteList.querySelectorAll('.invite-revoke-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/invites/${btn.dataset.id}`, { method: 'DELETE', credentials: 'include' })
        loadInvites()
      })
    })
  } catch {
    inviteList.innerHTML = '<div class="text-error text-xs">Failed to load invites</div>'
  }
}

// --- Insights ---
async function loadInsights() {
  // Show loading indicator
  insightsList.innerHTML = '<div class="flex items-center justify-center p-8"><span class="css-spinner"></span><span class="text-xs opacity-40 ml-2">Loading insights...</span></div>'
  try {
    const params = new URLSearchParams()
    if (currentUserFilter) params.set('userId', currentUserFilter)
    const res = await fetch(`/api/insights?${params}`, { credentials: 'include' })
    insights = await res.json()
    insightsLoaded = true
    updateInsightsUserFilter()
    renderInsights()
  } catch (err) {
    console.error('Failed to load insights:', err)
    insightsList.innerHTML = '<div class="text-error text-xs p-4">Failed to load insights</div>'
  }
}

function updateInsightsUserFilter() {
  const users = [...new Set(insights.map(i => i.userId).filter(Boolean))].sort()
  const items = `<li><a class="${!currentUserFilter ? 'active' : ''}" onclick="setInsightsUserFilter('')">All users</a></li>` +
    users.map(u => `<li><a class="${u === currentUserFilter ? 'active' : ''}" onclick="setInsightsUserFilter('${esc(u)}')">${esc(u)}</a></li>`).join('')
  insightsUserFilterMenu.innerHTML = items
}

function setInsightsUserFilter(value) {
  currentUserFilter = value
  const label = value || 'All users'
  insightsUserFilterBtn.childNodes[0].textContent = label + ' '
  insightsUserFilterBtn.dataset.value = value
  userFilterBtn.childNodes[0].textContent = label + ' '
  userFilterBtn.dataset.value = value
  bubbleUserFilterBtn.childNodes[0].textContent = label + ' '
  bubbleUserFilterBtn.dataset.value = value
  document.activeElement?.blur()
  loadInsights()
}

function renderInsights() {
  const filtered = currentUserFilter
    ? insights.filter(i => i.userId === currentUserFilter)
    : insights

  insightsCount.textContent = filtered.length
  insightsEmpty.classList.toggle('hidden', filtered.length > 0)

  if (filtered.length === 0) {
    insightsList.innerHTML = ''
    insightsList.appendChild(insightsEmpty)
    hideInsightDetail()
    return
  }

  // Build list items — compact single-line HN style
  const listHtml = filtered.map(insight => {
    const time = timeAgo(insight.createdAt)
    const sessions = insight.sessionsAnalyzed || 0
    const events = insight.eventsAnalyzed || 0
    const isActive = insight.id === selectedInsightId

    // Extract summary from content (first non-empty line after ## Summary)
    const summaryMatch = insight.content?.match(/## Summary\n+([^\n#]+)/)
    const summary = summaryMatch ? summaryMatch[1].trim() : ''
    const preview = summary || truncate(insight.content?.replace(/[#*_`]/g, '') || '', 120)

    return `<div class="insight-item-compact ${isActive ? 'active' : ''}" data-id="${insight.id}">
      <div class="flex items-center gap-2 min-w-0">
        <span class="insight-preview-compact truncate">${esc(preview)}</span>
      </div>
      <span class="insight-meta-compact shrink-0">${sessions}s · ${events}e · ${time}</span>
    </div>`
  }).join('')

  insightsList.innerHTML = listHtml

  // Add click handlers
  insightsList.querySelectorAll('.insight-item-compact').forEach(el => {
    el.addEventListener('click', () => {
      selectInsight(el.dataset.id)
    })
  })

  // Re-init lucide icons
  lucide.createIcons()

  // Re-select current insight if still in list
  if (selectedInsightId && filtered.find(i => i.id === selectedInsightId)) {
    renderInsightDetail(selectedInsightId)
  } else if (filtered.length > 0) {
    // Auto-select first if none selected
    selectInsight(filtered[0].id)
  }
}

function selectInsight(id) {
  selectedInsightId = id

  // Update active state in list
  insightsList.querySelectorAll('.insight-item-compact').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id)
  })

  renderInsightDetail(id)
  insightsMobileShowDetail()
}

function renderInsightDetail(id) {
  const insight = insights.find(i => i.id === id)
  if (!insight) {
    hideInsightDetail()
    return
  }

  insightsDetailEmpty.classList.add('hidden')
  insightsDetail.classList.remove('hidden')

  // Header info
  insightDetailUser.textContent = insight.userId
  insightDetailRepo.textContent = insight.repoName || 'All repositories'

  // Meta info - build as spans for better visual grouping
  const time = new Date(insight.createdAt).toLocaleString()
  const sessions = insight.sessionsAnalyzed || 0
  const events = insight.eventsAnalyzed || 0
  const meta = insight.meta || {}
  const tokens = meta.tokenUsage
    ? `${(meta.tokenUsage.inputTokens + meta.tokenUsage.outputTokens).toLocaleString()} tokens`
    : ''
  const duration = meta.durationMs ? `${(meta.durationMs / 1000).toFixed(1)}s` : ''
  const model = meta.model || ''

  const metaParts = [
    `<span>${esc(time)}</span>`,
    `<span>${sessions} sessions</span>`,
    `<span>${events} events</span>`
  ]
  if (model) metaParts.push(`<span class="font-medium">${esc(model)}</span>`)
  if (duration) metaParts.push(`<span>${duration}</span>`)
  if (tokens) metaParts.push(`<span>${tokens}</span>`)
  insightDetailMeta.innerHTML = metaParts.join('<span class="opacity-30">·</span>')

  // Content — render action items first, then reasoning as collapsible
  const content = insight.content || 'No content'
  const actions = (insight.followUpActions || [])

  let detailHtml = ''

  // Action items section (from structured data)
  if (actions.length > 0) {
    detailHtml += '<div class="insight-actions-section">'
    detailHtml += '<h2>Action Items</h2><ul>'
    for (const a of actions) {
      const dot = a.priority === 'high' ? '🔴' : a.priority === 'medium' ? '🟡' : '🟢'
      detailHtml += `<li>${dot} <strong>[${esc(a.category)}]</strong> ${esc(a.action)}</li>`
    }
    detailHtml += '</ul></div>'
  }

  // Reasoning / full analysis as collapsible
  detailHtml += '<details class="insight-reasoning-details"><summary>Analysis Details</summary>'
  detailHtml += '<div class="insight-reasoning-body">' + markdownToHtml(content) + '</div>'
  detailHtml += '</details>'

  insightDetailContent.innerHTML = detailHtml

  // Delete button handler
  insightDetailDelete.onclick = async () => {
    if (!confirm('Delete this insight?')) return
    try {
      await fetch(`/api/insights/${id}`, { method: 'DELETE', credentials: 'include' })
      insights = insights.filter(i => i.id !== id)
      selectedInsightId = null
      renderInsights()
    } catch (err) {
      console.error('Failed to delete insight:', err)
    }
  }

  lucide.createIcons()
}

function hideInsightDetail() {
  insightsDetailEmpty.classList.remove('hidden')
  insightsDetail.classList.add('hidden')
  selectedInsightId = null
}

// Basic markdown to HTML converter
function markdownToHtml(md) {
  if (!md) return ''

  // Process line by line for better control
  const lines = md.split('\n')
  const result = []
  let inList = false

  for (let line of lines) {
    // Headers
    if (line.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false }
      result.push(`<h3>${esc(line.slice(4))}</h3>`)
      continue
    }
    if (line.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false }
      result.push(`<h2>${esc(line.slice(3))}</h2>`)
      continue
    }
    if (line.startsWith('# ')) {
      if (inList) { result.push('</ul>'); inList = false }
      result.push(`<h1>${esc(line.slice(2))}</h1>`)
      continue
    }

    // Horizontal rule
    if (line.trim() === '---') {
      if (inList) { result.push('</ul>'); inList = false }
      result.push('<hr>')
      continue
    }

    // List items
    if (line.startsWith('- ')) {
      if (!inList) { result.push('<ul>'); inList = true }
      const content = formatInlineMarkdown(line.slice(2))
      result.push(`<li>${content}</li>`)
      continue
    }

    // Empty line
    if (line.trim() === '') {
      if (inList) { result.push('</ul>'); inList = false }
      continue
    }

    // Regular paragraph
    if (inList) { result.push('</ul>'); inList = false }
    const content = formatInlineMarkdown(line)
    result.push(`<p>${content}</p>`)
  }

  if (inList) result.push('</ul>')

  return result.join('\n')
}

// Format inline markdown (bold, italic, code)
function formatInlineMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

// Socket.IO: Listen for new insights
socket.on('insight:new', (insight) => {
  // Add to front of list
  insights.unshift(insight)
  if (currentView === 'insights') {
    renderInsights()
  }
})

socket.on('insight:deleted', (id) => {
  insights = insights.filter(i => i.id !== id)
  if (currentView === 'insights') {
    renderInsights()
  }
})

socket.on('insight:updated', (updatedInsight) => {
  if (!updatedInsight) return
  const idx = insights.findIndex(i => i.id === updatedInsight.id)
  if (idx >= 0) {
    insights[idx] = updatedInsight
  } else {
    insights.unshift(updatedInsight)
  }
  if (currentView === 'insights') {
    renderInsights()
  }
})

// --- Toast notifications ---
function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container')
  const alert = document.createElement('div')
  alert.className = `alert alert-${type} shadow-lg text-xs`
  alert.innerHTML = `<span>${esc(message)}</span>`
  container.appendChild(alert)
  setTimeout(() => alert.remove(), 8000)
}

socket.on('insight:error', ({ userId, error }) => {
  showToast(`Insight analysis failed for ${userId}: ${error}`)
})

// --- Searchable Channel Dropdown helper ---
function setupSearchableDropdown(inputEl, hiddenEl, dropdownEl, items, { formatItem, formatLabel, onSelect }) {
  // Prevent duplicate listeners by replacing the input element
  const fresh = inputEl.cloneNode(true)
  inputEl.parentNode.replaceChild(fresh, inputEl)

  // Use a plain text label for filtering (strip HTML)
  const labelFn = formatLabel || ((item) => item.name || item.id)

  function render(filter) {
    const q = (filter || '').toLowerCase()
    const filtered = q ? items.filter(i => labelFn(i).toLowerCase().includes(q)) : items
    if (filtered.length === 0) {
      dropdownEl.innerHTML = '<div class="px-3 py-2 text-xs opacity-40">No matches</div>'
    } else {
      dropdownEl.innerHTML = filtered.slice(0, 50).map((item) =>
        `<div class="px-3 py-1.5 text-xs cursor-pointer hover:bg-base-200" data-id="${item.id}">${formatItem(item)}</div>`
      ).join('')
    }
    dropdownEl.classList.remove('hidden')
  }

  // Single delegated mousedown on the dropdown container
  dropdownEl.onmousedown = (e) => {
    e.preventDefault()
    const row = e.target.closest('[data-id]')
    if (!row) return
    const selected = items.find(i => i.id === row.dataset.id)
    if (selected) {
      onSelect(selected)
      fresh.value = labelFn(selected)
      hiddenEl.value = selected.id
      dropdownEl.classList.add('hidden')
    }
  }

  fresh.addEventListener('focus', () => render(fresh.value))
  fresh.addEventListener('input', () => {
    hiddenEl.value = '' // clear hidden ID when typing manually
    render(fresh.value)
  })
  fresh.addEventListener('blur', () => {
    setTimeout(() => dropdownEl.classList.add('hidden'), 200)
  })

  return fresh // return the new element in case caller needs it
}

// --- Integrations: Slack config ---
const slackBotTokenInput = document.getElementById('slack-bot-token')
const slackAppTokenInput = document.getElementById('slack-app-token')
const slackChannelInput = document.getElementById('slack-channel')
const slackChannelIdInput = document.getElementById('slack-channel-id')
const slackChannelDropdown = document.getElementById('slack-channel-dropdown')
const slackSaveBtn = document.getElementById('slack-save-btn')
const slackTestBtn = document.getElementById('slack-test-btn')
const slackSaveStatus = document.getElementById('slack-save-status')
const slackStatusDot = document.getElementById('slack-status-dot')
const slackStatusText = document.getElementById('slack-status-text')
const slackToggleBotToken = document.getElementById('slack-toggle-bot-token')
const slackToggleAppToken = document.getElementById('slack-toggle-app-token')

// Slack channel cache
let slackChannelsCache = null
async function fetchSlackChannels() {
  if (slackChannelsCache) return slackChannelsCache
  try {
    const res = await fetch('/api/integrations/slack/channels', { credentials: 'include' })
    const data = await res.json()
    if (data.channels && data.channels.length > 0) {
      slackChannelsCache = data.channels
      return data.channels
    }
  } catch {}
  return null
}

async function initSlackChannelDropdown() {
  const channels = await fetchSlackChannels()
  if (!channels) return // Slack not connected — leave as plain text input
  const el = setupSearchableDropdown(
    document.getElementById('slack-channel'), slackChannelIdInput, slackChannelDropdown,
    channels,
    {
      formatItem: (ch) => `${ch.isPrivate ? '&#128274; ' : '#'}${ch.name} <span class="opacity-40">(${ch.numMembers} members)</span>`,
      formatLabel: (ch) => `#${ch.name}`,
      onSelect: (ch) => {},
    }
  )
  if (el) el.id = 'slack-channel' // preserve the ID on the cloned element
}

function toggleTokenVisibility(input, btn) {
  if (input.type === 'password') {
    input.type = 'text'
    btn.innerHTML = '<i data-lucide="eye-off" class="w-3.5 h-3.5"></i>'
  } else {
    input.type = 'password'
    btn.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i>'
  }
  lucide.createIcons()
}

slackToggleBotToken.addEventListener('click', () => toggleTokenVisibility(slackBotTokenInput, slackToggleBotToken))
slackToggleAppToken.addEventListener('click', () => toggleTokenVisibility(slackAppTokenInput, slackToggleAppToken))

function setSlackStatus(connected) {
  if (connected) {
    slackStatusDot.className = 'inline-block w-2 h-2 rounded-full bg-success'
    slackStatusText.textContent = 'Connected'
    slackStatusText.className = 'text-[10px] text-success'
  } else {
    slackStatusDot.className = 'inline-block w-2 h-2 rounded-full bg-base-300'
    slackStatusText.textContent = 'Not connected'
    slackStatusText.className = 'text-[10px] opacity-50'
  }
}

function showSlackSaveStatus(msg, isError) {
  slackSaveStatus.textContent = msg
  slackSaveStatus.className = `text-xs ${isError ? 'text-error' : 'text-success'}`
  slackSaveStatus.classList.remove('hidden')
  setTimeout(() => slackSaveStatus.classList.add('hidden'), 4000)
}

async function loadSlackConfig() {
  try {
    const res = await fetch('/api/integrations/slack', { credentials: 'include' })
    const data = await res.json()
    const channelInput = document.getElementById('slack-channel')
    const channelIdInput = document.getElementById('slack-channel-id')
    if (data.configured) {
      slackBotTokenInput.value = data.botToken || ''
      slackAppTokenInput.value = data.appToken || ''
      if (channelInput) channelInput.value = data.channel || ''
      if (channelIdInput) channelIdInput.value = data.channel || ''
      setSlackStatus(data.connected)
      if (data.connected) {
        slackChannelsCache = null // reset cache on config reload
        initSlackChannelDropdown()
      }
    } else {
      slackBotTokenInput.value = ''
      slackAppTokenInput.value = ''
      if (channelInput) channelInput.value = ''
      if (channelIdInput) channelIdInput.value = ''
      setSlackStatus(false)
    }
  } catch {
    setSlackStatus(false)
  }
}

slackSaveBtn.addEventListener('click', async () => {
  slackSaveBtn.disabled = true
  slackSaveBtn.textContent = 'Saving...'
  try {
    const res = await fetch('/api/integrations/slack', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: slackBotTokenInput.value.trim(),
        appToken: slackAppTokenInput.value.trim(),
        channel: (document.getElementById('slack-channel-id')?.value || document.getElementById('slack-channel')?.value || '').trim(),
      }),
    })
    const data = await res.json()
    if (data.ok) {
      showSlackSaveStatus('Saved successfully' + (data.connected ? ' — Connected!' : ''), false)
      setSlackStatus(data.connected)
      // Reload to get masked tokens
      await loadSlackConfig()
    } else {
      showSlackSaveStatus(data.error || 'Failed to save', true)
    }
  } catch (err) {
    showSlackSaveStatus('Network error', true)
  }
  slackSaveBtn.disabled = false
  slackSaveBtn.textContent = 'Save'
})

slackTestBtn.addEventListener('click', async () => {
  slackTestBtn.disabled = true
  slackTestBtn.textContent = 'Testing...'
  try {
    const res = await fetch('/api/integrations/slack/test', {
      method: 'POST',
      credentials: 'include',
    })
    const data = await res.json()
    if (data.ok) {
      showSlackSaveStatus(`Connection OK — Team: ${data.team}, Bot: ${data.user}`, false)
      setSlackStatus(true)
    } else {
      showSlackSaveStatus(data.error || 'Connection failed', true)
      setSlackStatus(false)
    }
  } catch {
    showSlackSaveStatus('Network error', true)
  }
  slackTestBtn.disabled = false
  slackTestBtn.textContent = 'Test Connection'
})

// Listen for slack status events
socket.on('slack:status', ({ connected }) => {
  if (currentView === 'integrations') setSlackStatus(connected)
})

// --- Integrations: Discord config ---
const discordBotTokenInput = document.getElementById('discord-bot-token')
const discordSaveBtn = document.getElementById('discord-save-btn')
const discordTestBtn = document.getElementById('discord-test-btn')
const discordSaveStatus = document.getElementById('discord-save-status')
const discordStatusDot = document.getElementById('discord-status-dot')
const discordStatusText = document.getElementById('discord-status-text')
const discordToggleBotToken = document.getElementById('discord-toggle-bot-token')

discordToggleBotToken.addEventListener('click', () => toggleTokenVisibility(discordBotTokenInput, discordToggleBotToken))

function setDiscordStatus(connected) {
  if (connected) {
    discordStatusDot.className = 'inline-block w-2 h-2 rounded-full bg-success'
    discordStatusText.textContent = 'Connected'
    discordStatusText.className = 'text-[10px] text-success'
  } else {
    discordStatusDot.className = 'inline-block w-2 h-2 rounded-full bg-base-300'
    discordStatusText.textContent = 'Not connected'
    discordStatusText.className = 'text-[10px] opacity-50'
  }
}

function showDiscordSaveStatus(msg, isError) {
  discordSaveStatus.textContent = msg
  discordSaveStatus.className = `text-xs ${isError ? 'text-error' : 'text-success'}`
  discordSaveStatus.classList.remove('hidden')
  setTimeout(() => discordSaveStatus.classList.add('hidden'), 4000)
}

let discordConfigured = false
async function loadDiscordConfig() {
  try {
    const res = await fetch('/api/integrations/discord', { credentials: 'include' })
    const data = await res.json()
    if (data.configured) {
      discordBotTokenInput.value = data.botToken || ''
      discordConfigured = true
      // Test connection to show live status
      testDiscordConnection(true)
    } else {
      discordBotTokenInput.value = ''
      discordConfigured = false
      setDiscordStatus(false)
    }
  } catch {
    setDiscordStatus(false)
  }
}

async function testDiscordConnection(silent) {
  try {
    const res = await fetch('/api/integrations/discord/test', { method: 'POST', credentials: 'include' })
    const data = await res.json()
    if (data.ok) {
      setDiscordStatus(true)
      if (!silent) showDiscordSaveStatus(`Connected as ${data.username}#${data.discriminator}`, false)
    } else {
      setDiscordStatus(false)
      if (!silent) showDiscordSaveStatus(data.error || 'Connection failed', true)
    }
  } catch {
    setDiscordStatus(false)
    if (!silent) showDiscordSaveStatus('Network error', true)
  }
}

discordSaveBtn.addEventListener('click', async () => {
  discordSaveBtn.disabled = true
  discordSaveBtn.textContent = 'Saving...'
  try {
    const res = await fetch('/api/integrations/discord', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: discordBotTokenInput.value.trim() }),
    })
    const data = await res.json()
    if (data.ok) {
      showDiscordSaveStatus('Saved successfully', false)
      discordConfigured = true
      await loadDiscordConfig()
    } else {
      showDiscordSaveStatus(data.error || 'Failed to save', true)
    }
  } catch {
    showDiscordSaveStatus('Network error', true)
  }
  discordSaveBtn.disabled = false
  discordSaveBtn.textContent = 'Save'
})

discordTestBtn.addEventListener('click', async () => {
  discordTestBtn.disabled = true
  discordTestBtn.textContent = 'Testing...'
  await testDiscordConnection(false)
  discordTestBtn.disabled = false
  discordTestBtn.textContent = 'Test Connection'
})

// --- Discord guilds/channels cache for data source form ---
let discordGuildsCache = null
let discordChannelsCache = {}

async function fetchDiscordGuilds() {
  if (discordGuildsCache) return discordGuildsCache
  try {
    const res = await fetch('/api/integrations/discord/guilds', { credentials: 'include' })
    const data = await res.json()
    if (data.guilds && data.guilds.length > 0) {
      discordGuildsCache = data.guilds
      return data.guilds
    }
  } catch {}
  return null
}

async function fetchDiscordChannels(guildId) {
  if (discordChannelsCache[guildId]) return discordChannelsCache[guildId]
  try {
    const res = await fetch(`/api/integrations/discord/channels?guildId=${guildId}`, { credentials: 'include' })
    const data = await res.json()
    if (data.channels && data.channels.length > 0) {
      discordChannelsCache[guildId] = data.channels
      return data.channels
    }
  } catch {}
  return null
}

// --- Integration Nav Switching ---
let currentIntegration = 'slack'

function showIntegrationPanel(integration) {
  currentIntegration = integration
  const slackPanel = document.getElementById('slack-panel')
  const discordPanel = document.getElementById('discord-panel')
  const sourcesPanel = document.getElementById('sources-panel')
  if (!slackPanel || !discordPanel || !sourcesPanel) return

  // Update nav items
  document.querySelectorAll('.integration-nav-item').forEach(el => {
    const isActive = el.dataset.integration === integration
    el.classList.toggle('border-l-primary', isActive)
    el.classList.toggle('bg-base-200/50', isActive)
    el.classList.toggle('border-l-transparent', !isActive)
  })

  // Hide all panels
  slackPanel.classList.add('hidden')
  discordPanel.classList.add('hidden')
  sourcesPanel.classList.add('hidden')

  if (integration === 'slack') {
    slackPanel.classList.remove('hidden')
    loadSlackConfig()
  } else if (integration === 'discord') {
    discordPanel.classList.remove('hidden')
    loadDiscordConfig()
  } else if (integration === 'sources') {
    sourcesPanel.classList.remove('hidden')
    loadSources()
  }
}

// Integration nav click handler
document.querySelectorAll('.integration-nav-item').forEach(el => {
  el.addEventListener('click', () => showIntegrationPanel(el.dataset.integration))
})

// --- Data Sources ---
let dataSources = []
let editingSourceId = null

const sourcesListEl = document.getElementById('sources-list')
const sourcesForm = document.getElementById('sources-form')
const sourcesFormTitle = document.getElementById('sources-form-title')
const sourcesAddBtn = document.getElementById('sources-add-btn')
const sourceNameInput = document.getElementById('source-name')
const sourceTypeSelect = document.getElementById('source-type')
const sourceSaveBtn = document.getElementById('source-save-btn')
const sourceCancelBtn = document.getElementById('source-cancel-btn')
const sourceSaveStatus = document.getElementById('source-save-status')

// Type-specific config panels
const configSlack = document.getElementById('source-config-slack')
const configDiscord = document.getElementById('source-config-discord')
const configRss = document.getElementById('source-config-rss')

function showSourceConfigPanel(type) {
  configSlack.classList.toggle('hidden', type !== 'slack')
  configDiscord.classList.toggle('hidden', type !== 'discord')
  configRss.classList.toggle('hidden', type !== 'rss')
}

sourceTypeSelect.addEventListener('change', () => {
  const type = sourceTypeSelect.value
  showSourceConfigPanel(type)
  if (type === 'slack') initSourceSlackChannelDropdown()
  if (type === 'discord') initSourceDiscordGuilds()
})

async function loadSources() {
  try {
    const res = await fetch('/api/sources', { credentials: 'include' })
    dataSources = await res.json()
    renderSources()
  } catch {
    sourcesListEl.innerHTML = '<div class="text-error text-xs p-4">Failed to load sources</div>'
  }
}

const SOURCE_TYPE_ICONS = {
  slack: '<svg width="14" height="14" viewBox="0 0 127 127" fill="none"><path d="M27.2 80a13.6 13.6 0 0 1-13.6 13.6A13.6 13.6 0 0 1 0 80a13.6 13.6 0 0 1 13.6-13.6h13.6V80zm6.8 0a13.6 13.6 0 0 1 13.6-13.6 13.6 13.6 0 0 1 13.6 13.6v34a13.6 13.6 0 0 1-13.6 13.6A13.6 13.6 0 0 1 34 114V80z" fill="#E01E5A"/><path d="M47.6 27.2A13.6 13.6 0 0 1 34 13.6 13.6 13.6 0 0 1 47.6 0 13.6 13.6 0 0 1 61.2 13.6v13.6H47.6zm0 6.8a13.6 13.6 0 0 1 13.6 13.6 13.6 13.6 0 0 1-13.6 13.6H13.6A13.6 13.6 0 0 1 0 47.6 13.6 13.6 0 0 1 13.6 34h34z" fill="#36C5F0"/><path d="M99.8 47.6a13.6 13.6 0 0 1 13.6-13.6 13.6 13.6 0 0 1 13.6 13.6 13.6 13.6 0 0 1-13.6 13.6H99.8V47.6zm-6.8 0a13.6 13.6 0 0 1-13.6 13.6 13.6 13.6 0 0 1-13.6-13.6V13.6A13.6 13.6 0 0 1 79.4 0 13.6 13.6 0 0 1 93 13.6v34z" fill="#2EB67D"/><path d="M79.4 99.8a13.6 13.6 0 0 1 13.6 13.6 13.6 13.6 0 0 1-13.6 13.6 13.6 13.6 0 0 1-13.6-13.6V99.8h13.6zm0-6.8a13.6 13.6 0 0 1-13.6-13.6A13.6 13.6 0 0 1 79.4 66h34a13.6 13.6 0 0 1 13.6 13.6 13.6 13.6 0 0 1-13.6 13.4H79.4z" fill="#ECB22E"/></svg>',
  discord: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z"/></svg>',
  rss: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
}

function renderSources() {
  if (dataSources.length === 0) {
    sourcesListEl.innerHTML = '<div class="text-xs opacity-40 p-4 text-center">No data sources configured</div>'
    return
  }
  sourcesListEl.innerHTML = dataSources.map(s => {
    const icon = SOURCE_TYPE_ICONS[s.type] || ''
    const statusDot = s.enabled
      ? '<span class="inline-block w-2 h-2 rounded-full bg-success"></span>'
      : '<span class="inline-block w-2 h-2 rounded-full bg-base-300"></span>'
    const lastSync = s.lastSyncAt ? timeAgo(s.lastSyncAt) : 'never'
    const entryCount = s.entryCount || 0
    const error = s.lastSyncError
      ? `<span class="text-error text-[10px] truncate max-w-[200px] inline-block align-bottom">${esc(s.lastSyncError)}</span>`
      : ''
    return `<div class="flex items-center gap-3 p-3 border border-base-300 rounded-lg hover:bg-base-200/30 transition-colors" data-source-id="${s.id}">
      <span class="opacity-60 flex-shrink-0">${icon}</span>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium flex items-center gap-1.5">${statusDot} ${esc(s.name)}</div>
        <div class="text-[10px] opacity-40">${s.type} · ${entryCount} entries · synced ${lastSync} ${error}</div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        ${s.type === 'rss' ? `<button class="btn btn-xs btn-ghost opacity-50 hover:opacity-100 source-sync-btn" data-id="${s.id}" title="Sync now"><i data-lucide="refresh-cw" class="w-3 h-3"></i></button>` : ''}
        <button class="btn btn-xs btn-ghost opacity-50 hover:opacity-100 source-toggle-btn" data-id="${s.id}" data-enabled="${s.enabled ? 1 : 0}" title="${s.enabled ? 'Disable' : 'Enable'}">
          <i data-lucide="${s.enabled ? 'pause' : 'play'}" class="w-3 h-3"></i>
        </button>
        <button class="btn btn-xs btn-ghost opacity-50 hover:opacity-100 source-edit-btn" data-id="${s.id}" title="Edit"><i data-lucide="settings" class="w-3 h-3"></i></button>
        <button class="btn btn-xs btn-ghost opacity-30 hover:opacity-100 hover:text-error source-delete-btn" data-id="${s.id}" title="Delete"><i data-lucide="trash-2" class="w-3 h-3"></i></button>
      </div>
    </div>`
  }).join('')

  // Event delegation
  sourcesListEl.querySelectorAll('.source-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const enabled = btn.dataset.enabled === '1'
      await fetch(`/api/sources/${btn.dataset.id}/toggle`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      })
      loadSources()
    })
  })
  sourcesListEl.querySelectorAll('.source-sync-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      await fetch(`/api/sources/${btn.dataset.id}/sync`, { method: 'POST', credentials: 'include' })
      btn.disabled = false
      loadSources()
    })
  })
  sourcesListEl.querySelectorAll('.source-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openSourceForm(btn.dataset.id))
  })
  sourcesListEl.querySelectorAll('.source-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this data source and all its entries?')) return
      await fetch(`/api/sources/${btn.dataset.id}`, { method: 'DELETE', credentials: 'include' })
      loadSources()
    })
  })
  lucide.createIcons()
}

function openSourceForm(id) {
  editingSourceId = id || null
  sourcesFormTitle.textContent = id ? 'Edit Data Source' : 'Add Data Source'
  sourcesForm.classList.remove('hidden')

  const srcSlackChannel = document.getElementById('source-slack-channel')
  const srcSlackChannelId = document.getElementById('source-slack-channel-id')
  const srcDiscordGuild = document.getElementById('source-discord-guild')
  const srcDiscordChannel = document.getElementById('source-discord-channel')
  const srcDiscordChannelId = document.getElementById('source-discord-channel-id')

  if (id) {
    const s = dataSources.find(s => s.id === id)
    if (!s) return
    sourceNameInput.value = s.name
    sourceTypeSelect.value = s.type
    showSourceConfigPanel(s.type)
    // Fill in config
    if (s.type === 'slack') {
      srcSlackChannel.value = s.config?.channelId || ''
      srcSlackChannelId.value = s.config?.channelId || ''
      initSourceSlackChannelDropdown()
    } else if (s.type === 'discord') {
      initSourceDiscordGuilds(s.config?.guildId, s.config?.channelId)
    } else if (s.type === 'rss') {
      document.getElementById('source-rss-url').value = s.config?.feedUrl || ''
      document.getElementById('source-rss-interval').value = s.config?.pollIntervalMinutes || 15
    }
    // Fill field mapping
    const fm = s.fieldMapping || {}
    document.getElementById('source-map-author').value = fm.author || ''
    document.getElementById('source-map-content').value = fm.content || ''
    document.getElementById('source-map-url').value = fm.url || ''
    document.getElementById('source-map-timestamp').value = fm.timestamp || ''
  } else {
    sourceNameInput.value = ''
    sourceTypeSelect.value = 'slack'
    showSourceConfigPanel('slack')
    srcSlackChannel.value = ''
    srcSlackChannelId.value = ''
    srcDiscordGuild.innerHTML = '<option value="">Select a server...</option>'
    srcDiscordChannel.value = ''
    srcDiscordChannel.disabled = true
    srcDiscordChannel.placeholder = 'Select a server first...'
    srcDiscordChannelId.value = ''
    document.getElementById('source-rss-url').value = ''
    document.getElementById('source-rss-interval').value = '15'
    document.getElementById('source-map-author').value = ''
    document.getElementById('source-map-content').value = ''
    document.getElementById('source-map-url').value = ''
    document.getElementById('source-map-timestamp').value = ''
    initSourceSlackChannelDropdown()
    initSourceDiscordGuilds()
  }
}

// --- Source form: Slack channel searchable dropdown ---
async function initSourceSlackChannelDropdown() {
  const channels = await fetchSlackChannels()
  if (!channels) return
  const input = document.getElementById('source-slack-channel')
  const hidden = document.getElementById('source-slack-channel-id')
  const dropdown = document.getElementById('source-slack-channel-dropdown')
  const el = setupSearchableDropdown(input, hidden, dropdown, channels, {
    formatItem: (ch) => `${ch.isPrivate ? '&#128274; ' : '#'}${ch.name} <span class="opacity-40">(${ch.numMembers} members)</span>`,
    formatLabel: (ch) => `#${ch.name}`,
    onSelect: (ch) => {},
  })
  if (el) el.id = 'source-slack-channel'
}

// --- Source form: Discord guild dropdown + channel dropdown ---
async function initSourceDiscordGuilds(preselectedGuildId, preselectedChannelId) {
  const guildSelect = document.getElementById('source-discord-guild')
  const channelInput = document.getElementById('source-discord-channel')
  const channelHidden = document.getElementById('source-discord-channel-id')
  const channelDropdown = document.getElementById('source-discord-channel-dropdown')

  const guilds = await fetchDiscordGuilds()
  guildSelect.innerHTML = '<option value="">Select a server...</option>'
  if (!guilds) {
    guildSelect.innerHTML = '<option value="">Discord not connected</option>'
    return
  }
  guilds.forEach(g => {
    const opt = document.createElement('option')
    opt.value = g.id
    opt.textContent = g.name
    guildSelect.appendChild(opt)
  })
  if (preselectedGuildId) {
    guildSelect.value = preselectedGuildId
    await loadDiscordChannelsForGuild(preselectedGuildId, preselectedChannelId)
  }

  // Remove old listener by cloning
  const newGuildSelect = guildSelect.cloneNode(true)
  guildSelect.parentNode.replaceChild(newGuildSelect, guildSelect)
  newGuildSelect.addEventListener('change', async () => {
    const guildId = newGuildSelect.value
    channelInput.value = ''
    channelHidden.value = ''
    if (!guildId) {
      channelInput.disabled = true
      channelInput.placeholder = 'Select a server first...'
      return
    }
    await loadDiscordChannelsForGuild(guildId)
  })
}

async function loadDiscordChannelsForGuild(guildId, preselectedChannelId) {
  const channelInput = document.getElementById('source-discord-channel')
  const channelHidden = document.getElementById('source-discord-channel-id')
  const channelDropdown = document.getElementById('source-discord-channel-dropdown')

  channelInput.disabled = true
  channelInput.placeholder = 'Loading channels...'
  const channels = await fetchDiscordChannels(guildId)
  if (!channels) {
    channelInput.placeholder = 'No channels found'
    return
  }
  channelInput.disabled = false
  channelInput.placeholder = 'Search channels...'

  if (preselectedChannelId) {
    const ch = channels.find(c => c.id === preselectedChannelId)
    if (ch) {
      channelInput.value = `#${ch.name}`
      channelHidden.value = ch.id
    }
  }

  const el = setupSearchableDropdown(channelInput, channelHidden, channelDropdown, channels, {
    formatItem: (ch) => `#${ch.name}`,
    formatLabel: (ch) => `#${ch.name}`,
    onSelect: (ch) => {},
  })
  if (el) el.id = 'source-discord-channel'
}

sourcesAddBtn.addEventListener('click', () => openSourceForm(null))
sourceCancelBtn.addEventListener('click', () => {
  sourcesForm.classList.add('hidden')
  editingSourceId = null
})

sourceSaveBtn.addEventListener('click', async () => {
  const name = sourceNameInput.value.trim()
  const type = sourceTypeSelect.value
  if (!name) { showSourceSaveStatus('Name is required', true); return }

  let config = {}
  if (type === 'slack') {
    const channelId = document.getElementById('source-slack-channel-id').value.trim() || document.getElementById('source-slack-channel').value.trim()
    config = { channelId }
    if (!config.channelId) { showSourceSaveStatus('Channel is required', true); return }
  } else if (type === 'discord') {
    const guildSelect = document.getElementById('source-discord-guild')
    const guildId = guildSelect.value || ''
    const channelId = document.getElementById('source-discord-channel-id').value.trim() || document.getElementById('source-discord-channel').value.trim()
    config = { guildId, channelId }
    if (!config.guildId) { showSourceSaveStatus('Server is required', true); return }
    if (!config.channelId) { showSourceSaveStatus('Channel is required', true); return }
  } else if (type === 'rss') {
    config = {
      feedUrl: document.getElementById('source-rss-url').value.trim(),
      pollIntervalMinutes: parseInt(document.getElementById('source-rss-interval').value) || 15,
    }
    if (!config.feedUrl) { showSourceSaveStatus('Feed URL is required', true); return }
  }

  // Build field mapping (only include non-empty values)
  const fm = {}
  const mapAuthor = document.getElementById('source-map-author').value.trim()
  const mapContent = document.getElementById('source-map-content').value.trim()
  const mapUrl = document.getElementById('source-map-url').value.trim()
  const mapTimestamp = document.getElementById('source-map-timestamp').value.trim()
  if (mapAuthor) fm.author = mapAuthor
  if (mapContent) fm.content = mapContent
  if (mapUrl) fm.url = mapUrl
  if (mapTimestamp) fm.timestamp = mapTimestamp
  const fieldMapping = Object.keys(fm).length > 0 ? fm : undefined

  sourceSaveBtn.disabled = true
  sourceSaveBtn.textContent = 'Saving...'

  try {
    const method = editingSourceId ? 'PUT' : 'POST'
    const url = editingSourceId ? `/api/sources/${editingSourceId}` : '/api/sources'
    const body = editingSourceId
      ? { name, config, fieldMapping }
      : { name, type, config, fieldMapping }
    const res = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.error) {
      showSourceSaveStatus(data.error, true)
    } else {
      sourcesForm.classList.add('hidden')
      editingSourceId = null
      loadSources()
    }
  } catch {
    showSourceSaveStatus('Network error', true)
  }
  sourceSaveBtn.disabled = false
  sourceSaveBtn.textContent = 'Save'
})

function showSourceSaveStatus(msg, isError) {
  sourceSaveStatus.textContent = msg
  sourceSaveStatus.className = `text-xs ${isError ? 'text-error' : 'text-success'}`
  sourceSaveStatus.classList.remove('hidden')
  setTimeout(() => sourceSaveStatus.classList.add('hidden'), 4000)
}

// Socket.IO: Listen for source events
socket.on('source:new', () => { if (currentView === 'integrations' && currentIntegration === 'sources') loadSources() })
socket.on('source:updated', () => { if (currentView === 'integrations' && currentIntegration === 'sources') loadSources() })
socket.on('source:deleted', () => { if (currentView === 'integrations' && currentIntegration === 'sources') loadSources() })

// --- Global Feed View ---
let feedLoaded = false
let feedEntries = []
let feedSourceFilter = ''
let feedPage = 0
const FEED_PAGE_SIZE = 50
let feedLoadingMore = false
let feedHasMore = true

// Build a source name map from dataSources
function getFeedSourceMap() {
  const map = {}
  for (const s of dataSources) map[s.id] = s
  return map
}

async function loadFeedEntries(append = false) {
  if (!append) {
    feedPage = 0
    feedEntries = []
    feedHasMore = true
  }
  try {
    const params = new URLSearchParams({ limit: String(FEED_PAGE_SIZE), offset: String(feedPage * FEED_PAGE_SIZE) })
    if (feedSourceFilter) params.set('dataSourceId', feedSourceFilter)
    const res = await fetch(`/api/source-entries?${params}`, { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    const entries = data.entries || []
    if (entries.length < FEED_PAGE_SIZE) feedHasMore = false
    feedEntries = append ? feedEntries.concat(entries) : entries
    feedLoaded = true
    renderFeedEntries()
    populateFeedSourceFilter()
  } catch {
    const feedList = document.getElementById('feed-list')
    if (feedList) feedList.innerHTML = '<div class="text-error text-xs p-4 text-center">Failed to load feed entries</div>'
  }
}

function renderFeedEntries() {
  const feedList = document.getElementById('feed-list')
  const feedEmpty = document.getElementById('feed-empty')
  const feedCount = document.getElementById('feed-count')
  if (!feedList) return

  if (feedCount) feedCount.textContent = feedEntries.length

  if (feedEntries.length === 0) {
    if (feedEmpty) feedEmpty.classList.remove('hidden')
    feedList.querySelectorAll('.feed-entry').forEach(el => el.remove())
    const loadMore = feedList.querySelector('.feed-load-more')
    if (loadMore) loadMore.remove()
    return
  }

  if (feedEmpty) feedEmpty.classList.add('hidden')

  const sourceMap = getFeedSourceMap()
  const html = feedEntries.map(entry => {
    const src = sourceMap[entry.dataSourceId]
    const typeIcon = src ? (SOURCE_TYPE_ICONS[src.type] || '') : ''
    const sourceName = src ? src.name : 'Unknown'
    const author = entry.author || 'Unknown'
    const content = (entry.content || '').length > 300 ? entry.content.slice(0, 300) + '…' : (entry.content || '')
    const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''
    const url = entry.url ? `<a href="${entry.url}" target="_blank" rel="noopener" class="link link-primary text-[10px] ml-2">Open</a>` : ''

    return `<div class="feed-entry">
      <div class="flex items-center gap-2 mb-1">
        <span class="opacity-60">${typeIcon}</span>
        <span class="badge badge-xs badge-ghost text-[9px]">${sourceName}</span>
        <span class="font-semibold text-xs">${escapeHtml(author)}</span>
        <span class="text-[10px] opacity-40 ml-auto whitespace-nowrap">${ts}</span>
        ${url}
      </div>
      <div class="text-xs opacity-80 whitespace-pre-wrap break-words">${escapeHtml(content)}</div>
    </div>`
  }).join('')

  // Preserve scroll position for appends
  const existingEntries = feedList.querySelectorAll('.feed-entry')
  existingEntries.forEach(el => el.remove())
  const loadMore = feedList.querySelector('.feed-load-more')
  if (loadMore) loadMore.remove()

  feedList.insertAdjacentHTML('beforeend', html)

  if (feedHasMore) {
    feedList.insertAdjacentHTML('beforeend', `<div class="feed-load-more text-center py-3">
      <button class="btn btn-xs btn-ghost opacity-60" onclick="loadMoreFeedEntries()">Load more</button>
    </div>`)
  }
}

async function loadMoreFeedEntries() {
  if (feedLoadingMore || !feedHasMore) return
  feedLoadingMore = true
  feedPage++
  await loadFeedEntries(true)
  feedLoadingMore = false
}

function populateFeedSourceFilter() {
  const menu = document.getElementById('feed-source-menu')
  const btn = document.getElementById('feed-source-filter')
  if (!menu) return

  const items = [{ id: '', name: 'All sources' }].concat(dataSources.map(s => ({ id: s.id, name: s.name })))
  menu.innerHTML = items.map(s => {
    const active = s.id === feedSourceFilter ? 'active' : ''
    return `<li><a class="text-[10px] ${active}" onclick="setFeedSourceFilter('${s.id}')">${escapeHtml(s.name)}</a></li>`
  }).join('')

  if (btn) {
    const current = dataSources.find(s => s.id === feedSourceFilter)
    btn.childNodes[0].textContent = current ? current.name + ' ' : 'All sources '
  }
}

function setFeedSourceFilter(sourceId) {
  feedSourceFilter = sourceId
  feedLoaded = false
  loadFeedEntries()
  document.activeElement?.blur()
}

// Helper: escape HTML (reuse if already defined, otherwise define)
function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Socket.IO: real-time feed entries
socket.on('source:entry', (data) => {
  if (!feedLoaded) return
  const entry = data.entry || data
  // Apply source filter
  if (feedSourceFilter && entry.dataSourceId !== feedSourceFilter) return

  // Prepend to in-memory list
  feedEntries.unshift(entry)

  // Prepend to DOM for live update
  const feedList = document.getElementById('feed-list')
  const feedEmpty = document.getElementById('feed-empty')
  const feedCount = document.getElementById('feed-count')
  if (!feedList) return

  if (feedEmpty) feedEmpty.classList.add('hidden')
  if (feedCount) feedCount.textContent = feedEntries.length

  const sourceMap = getFeedSourceMap()
  const src = sourceMap[entry.dataSourceId]
  const typeIcon = src ? (SOURCE_TYPE_ICONS[src.type] || '') : ''
  const sourceName = src ? src.name : 'Unknown'
  const author = entry.author || 'Unknown'
  const content = (entry.content || '').length > 300 ? entry.content.slice(0, 300) + '…' : (entry.content || '')
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''
  const url = entry.url ? `<a href="${entry.url}" target="_blank" rel="noopener" class="link link-primary text-[10px] ml-2">Open</a>` : ''

  const entryHtml = `<div class="feed-entry" style="animation: fadeIn 0.3s ease-in">
    <div class="flex items-center gap-2 mb-1">
      <span class="opacity-60">${typeIcon}</span>
      <span class="badge badge-xs badge-ghost text-[9px]">${sourceName}</span>
      <span class="font-semibold text-xs">${escapeHtml(author)}</span>
      <span class="text-[10px] opacity-40 ml-auto whitespace-nowrap">${ts}</span>
      ${url}
    </div>
    <div class="text-xs opacity-80 whitespace-pre-wrap break-words">${escapeHtml(content)}</div>
  </div>`

  // Insert after the empty state (which is hidden), before existing entries
  const firstEntry = feedList.querySelector('.feed-entry')
  if (firstEntry) {
    firstEntry.insertAdjacentHTML('beforebegin', entryHtml)
  } else {
    feedList.insertAdjacentHTML('beforeend', entryHtml)
  }
})

// --- Theme switcher ---
const THEMES = [
  'dark', 'light', 'night', 'dim', 'sunset',
  'dracula', 'synthwave', 'cyberpunk', 'black', 'luxury',
  'coffee', 'forest', 'business', 'nord',
  'wireframe', 'lofi', 'corporate', 'emerald',
]

function initTheme() {
  const saved = localStorage.getItem('agentflow_theme')
  if (saved) document.documentElement.setAttribute('data-theme', saved)
  renderThemeMenu()
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('agentflow_theme', theme)
  renderThemeMenu()
  // Close dropdown by blurring
  document.activeElement?.blur()
}

function renderThemeMenu() {
  const menu = document.getElementById('theme-menu')
  if (!menu) return
  const current = document.documentElement.getAttribute('data-theme') || 'dark'
  menu.innerHTML = THEMES.map(t => {
    const active = t === current ? 'active' : ''
    return `<li><a class="text-[11px] ${active}" onclick="setTheme('${t}')">${t}</a></li>`
  }).join('')
}

initTheme()

// Init Lucide icons
lucide.createIcons()

// Sync connection state — check immediately and after a tick (covers race with connect event)
if (socket.connected) setConnectionState('connected')
setTimeout(() => {
  if (socket.connected) setConnectionState('connected')
  else setTimeout(() => {
    if (!socket.connected) setConnectionState('connecting')
  }, 400)
}, 100)
