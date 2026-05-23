/* global state */
let visitorId = null
let isAdmin = false
let registrations = []
let pendingSaves = {}   // key: "timeslot|playerNum" → debounce timer id
let localEdits = {}     // key: "timeslot|playerNum" → current input value (while typing)
let inflightSaves = {}  // key: "timeslot|playerNum" → value currently being sent to server

const DEBOUNCE_MS = 3000

// ── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
   const [config, regs] = await Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/registrations').then(r => r.json())
   ])

   visitorId = config.visitorId
   isAdmin = config.isAdmin

   if (isAdmin) {
      document.getElementById('admin-bar').classList.remove('hidden')
   }

   registrations = regs
   renderTable()
   renderPrint()
   connectSSE()

   document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await fetch('/admin/logout', { method: 'POST' })
      window.location.reload()
   })

   // Flush any unsaved edits when the tab/window is closed
   window.addEventListener('beforeunload', () => {
      for (const key of Object.keys(pendingSaves)) {
         clearTimeout(pendingSaves[key])
         delete pendingSaves[key]
         if (key in localEdits) {
            const [timeslot, playerNum] = key.split('|')
            const name = localEdits[key]
            delete localEdits[key]
            fetch(`/api/registrations/${encodeURIComponent(timeslot)}/${playerNum}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ name }),
               keepalive: true
            })
         }
      }
   })
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function connectSSE() {
   const statusEl = document.getElementById('connection-status')
   const evtSource = new EventSource('/api/events')
   let firstOpen = true

   evtSource.addEventListener('init', () => {
      document.body.dataset.sseReady = '1'
   })

   evtSource.addEventListener('patch', (e) => {
      statusEl.classList.add('hidden')
      const { slot, playerNum, name, cookieId } = JSON.parse(e.data)
      mergePatch(slot, playerNum, name, cookieId)
      renderTable()
      renderPrint()
   })

   evtSource.onerror = () => {
      statusEl.classList.remove('hidden')
   }

   evtSource.onopen = () => {
      statusEl.classList.add('hidden')
      if (firstOpen) { firstOpen = false; return }
      // Re-fetch full state after a reconnect to catch any patches missed during the gap
      fetch('/api/registrations').then(r => r.json()).then(regs => {
         registrations = regs
         renderTable()
         renderPrint()
      })
   }
}

// Apply a single-field patch from the server, preserving any active local edits
function mergePatch(slot, playerNum, name, cookieId) {
   const slotData = registrations.find(s => s.slot === slot)
   if (!slotData) return
   slotData.players[playerNum - 1] = { name, cookieId }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
   const tbody = document.getElementById('registrations-body')

   // Snapshot focus before wiping the DOM so we can restore it afterwards
   const prevActive = document.activeElement
   const focusKey = prevActive?.dataset?.key ?? null
   const selStart  = focusKey ? (prevActive.selectionStart ?? 0) : 0
   const selEnd    = focusKey ? (prevActive.selectionEnd   ?? 0) : 0

   tbody.innerHTML = ''

   for (const slotData of registrations) {
      const tr = document.createElement('tr')

      const timeTd = document.createElement('td')
      timeTd.className = 'time-cell'
      timeTd.textContent = slotData.display
      tr.appendChild(timeTd)

      for (let i = 0; i < 2; i++) {
         const player = slotData.players[i] || { name: '', cookieId: null }
         const key = `${slotData.slot}|${i + 1}`
         const td = document.createElement('td')

         const ownerCookieId = player.cookieId
         const ownedByMe = ownerCookieId === visitorId
         const ownedByOther = ownerCookieId && !ownedByMe && ownerCookieId !== '__admin__'

         const input = document.createElement('input')
         input.type = 'text'
         input.className = 'player-input'
         input.placeholder = 'Add name…'
         input.maxLength = 80
         input.dataset.key = key

         const displayName = key in localEdits ? localEdits[key]
            : key in inflightSaves ? inflightSaves[key]
            : player.name
         input.value = displayName

         if (isAdmin) {
            input.readOnly = false
         } else if (ownedByOther) {
            input.readOnly = true
         } else {
            input.readOnly = false
         }

         if (ownedByMe) input.classList.add('owned')

         input.addEventListener('input', () => onInput(input, slotData.slot, i + 1, key))
         input.addEventListener('blur', () => onBlur(key))

         const cell = document.createElement('div')
         cell.className = 'player-cell'
         cell.appendChild(input)

         if (ownedByMe || (isAdmin && player.name)) {
            const clearBtn = document.createElement('button')
            clearBtn.className = 'clear-btn'
            clearBtn.title = 'Clear'
            clearBtn.textContent = '×'
            clearBtn.addEventListener('click', () => {
               input.value = ''
               save(slotData.slot, i + 1, key, '')
            })
            cell.appendChild(clearBtn)
         }

         td.appendChild(cell)
         tr.appendChild(td)
      }

      tbody.appendChild(tr)
   }

   // Restore focus and cursor position if an input was active before the re-render
   if (focusKey) {
      const target = tbody.querySelector(`input[data-key="${CSS.escape(focusKey)}"]`)
      if (target && !target.readOnly) {
         target.focus()
         try { target.setSelectionRange(selStart, selEnd) } catch (_) {}
      }
   }
}

function renderPrint() {
   const tbody = document.getElementById('print-body')
   tbody.innerHTML = ''
   for (const slotData of registrations) {
      const tr = document.createElement('tr')
      const p1 = slotData.players[0]?.name || ''
      const p2 = slotData.players[1]?.name || ''
      tr.innerHTML = `<td>${slotData.display}</td><td>${escHtml(p1)}</td><td>${escHtml(p2)}</td>`
      tbody.appendChild(tr)
   }
}

function escHtml(str) {
   return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Input handling ────────────────────────────────────────────────────────────

function onInput(input, timeslot, playerNumber, key) {
   localEdits[key] = input.value

   clearTimeout(pendingSaves[key])
   pendingSaves[key] = setTimeout(() => {
      delete pendingSaves[key]   // clear before save so a concurrent blur doesn't double-save
      save(timeslot, playerNumber, key, input.value)
   }, DEBOUNCE_MS)
}

function onBlur(key) {
   // Flush immediately on blur only if there is actually a pending local edit.
   // Without the `key in localEdits` guard, a blur fired by renderTable() replacing
   // the DOM (which Chrome does when a focused element is removed) would call save()
   // with an empty string after the debounce had already fired and cleared localEdits.
   if (pendingSaves[key] && key in localEdits) {
      const [timeslot, playerNumber] = key.split('|')
      clearTimeout(pendingSaves[key])
      delete pendingSaves[key]
      save(timeslot, parseInt(playerNumber, 10), key, localEdits[key])
   } else {
      clearTimeout(pendingSaves[key])
      delete pendingSaves[key]
   }
}

async function save(timeslot, playerNumber, key, name) {
   delete localEdits[key]
   inflightSaves[key] = name   // keep the value visible while the fetch is in flight

   const res = await fetch(`/api/registrations/${encodeURIComponent(timeslot)}/${playerNumber}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
   })

   delete inflightSaves[key]

   if (!res.ok) {
      // Revert to the last confirmed server value on error
      renderTable()
      console.warn('Save failed:', await res.json())
   }
   // On success, the SSE broadcast will update the table
}

init()
