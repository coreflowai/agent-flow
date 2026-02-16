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
let currentView = 'bubbles' // 'bubbles' | 'list'
const STALE_TIMEOUT = 10 * 60 * 1000 // 10 minutes — keep bubbles visible longer

// Source icons (Anthropic / OpenAI)
const ICON_CLAUDE = `<svg width="14" height="14" viewBox="0 0 248 248" fill="none"><path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="#D97757"/></svg>`
const ICON_OPENAI = `<svg width="14" height="14" viewBox="29 29 122 122" fill="currentColor"><path d="M75.91 73.628V62.232c0-.96.36-1.68 1.199-2.16l22.912-13.194c3.119-1.8 6.838-2.639 10.676-2.639 14.394 0 23.511 11.157 23.511 23.032 0 .839 0 1.799-.12 2.758l-23.752-13.914c-1.439-.84-2.879-.84-4.318 0L75.91 73.627Zm53.499 44.383v-27.23c0-1.68-.72-2.88-2.159-3.719L97.142 69.55l9.836-5.638c.839-.48 1.559-.48 2.399 0l22.912 13.195c6.598 3.839 11.035 11.995 11.035 19.912 0 9.116-5.397 17.513-13.915 20.992v.001Zm-60.577-23.99-9.836-5.758c-.84-.48-1.2-1.2-1.2-2.16v-26.39c0-12.834 9.837-22.55 23.152-22.55 5.039 0 9.716 1.679 13.676 4.678L70.993 55.516c-1.44.84-2.16 2.039-2.16 3.719v34.787-.002Zm21.173 12.234L75.91 98.339V81.546l14.095-7.917 14.094 7.917v16.793l-14.094 7.916Zm9.056 36.467c-5.038 0-9.716-1.68-13.675-4.678l23.631-13.676c1.439-.839 2.159-2.038 2.159-3.718V85.863l9.956 5.757c.84.48 1.2 1.2 1.2 2.16v26.389c0 12.835-9.957 22.552-23.27 22.552v.001Zm-28.43-26.75L47.72 102.778c-6.599-3.84-11.036-11.996-11.036-19.913 0-9.236 5.518-17.513 14.034-20.992v27.35c0 1.68.72 2.879 2.16 3.718l29.989 17.393-9.837 5.638c-.84.48-1.56.48-2.399 0Zm-1.318 19.673c-13.555 0-23.512-10.196-23.512-22.792 0-.959.12-1.919.24-2.879l23.63 13.675c1.44.84 2.88.84 4.32 0l30.108-17.392v11.395c0 .96-.361 1.68-1.2 2.16l-22.912 13.194c-3.119 1.8-6.837 2.639-10.675 2.639Z"/></svg>`
const ICON_OPENCODE = `<img src="https://opencode.ai/favicon-v3.ico" width="14" height="14" style="display:inline-block" />`

// DOM
const sessionList = document.getElementById('session-list')
const eventBody = document.getElementById('event-body')
const eventPanel = document.getElementById('event-panel')
const emptyState = document.getElementById('empty-state')
const connectionStatus = document.getElementById('connection-status')
const detailPanel = document.getElementById('detail-panel')
const detailBadge = document.getElementById('detail-badge')
const detailTime = document.getElementById('detail-time')
const detailContent = document.getElementById('detail-content')
const detailClose = document.getElementById('detail-close')
const detailHandle = document.getElementById('detail-handle')
const userFilter = document.getElementById('user-filter')
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
const bubbleUserFilter = document.getElementById('bubble-user-filter')
const btnTitle = document.getElementById('btn-title')

// --- View switching ---
function switchView(view) {
  currentView = view
  if (view === 'bubbles') {
    bubbleView.classList.remove('hidden')
    listView.classList.add('hidden')
    renderBubbles()
  } else {
    bubbleView.classList.add('hidden')
    listView.classList.remove('hidden')
  }
}

btnTitle.addEventListener('click', () => switchView('bubbles'))

// --- User filter ---
userFilter.addEventListener('change', () => {
  currentUserFilter = userFilter.value
  bubbleUserFilter.value = currentUserFilter
  applyFilter()
  if (currentView === 'bubbles') renderBubbles()
})

bubbleUserFilter.addEventListener('change', () => {
  currentUserFilter = bubbleUserFilter.value
  userFilter.value = currentUserFilter
  applyFilter()
  if (currentView === 'bubbles') renderBubbles()
})

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
  const prev = currentUserFilter
  const options = '<option value="">All users</option>' +
    users.map(u => `<option value="${esc(u)}"${u === prev ? ' selected' : ''}>${esc(u)}</option>`).join('')
  userFilter.innerHTML = options
  bubbleUserFilter.innerHTML = options
}

// --- Connection ---
socket.on('connect', () => {
  connectionStatus.textContent = 'connected'
  connectionStatus.className = 'badge badge-sm badge-success text-[10px]'
  // Re-subscribe to current session after reconnect
  if (currentSessionId) socket.emit('subscribe', currentSessionId)
})
socket.on('disconnect', () => {
  connectionStatus.textContent = 'disconnected'
  connectionStatus.className = 'badge badge-sm badge-error text-[10px]'
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
socket.on('session:events', ({ sessionId, events }) => {
  if (sessionId !== currentSessionId) return
  currentEvents = events
  renderEvents()
})

socket.on('event', (event) => {
  if (event.sessionId !== currentSessionId) return
  currentEvents.push(event)
  renderEvents()
})

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
  }
}

function highlightSession() {
  sessionList.querySelectorAll('.session-item').forEach((el, i) => {
    el.classList.toggle('active', i === selectedSessionIdx)
    if (i === selectedSessionIdx) el.scrollIntoView({ block: 'nearest' })
  })
}

function highlightEvent() {
  eventBody.querySelectorAll('.event-row').forEach((el, i) => {
    el.classList.toggle('selected', i === selectedEventIdx)
    if (i === selectedEventIdx) el.scrollIntoView({ block: 'nearest' })
  })
  renderDetail()
}

// --- Render sessions ---
function renderSessionList() {
  if (filteredSessions.length === 0) {
    sessionList.innerHTML = '<div class="p-4 text-center opacity-40 text-xs">No sessions yet</div>'
    return
  }

  sessionList.innerHTML = filteredSessions.map((s, i) => {
    const isActive = s.id === currentSessionId
    const icon = s.source === 'claude-code' ? ICON_CLAUDE : s.source === 'opencode' ? ICON_OPENCODE : ICON_OPENAI
    const isWaitingForUser = s.status === 'active' && (s.lastEventType === 'message.assistant' || s.lastEventType === 'session.start')
    const status = s.status === 'error' ? '<span class="text-error text-[10px]">err</span>'
      : s.status === 'active' && !isWaitingForUser ? '<span class="css-spinner"></span>'
      : ''
    const time = timeAgo(s.lastEventTime)
    const dur = s.lastEventTime - s.startTime
    const durStr = dur > 60000 ? Math.floor(dur / 60000) + 'm' : Math.floor(dur / 1000) + 's'

    // User identity from session metadata
    const user = s.metadata?.user
    const userName = user?.githubUsername || user?.name || user?.osUser || ''
    const title = userName || (s.id.length > 14 ? s.id.slice(0, 14) + '..' : s.id)

    // Latest action preview
    const lastText = s.lastEventText ? esc(truncate(s.lastEventText, 40)) : ''
    const lastLabel = formatSessionLastEvent(s.lastEventType)

    return `<div class="session-item px-3 py-2 border-b border-base-200 flex items-center gap-2.5 ${isActive ? 'active' : ''}" data-idx="${i}" data-sid="${s.id}" tabindex="0">
      <div class="opacity-60 flex-shrink-0">${icon}</div>
      <div class="flex-1 min-w-0">
        <div class="text-xs truncate font-medium">${esc(title)}</div>
        <div class="text-[10px] opacity-50 truncate">${lastLabel}${lastText ? ' · ' + lastText : ''}</div>
        <div class="text-[10px] opacity-30">${time} · ${durStr}</div>
      </div>
      <div class="text-right flex-shrink-0">
        <div class="text-xs font-bold">${s.eventCount}</div>
        <div>${status}</div>
      </div>
    </div>`
  }).join('')

  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedSessionIdx = parseInt(el.dataset.idx)
      focusArea = 'sessions'
      selectSession(el.dataset.sid)
    })
  })
}

function selectSession(sessionId) {
  if (currentSessionId) socket.emit('unsubscribe', currentSessionId)
  currentSessionId = sessionId
  currentEvents = []
  selectedEventIdx = -1
  eventBody.innerHTML = ''
  emptyState.classList.add('hidden')
  eventPanel.classList.remove('hidden')
  detailPanel.classList.add('hidden'); detailHandle.classList.add('hidden')
  socket.emit('subscribe', sessionId)
  renderSessionList()
  mobileShowEvents()
}

function showEmptyState() {
  emptyState.classList.remove('hidden')
  eventPanel.classList.add('hidden')
  detailPanel.classList.add('hidden'); detailHandle.classList.add('hidden')
  eventBody.innerHTML = ''
  mobileBack()
}

// --- Render events ---

// Group raw events into display rows (merge tool.start + tool.end pairs)
function groupEvents(events) {
  const rows = []
  const pendingTools = {} // toolName+idx -> start event
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
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

function renderEvents() {
  displayRows = groupEvents(currentEvents)
  eventBody.innerHTML = ''
  displayRows.forEach((row, ri) => appendDisplayRow(row, ri))
}

function appendDisplayRow(row, ri) {
  const tr = document.createElement('tr')
  tr.className = 'event-row border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer'
  tr.dataset.ri = ri
  tr.addEventListener('click', () => {
    focusArea = 'events'
    selectedEventIdx = ri
    highlightEvent()
  })

  if (row.kind === 'tool') {
    const e = row.end
    const time = timeAgo(row.start.timestamp)
    const dur = e.timestamp - row.start.timestamp
    const durStr = dur > 1000 ? (dur / 1000).toFixed(1) + 's' : dur + 'ms'
    tr.innerHTML = `
      <td class="pl-3 pr-2 py-1 align-top w-0 whitespace-nowrap">
        <span class="text-[10px] opacity-40">${time}</span>
      </td>
      <td class="py-1 pr-3">
        <div class="flex items-center gap-1.5">
          <span class="text-warning text-xs font-semibold">${esc(e.toolName || '?')}</span>
          <span class="text-[10px] opacity-30">${durStr}</span>
        </div>
        ${renderValuePreview(row.start.toolInput, 'opacity-50')}
        ${renderValuePreview(e.toolOutput, 'opacity-40')}
      </td>
    `
  } else if (row.kind === 'tool-pending') {
    const e = row.event
    const time = timeAgo(e.timestamp)
    tr.innerHTML = `
      <td class="pl-3 pr-2 py-1 align-top w-0 whitespace-nowrap">
        <span class="text-[10px] opacity-40">${time}</span>
      </td>
      <td class="py-1 pr-3">
        <div class="flex items-center gap-1.5">
          <span class="text-warning text-xs font-semibold">${esc(e.toolName || '?')}</span>
          <span class="css-spinner" style="opacity:0.3"></span>
        </div>
        ${renderValuePreview(e.toolInput, 'opacity-50')}
      </td>
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
    tr.innerHTML = `
      <td class="pl-3 pr-2 py-1 align-top w-0 whitespace-nowrap">
        <span class="text-[10px] opacity-40">${time}</span>
      </td>
      <td class="py-1 pr-3">
        <span class="${color} text-xs font-semibold">${label}</span>
        ${preview ? `<pre class="event-detail text-[10px] opacity-50 mt-0.5 whitespace-pre-wrap break-all leading-tight">${preview}</pre>` : ''}
      </td>
    `
  }
  eventBody.appendChild(tr)
}

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
  eventBody.querySelectorAll('.event-row').forEach(el => el.classList.remove('selected'))
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

// On resize, remove mobile classes if switching to desktop
window.addEventListener('resize', () => {
  if (!isMobile()) {
    sidebar.classList.remove('mobile-hidden')
    mainPanel.classList.remove('mobile-hidden')
  }
})

// --- Bubble view ---
function getActiveSessions() {
  const src = currentUserFilter
    ? sessions.filter(s => s.userId === currentUserFilter)
    : sessions
  return src.filter(s => s.status === 'active')
}

function isBubbleWaiting(session) {
  return session.lastEventType === 'message.assistant' || session.lastEventType === 'session.start'
}

function renderBubbles() {
  const active = getActiveSessions()
  const cooking = active.filter(s => !isBubbleWaiting(s))
  const waiting = active.filter(s => isBubbleWaiting(s))

  bubbleCount.textContent = active.length
  bubbleEmpty.classList.toggle('hidden', active.length > 0)
  sectionCooking.classList.toggle('hidden', cooking.length === 0)
  sectionWaiting.classList.toggle('hidden', waiting.length === 0)
  cookingCount.textContent = cooking.length
  waitingCount.textContent = waiting.length

  const activeIds = new Set(active.map(s => s.id))

  // Exit bubbles for sessions no longer active (from both containers)
  document.querySelectorAll('#bubble-scroll .agent-bubble').forEach(el => {
    if (!activeIds.has(el.dataset.sid)) {
      el.classList.add('exiting')
      el.addEventListener('transitionend', () => el.remove(), { once: true })
      setTimeout(() => { if (el.parentNode) el.remove() }, 500)
    }
  })

  // Place each active session in the correct container
  active.forEach(s => {
    const targetContainer = isBubbleWaiting(s) ? waitingContainer : cookingContainer
    const otherContainer = isBubbleWaiting(s) ? cookingContainer : waitingContainer
    const category = isBubbleWaiting(s) ? 'waiting' : 'cooking'

    // Find existing bubble in either container
    let el = targetContainer.querySelector(`.agent-bubble[data-sid="${s.id}"]`)
      || otherContainer.querySelector(`.agent-bubble[data-sid="${s.id}"]`)

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
  })
}

function createBubbleElement(session, category) {
  const el = document.createElement('div')
  el.className = `agent-bubble bg-base-100 ${category}`
  el.dataset.sid = session.id
  el.dataset.eventCount = session.eventCount || 0
  el.addEventListener('click', () => bubbleSelectSession(session.id))
  updateBubbleContent(el, session)
  return el
}

function updateBubbleContent(el, session) {
  const icon = session.source === 'claude-code' ? ICON_CLAUDE : session.source === 'opencode' ? ICON_OPENCODE : ICON_OPENAI
  const user = session.metadata?.user
  const userName = user?.githubUsername || user?.name || user?.osUser || ''
  const title = userName || (session.id.length > 14 ? session.id.slice(0, 14) + '..' : session.id)

  const waiting = isBubbleWaiting(session)
  const spinner = !waiting ? '<span class="css-spinner ml-1"></span>' : ''

  const lastLabel = formatSessionLastEvent(session.lastEventType)
  const lastText = session.lastEventText ? esc(truncate(session.lastEventText, 50)) : ''

  const dur = (session.lastEventTime || Date.now()) - session.startTime
  const durStr = dur > 60000 ? Math.floor(dur / 60000) + 'm' : Math.floor(dur / 1000) + 's'

  // Show assistant message for waiting bubbles, activity preview for cooking
  const previewLine = waiting && lastText
    ? `<div class="text-[10px] opacity-60 mt-1 line-clamp-2 leading-snug">${lastText}</div>`
    : lastText
      ? `<div class="text-[10px] opacity-40 truncate">${lastLabel} · ${lastText}</div>`
      : `<div class="text-[10px] opacity-40 truncate">${lastLabel}</div>`

  el.innerHTML = `
    <div class="flex items-center gap-1.5 mb-1">
      <span class="opacity-60 flex-shrink-0">${icon}</span>
      <span class="text-xs font-medium truncate">${esc(title)}</span>
      ${spinner}
    </div>
    ${previewLine}
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

// Init Lucide icons
lucide.createIcons()
