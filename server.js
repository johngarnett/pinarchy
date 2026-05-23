require('dotenv').config()
const express = require('express')
const cookieParser = require('cookie-parser')
const { v4: uuidv4 } = require('uuid')
const path = require('path')

const db = require('./src/db')
const sse = require('./src/sse')

const app = express()
const PORT = process.env.PORT || 3000
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000  // 1 year

app.use(express.json())
app.use(cookieParser())

// Assign visitor cookie before serving anything (must come before static)
app.use((req, res, next) => {
   if (!req.cookies.visitor_id) {
      const id = uuidv4()
      res.cookie('visitor_id', id, { maxAge: COOKIE_MAX_AGE, httpOnly: true })
      req.cookies.visitor_id = id
   }
   next()
})

app.use(express.static(path.join(__dirname, 'public')))

// ── Admin routes ──────────────────────────────────────────────────────────────

app.get('/admin', (req, res) => {
   if (!ADMIN_PASSWORD) {
      return res.status(404).send('Not found')
   }
   if (req.cookies.admin_session === 'true') {
      return res.redirect('/')
   }
   res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

app.post('/admin/login', (req, res) => {
   if (!ADMIN_PASSWORD) {
      return res.status(404).json({ error: 'Not found' })
   }
   const { password } = req.body
   if (password === ADMIN_PASSWORD) {
      res.cookie('admin_session', 'true', { maxAge: COOKIE_MAX_AGE, httpOnly: true })
      return res.json({ ok: true })
   }
   res.status(401).json({ error: 'Incorrect password' })
})

app.post('/admin/logout', (req, res) => {
   res.clearCookie('admin_session')
   res.json({ ok: true })
})

// ── SSE ───────────────────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
   sse.addClient(res)
})

// ── Registrations API ─────────────────────────────────────────────────────────

app.get('/api/registrations', (req, res) => {
   res.json(db.getAllRegistrations())
})

app.put('/api/registrations/:timeslot/:playerNumber', (req, res) => {
   const { timeslot, playerNumber } = req.params
   const { name } = req.body
   const num = parseInt(playerNumber, 10)

   const isAdmin = ADMIN_PASSWORD && req.cookies.admin_session === 'true'
   let result

   if (isAdmin) {
      result = db.adminUpdateRegistration(timeslot, num, name ?? '')
   } else {
      result = db.updateRegistration(timeslot, num, name ?? '', req.cookies.visitor_id)
   }

   if (!result.ok) {
      return res.status(403).json({ error: result.error })
   }

   sse.broadcast('update', db.getAllRegistrations())
   res.json({ ok: true })
})

// ── Config endpoint (exposes feature flags to client) ─────────────────────────

app.get('/api/config', (req, res) => {
   const isAdmin = ADMIN_PASSWORD && req.cookies.admin_session === 'true'
   res.json({
      visitorId: req.cookies.visitor_id,
      isAdmin,
      adminEnabled: !!ADMIN_PASSWORD
   })
})

app.listen(PORT, () => {
   console.log(`Pinarchy running at http://localhost:${PORT}`)
})
