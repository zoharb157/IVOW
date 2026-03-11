const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrqcyjhzxdqvarirjcdh.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_BCYYO20bTf_4_dG5otk3vw_yYps1UPr';

let supabase;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (err) {
  console.error('Failed to create Supabase client:', err.message);
}

let sharedState = null;
let saveTimer = null;

// Extract STAFF_INIT from index.html so code updates flow into DB
function parseStaffInit() {
  try {
    const vm = require('vm');
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const match = html.match(/const STAFF_INIT\s*=\s*(\{[\s\S]*?\n\};)/);
    if (!match) return null;
    return vm.runInNewContext('(' + match[1].replace(/;\s*$/, '') + ')');
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
      dbState.all[id] = def;
      changed = true;
      console.log(`  Merged new staff: ${def.name}`);
    } else {
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

async function loadState() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'main')
    .single();

  if (error) {
    console.warn('Supabase load warning:', error.message);
    return;
  }

  if (data?.data && Object.keys(data.data).length > 0) {
    sharedState = mergeDefaults(data.data);
    await saveState(sharedState);
    const staffCount = sharedState.all ? Object.keys(sharedState.all).length : 0;
    const teamCount = sharedState.teams ? sharedState.teams.length : 0;
    console.log(`State loaded from Supabase (${staffCount} staff, ${teamCount} teams)`);
  } else {
    console.log('No saved state found — first client to connect will seed the DB');
  }
}

function debouncedSave(state) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state), 150);
}

async function saveState(state) {
  if (!supabase) return;
  const { error } = await supabase
    .from('app_state')
    .upsert({ id: 'main', data: state, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase save error:', error.message);
}

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    return;
  }

  const safePath = path.normalize(req.url).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, 'public', safePath);
  const ext = path.extname(filePath).toLowerCase();

  if (MIME[ext] && fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Client connected (${clients.size} total)`);

  if (sharedState) {
    ws.send(JSON.stringify({ type: 'state', payload: sharedState }));
  } else {
    ws.send(JSON.stringify({ type: 'need_init' }));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'update' && msg.payload) {
        sharedState = msg.payload;
        debouncedSave(sharedState);
        clients.forEach(client => {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({ type: 'state', payload: sharedState }));
          }
        });
      }
    } catch (e) {
      console.error('Bad WS message:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected (${clients.size} total)`);
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
    clients.delete(ws);
  });
});

loadState().catch(err => {
  console.error('Failed to load state from Supabase:', err.message);
}).finally(() => {
  server.listen(PORT, () => {
    console.log(`\n🏕  IVOW 2026 Server running at:`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   DB:      ${supabase ? 'Supabase connected' : 'Supabase unavailable'}`);
  });
});
