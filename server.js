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

// Extract STAFF_INIT from index.html so code updates flow into DB
function parseStaffInit() {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const match = html.match(/const STAFF_INIT\s*=\s*(\{[\s\S]*?\n\};)/);
    if (!match) return null;
    // Convert JS object literal to JSON-parseable string
    let raw = match[1].replace(/;\s*$/, '');
    // Add quotes around unquoted keys
    raw = raw.replace(/(\s)(\w[\w-]*)(\s*:)/g, '$1"$2"$3');
    // Replace single quotes with double quotes
    raw = raw.replace(/'/g, '"');
    // Handle trailing commas
    raw = raw.replace(/,(\s*[}\]])/g, '$1');
    // Handle null values
    raw = raw.replace(/:\s*null/g, ':null');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse STAFF_INIT:', e.message);
    return null;
  }
}

// Merge STAFF_INIT defaults into DB state — only fills empty/missing fields
function mergeDefaults(dbState) {
  const defaults = parseStaffInit();
  if (!defaults || !dbState || !dbState.all) return dbState;
  let changed = false;
  for (const [id, def] of Object.entries(defaults)) {
    if (!dbState.all[id]) {
      // New staff member not in DB — add them
      dbState.all[id] = def;
      changed = true;
      console.log(`  Merged new staff: ${def.name}`);
    } else {
      // Existing staff — fill in empty fields only
      for (const [key, val] of Object.entries(def)) {
        if (val && (!dbState.all[id][key] || dbState.all[id][key] === '')) {
          dbState.all[id][key] = val;
          changed = true;
        }
      }
    }
  }
  if (changed) console.log('Merged STAFF_INIT defaults into DB state');
  return dbState;
}

// Load state from Supabase on startup
async function loadState() {
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'main')
    .single();
  if (data && data.data && Object.keys(data.data).length > 0) {
    sharedState = mergeDefaults(data.data);
    // Save merged state back to DB
    await saveState(sharedState);
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
loadState().catch(err => {
  console.error('Failed to load state from Supabase:', err.message);
}).finally(() => {
  server.listen(PORT, () => {
    console.log(`\n🏕  IVOW 2026 Server running at:`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   DB:      Supabase connected`);
  });
});
