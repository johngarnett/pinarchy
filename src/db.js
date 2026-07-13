const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = path.join(__dirname, '..', 'data', 'pinarchy.db')

// Schedule config. Defaults match the standard tournament; each can be
// overridden with an environment variable (change + restart, no code edit).
// SLOT_START accepts "HH:MM" (24h), e.g. SLOT_START=10:30 to open earlier.
const DEFAULT_SLOT_START_MINUTES = 11 * 60       // 11:00am in minutes
const DEFAULT_SLOT_DURATION_MINUTES = 10
const DEFAULT_NUM_TIMESLOTS = 18
const MAX_TIMESLOTS = 21          // guard against a typo seeding a runaway number of slots
const PLAYERS_PER_SLOT = 2

function parseStartMinutes(value) {
   if (!value) return DEFAULT_SLOT_START_MINUTES
   const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
   if (!match) throw new Error(`Invalid SLOT_START "${value}" — expected HH:MM (24-hour)`)
   const [h, m] = [Number(match[1]), Number(match[2])]
   if (h > 23 || m > 59) throw new Error(`Invalid SLOT_START "${value}" — hour must be 0-23, minute 0-59`)
   return h * 60 + m
}

function parsePositiveInt(value, fallback, label, max) {
   if (value === undefined || value === '') return fallback
   const n = Number(value)
   if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid ${label} "${value}" — expected a positive integer`)
   if (max !== undefined && n > max) throw new Error(`Invalid ${label} "${value}" — must be ${max} or fewer`)
   return n
}

const SLOT_START_MINUTES = parseStartMinutes(process.env.SLOT_START)
const SLOT_DURATION_MINUTES = parsePositiveInt(process.env.SLOT_DURATION_MINUTES, DEFAULT_SLOT_DURATION_MINUTES, 'SLOT_DURATION_MINUTES')
const NUM_TIMESLOTS = parsePositiveInt(process.env.NUM_TIMESLOTS, DEFAULT_NUM_TIMESLOTS, 'NUM_TIMESLOTS', MAX_TIMESLOTS)

function generateTimeslots() {
   const slots = []
   const endMinutes = SLOT_START_MINUTES + (NUM_TIMESLOTS - 1) * SLOT_DURATION_MINUTES
   for (let m = SLOT_START_MINUTES; m <= endMinutes; m += SLOT_DURATION_MINUTES) {
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

   return { ok: true, name: trimmed, cookieId: newCookieId, oldName: existing.player_name }
}

function adminUpdateRegistration(timeslot, playerNumber, name) {
   if (!TIMESLOTS.includes(timeslot)) return { ok: false, error: 'Invalid timeslot' }
   if (playerNumber !== 1 && playerNumber !== 2) return { ok: false, error: 'Invalid player number' }

   const db = getDb()
   const existing = db.prepare('SELECT player_name FROM registrations WHERE timeslot = ? AND player_number = ?').get(timeslot, playerNumber)
   const trimmed = name.trim()
   const newCookieId = trimmed === '' ? null : '__admin__'
   db.prepare('UPDATE registrations SET player_name = ?, cookie_id = ? WHERE timeslot = ? AND player_number = ?')
      .run(trimmed, newCookieId, timeslot, playerNumber)

   return { ok: true, name: trimmed, cookieId: newCookieId, oldName: existing?.player_name ?? '' }
}

module.exports = { getAllRegistrations, updateRegistration, adminUpdateRegistration, TIMESLOTS, formatDisplayTime }
