const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const RETAIN_DAYS = 14

const DB_PATH    = path.join(__dirname, '..', 'data', 'pinarchy.db')
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups')

fs.mkdirSync(BACKUP_DIR, { recursive: true })

const date       = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
const backupPath = path.join(BACKUP_DIR, `pinarchy-${date}.db`)

const db = new Database(DB_PATH)

db.backup(backupPath)
   .then(() => {
      console.log(`[${new Date().toISOString()}] Backup saved: ${backupPath}`)
      pruneOldBackups()
      db.close()
   })
   .catch(err => {
      console.error(`[${new Date().toISOString()}] Backup failed:`, err.message)
      db.close()
      process.exit(1)
   })

function pruneOldBackups() {
   const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000
   const files = fs.readdirSync(BACKUP_DIR).filter(f => /^pinarchy-\d{4}-\d{2}-\d{2}\.db$/.test(f))

   for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file)
      if (fs.statSync(filePath).mtimeMs < cutoff) {
         fs.unlinkSync(filePath)
         console.log(`[${new Date().toISOString()}] Pruned old backup: ${file}`)
      }
   }
}
