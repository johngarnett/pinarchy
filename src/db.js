const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = path.join(__dirname, '..', 'data', 'pinarchy.db')

const SLOT_START_MINUTES = 11 * 60 + 30  // 11:30am in minutes
const SLOT_END_MINUTES = 15 * 60         // 3:00pm in minutes
const SLOT_DURATION_MINUTES = 10
const PLAYERS_PER_SLOT = 2

function generateTimeslots() {
   const slots = []
   for (let m = SLOT_START_MINUTES; m <= SLOT_END_MINUTES; m += SLOT_DURATION_MINUTES) {
      const hours = Math.floor(m / 60)
      const minutes = m % 60
      const label = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
      slots.push(label)
   }
   return slots
}

const TIMESLOTS = generateTimeslots()

function formatDisplayTime(slot) {
   const [h, m] = slot.split(':').map(Number)
   const period = h >= 12 ? 'pm' : 'am'
   const displayHour = h > 12 ? h - 12 : h
   return `${displayHour}:${m.toString().padStart(2, '0')}${period}`
}

let db

function getDb() {
   if (!db) {
      const fs = require('fs')
      const dataDir = path.join(__dirname, '..', 'data')
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

      db = new Database(DB_PATH)
      db.pragma('journal_mode = WAL')

      db.exec(`
         CREATE TABLE IF NOT EXISTS registrations (
            timeslot TEXT NOT NULL,
            player_number INTEGER NOT NULL,
            player_name TEXT NOT NULL DEFAULT '',
            cookie_id TEXT,
            PRIMARY KEY (timeslot, player_number)
         )
      `)

      // Seed all timeslot rows so they always exist
      const insert = db.prepare(`
         INSERT OR IGNORE INTO registrations (timeslot, player_number, player_name, cookie_id)
         VALUES (?, ?, '', NULL)
      `)
      const seedAll = db.transaction(() => {
         for (const slot of TIMESLOTS) {
            for (let p = 1; p <= PLAYERS_PER_SLOT; p++) {
               insert.run(slot, p)
            }
         }
      })
      seedAll()
   }
   return db
}

function getAllRegistrations() {
   const db = getDb()
   const rows = db.prepare('SELECT timeslot, player_number, player_name, cookie_id FROM registrations ORDER BY timeslot, player_number').all()
   // Group by timeslot
   const map = {}
   for (const slot of TIMESLOTS) {
      map[slot] = { display: formatDisplayTime(slot), players: [] }
   }
   for (const row of rows) {
      if (map[row.timeslot]) {
         map[row.timeslot].players[row.player_number - 1] = {
            name: row.player_name,
            cookieId: row.cookie_id
         }
      }
   }
   return TIMESLOTS.map(slot => ({ slot, ...map[slot] }))
}

function updateRegistration(timeslot, playerNumber, name, cookieId) {
   if (!TIMESLOTS.includes(timeslot)) return { ok: false, error: 'Invalid timeslot' }
   if (playerNumber !== 1 && playerNumber !== 2) return { ok: false, error: 'Invalid player number' }

   const db = getDb()
   const existing = db.prepare('SELECT cookie_id, player_name FROM registrations WHERE timeslot = ? AND player_number = ?').get(timeslot, playerNumber)

   if (!existing) return { ok: false, error: 'Slot not found' }

   // If the field has an owner and this isn't them, deny
   if (existing.cookie_id && existing.cookie_id !== cookieId) {
      return { ok: false, error: 'Not authorized to edit this field' }
   }

   const trimmed = name.trim()
   const newCookieId = trimmed === '' ? null : cookieId
   db.prepare('UPDATE registrations SET player_name = ?, cookie_id = ? WHERE timeslot = ? AND player_number = ?')
      .run(trimmed, newCookieId, timeslot, playerNumber)

   return { ok: true, name: trimmed, cookieId: newCookieId }
}

function adminUpdateRegistration(timeslot, playerNumber, name) {
   if (!TIMESLOTS.includes(timeslot)) return { ok: false, error: 'Invalid timeslot' }
   if (playerNumber !== 1 && playerNumber !== 2) return { ok: false, error: 'Invalid player number' }

   const db = getDb()
   const trimmed = name.trim()
   const newCookieId = trimmed === '' ? null : '__admin__'
   db.prepare('UPDATE registrations SET player_name = ?, cookie_id = ? WHERE timeslot = ? AND player_number = ?')
      .run(trimmed, newCookieId, timeslot, playerNumber)

   return { ok: true, name: trimmed, cookieId: newCookieId }
}

module.exports = { getAllRegistrations, updateRegistration, adminUpdateRegistration, TIMESLOTS, formatDisplayTime }
