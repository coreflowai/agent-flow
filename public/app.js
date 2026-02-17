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
let currentView = 'bubbles' // 'bubbles' | 'list' | 'insights' | 'integrations'
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
    loadSlackConfig()
  }
}

btnTitle.addEventListener('click', () => switchView('bubbles'))
btnInsights.addEventListener('click', () => switchView('insights'))
btnIntegrations.addEventListener('click', () => switchView('integrations'))
integrationsBack.addEventListener('click', () => switchView('bubbles'))
insightsBack.addEventListener('click', () => switchView('bubbles'))

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

// --- Integrations: Slack config ---
const slackBotTokenInput = document.getElementById('slack-bot-token')
const slackAppTokenInput = document.getElementById('slack-app-token')
const slackChannelInput = document.getElementById('slack-channel')
const slackSaveBtn = document.getElementById('slack-save-btn')
const slackTestBtn = document.getElementById('slack-test-btn')
const slackSaveStatus = document.getElementById('slack-save-status')
const slackStatusDot = document.getElementById('slack-status-dot')
const slackStatusText = document.getElementById('slack-status-text')
const slackToggleBotToken = document.getElementById('slack-toggle-bot-token')
const slackToggleAppToken = document.getElementById('slack-toggle-app-token')

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
    if (data.configured) {
      slackBotTokenInput.value = data.botToken || ''
      slackAppTokenInput.value = data.appToken || ''
      slackChannelInput.value = data.channel || ''
      setSlackStatus(data.connected)
    } else {
      slackBotTokenInput.value = ''
      slackAppTokenInput.value = ''
      slackChannelInput.value = ''
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
        channel: slackChannelInput.value.trim(),
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
