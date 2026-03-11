const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrqcyjhzxdqvarirjcdh.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_BCYYO20bTf_4_dG5otk3vw_yYps1UPr';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory cache
let sharedState = null;

// Load state from Supabase on startup
async function loadState() {
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'main')
    .single();
  if (data && data.data && Object.keys(data.data).length > 0) {
    sharedState = data.data;
    console.log('State loaded from Supabase');
  } else {
    console.log('No saved state found, starting fresh');
  }
}

// Save state to Supabase
async function saveState(state) {
  const { error } = await supabase
    .from('app_state')
    .upsert({ id: 'main', data: state, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase save error:', error.message);
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Client connected. Total: ${clients.size}`);

  // Send current state to new client
  if (sharedState) {
    ws.send(JSON.stringify({ type: 'state', payload: sharedState }));
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'update') {
        sharedState = msg.payload;
        // Save to Supabase
        saveState(sharedState);
        // Broadcast to all OTHER clients
        clients.forEach(client => {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({ type: 'state', payload: sharedState }));
          }
        });
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected. Total: ${clients.size}`);
  });
});

// Load state then start server
loadState().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🏕  IVOW 2026 Server running at:`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   DB:      Supabase connected`);
  });
});
