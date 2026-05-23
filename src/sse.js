const clients = new Set()

function addClient(res) {
   res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
   })
   res.flushHeaders()

   // Keep-alive ping every 25 seconds
   const pingInterval = setInterval(() => {
      res.write(': ping\n\n')
   }, 25000)

   clients.add(res)

   res.on('close', () => {
      clearInterval(pingInterval)
      clients.delete(res)
   })
}

function broadcast(event, data) {
   const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
   for (const client of clients) {
      client.write(payload)
   }
}

module.exports = { addClient, broadcast }
