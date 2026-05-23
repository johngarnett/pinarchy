/* global state */
let visitorId = null
let isAdmin = false
let registrations = []
let pendingSaves = {}   // key: "timeslot|playerNum" → debounce timer id
let localEdits = {}     // key: "timeslot|playerNum" → current input value (while typing)

const DEBOUNCE_MS = 800

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
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function connectSSE() {
   const statusEl = document.getElementById('connection-status')
   const evtSource = new EventSource('/api/events')

   evtSource.addEventListener('update', (e) => {
      statusEl.classList.add('hidden')
      const incoming = JSON.parse(e.data)
      mergeIncoming(incoming)
      renderTable()
      renderPrint()
   })

   evtSource.onerror = () => {
      statusEl.classList.remove('hidden')
   }

   evtSource.onopen = () => {
      statusEl.classList.add('hidden')
   }
}

// Merge server data while preserving any in-flight local edits
function mergeIncoming(incoming) {
   registrations = incoming.map(slotData => {
      const merged = { ...slotData }
      merged.players = slotData.players.map((player, idx) => {
         const key = `${slotData.slot}|${idx + 1}`
         if (key in localEdits) {
            // User is actively editing — keep their local value for display
            return { ...player, localName: localEdits[key] }
         }
         return player
      })
      return merged
   })
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
   const tbody = document.getElementById('registrations-body')
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
         // Only block editing if we know who we are; if visitorId is still null, default to open
         const ownedByOther = ownerCookieId && visitorId && !ownedByMe && ownerCookieId !== '__admin__'

         const input = document.createElement('input')
         input.type = 'text'
         input.className = 'player-input'
         input.placeholder = 'Add name…'
         input.maxLength = 80

         const displayName = key in localEdits ? localEdits[key] : player.name
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

   const res = await fetch(`/api/registrations/${encodeURIComponent(timeslot)}/${playerNumber}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
   })

   if (!res.ok) {
      // Revert the input to the last known server value on error
      const serverSlot = registrations.find(s => s.slot === timeslot)
      const serverName = serverSlot?.players[playerNumber - 1]?.name ?? ''
      // Re-render will pick up server state
      renderTable()
      console.warn('Save failed:', await res.json())
   }
   // On success, the SSE broadcast will update the table
}

init()
