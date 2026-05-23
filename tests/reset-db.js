const Database = require('better-sqlite3')
const path = require('path')

const rawDb = new Database(path.join(__dirname, '..', 'data', 'pinarchy.db'))
rawDb.prepare("UPDATE registrations SET player_name = '', cookie_id = NULL").run()
rawDb.close()
