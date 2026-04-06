require('dotenv').config();
const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const { Parser: Json2CsvParser } = require('json2csv');
const { Client } = require('@hubspot/api-client');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Multer config for CSV uploads
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── CSV Upload & Parse ─────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const results = [];
  const headers = [];

  fs.createReadStream(req.file.path)
    .pipe(csvParser())
    .on('headers', (h) => headers.push(...h))
    .on('data', (row) => results.push(row))
    .on('end', () => {
      // Clean up uploaded file
      fs.unlink(req.file.path, () => {});
      res.json({ headers, rows: results, count: results.length });
    })
    .on('error', (err) => {
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: 'Failed to parse CSV: ' + err.message });
    });
});

// ─── Name Parsing ───────────────────────────────────────────────────
const PREFIXES = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'sir', 'hon', 'judge']);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'esq', 'md', 'phd', 'dds', 'dvm']);

function parseName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { prefix: '', firstName: '', middleName: '', lastName: '', suffix: '' };
  }

  let name = fullName.trim().replace(/\s+/g, ' ');
  let prefix = '', suffix = '', firstName = '', middleName = '', lastName = '';

  // Handle "Last, First Middle" format
  if (name.includes(',')) {
    const [lastPart, ...rest] = name.split(',').map(s => s.trim());
    const firstParts = rest.join(' ').trim();
    name = firstParts + ' ' + lastPart;
  }

  const parts = name.split(' ');

  // Extract prefix
  if (parts.length > 1 && PREFIXES.has(parts[0].toLowerCase().replace(/\./g, ''))) {
    prefix = parts.shift();
  }

  // Extract suffix
  if (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1].toLowerCase().replace(/\./g, ''))) {
    suffix = parts.pop();
  }

  if (parts.length === 1) {
    firstName = parts[0];
  } else if (parts.length === 2) {
    firstName = parts[0];
    lastName = parts[1];
  } else {
    firstName = parts[0];
    lastName = parts[parts.length - 1];
    middleName = parts.slice(1, -1).join(' ');
  }

  return { prefix, firstName, middleName, lastName, suffix };
}

app.post('/api/parse-names', (req, res) => {
  const { rows, nameField } = req.body;
  if (!rows || !nameField) return res.status(400).json({ error: 'rows and nameField required' });

  const parsed = rows.map(row => {
    const { prefix, firstName, middleName, lastName, suffix } = parseName(row[nameField]);
    return {
      ...row,
      _prefix: prefix,
      _firstName: firstName,
      _middleName: middleName,
      _lastName: lastName,
      _suffix: suffix
    };
  });

  res.json({ rows: parsed });
});

// ─── Property Field Mapping ─────────────────────────────────────────
// 4 address types: Primary, Listing, STR/LTR, Agent
const ADDRESS_TYPES = {
  primary: {
    street: 'address', city: 'city', state: 'state', zip: 'zip', county: 'county'
  },
  listing: {
    street: 'listing_address', city: 'listing_city', state: 'listing_state',
    zip: 'listing_zip', county: 'listing_county'
  },
  str_ltr: {
    street: 'str_ltr_address', city: 'str_ltr_city', state: 'str_ltr_state',
    zip: 'str_ltr_zip', county: 'str_ltr_county'
  },
  agent: {
    street: 'agent_address', city: 'agent_city', state: 'agent_state',
    zip: 'agent_zip', county: 'agent_county'
  }
};

app.get('/api/field-mappings', (req, res) => {
  res.json({
    addressTypes: ADDRESS_TYPES,
    hubspotContactFields: [
      'email', 'firstname', 'lastname', 'phone', 'mobilephone', 'company',
      'address', 'city', 'state', 'zip', 'country',
      'jobtitle', 'lifecyclestage', 'hs_lead_status'
    ]
  });
});

app.post('/api/map-fields', (req, res) => {
  const { rows, mappings } = req.body;
  if (!rows || !mappings) return res.status(400).json({ error: 'rows and mappings required' });

  const mapped = rows.map(row => {
    const result = {};
    for (const [hubspotField, csvField] of Object.entries(mappings)) {
      if (csvField && row[csvField] !== undefined) {
        result[hubspotField] = row[csvField];
      }
    }
    return result;
  });

  res.json({ rows: mapped });
});

// ─── Deduplication ──────────────────────────────────────────────────
app.post('/api/deduplicate', (req, res) => {
  const { rows, keys } = req.body;
  if (!rows) return res.status(400).json({ error: 'rows required' });

  const dedupeKeys = keys || ['email'];
  const seen = new Map();
  const unique = [];
  const duplicates = [];

  rows.forEach(row => {
    const key = dedupeKeys.map(k => (row[k] || '').toString().toLowerCase().trim()).join('|');
    if (!key || key === dedupeKeys.map(() => '').join('|')) {
      unique.push(row); // Keep rows with empty keys
    } else if (seen.has(key)) {
      duplicates.push({ row, duplicateOf: seen.get(key) });
    } else {
      seen.set(key, unique.length);
      unique.push(row);
    }
  });

  res.json({ unique, duplicates, stats: { total: rows.length, unique: unique.length, duplicates: duplicates.length } });
});

// ─── AB Split ───────────────────────────────────────────────────────
app.post('/api/ab-split', (req, res) => {
  const { rows, holdoutPercent = 20 } = req.body;
  if (!rows) return res.status(400).json({ error: 'rows required' });

  // Shuffle
  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  const holdoutCount = Math.round(shuffled.length * (holdoutPercent / 100));
  const holdout = shuffled.slice(0, holdoutCount);
  const active = shuffled.slice(holdoutCount);

  // Split active 50/50
  const midpoint = Math.ceil(active.length / 2);
  const groupA = active.slice(0, midpoint).map(r => ({ ...r, _abGroup: 'A' }));
  const groupB = active.slice(midpoint).map(r => ({ ...r, _abGroup: 'B' }));
  const holdoutLabeled = holdout.map(r => ({ ...r, _abGroup: 'Holdout' }));

  res.json({
    groupA,
    groupB,
    holdout: holdoutLabeled,
    stats: {
      total: rows.length,
      holdout: holdoutCount,
      holdoutPercent,
      groupA: groupA.length,
      groupB: groupB.length
    }
  });
});

// ─── Labeling System ────────────────────────────────────────────────
const LABEL_OPTIONS = {
  sources: ['OwnerPoint', 'MLS', 'Zillow', 'Realtor.com', 'Referral', 'Direct Mail', 'Cold Call', 'Door Knock', 'Website', 'Social Media'],
  contactTypes: ['Property Owner', 'Agent', 'Investor', 'Tenant', 'Vendor', 'Lead', 'Past Client'],
  propertyTypes: ['SFR', 'Multi-Family', 'Condo', 'Townhouse', 'Land', 'Commercial', 'STR', 'LTR', 'Mixed Use'],
  departments: ['Sales', 'Marketing', 'Operations', 'Property Management', 'Acquisitions', 'Dispositions'],
  statuses: ['New', 'Contacted', 'Qualified', 'Nurturing', 'Under Contract', 'Closed', 'Dead']
};

app.get('/api/labels', (req, res) => {
  res.json(LABEL_OPTIONS);
});

app.post('/api/apply-labels', (req, res) => {
  const { rows, labels } = req.body;
  if (!rows || !labels) return res.status(400).json({ error: 'rows and labels required' });

  const labeled = rows.map(row => ({
    ...row,
    ...Object.fromEntries(Object.entries(labels).map(([k, v]) => [`_label_${k}`, v]))
  }));

  res.json({ rows: labeled });
});

// ─── List Naming Convention ─────────────────────────────────────────
// Format: DEPT-TYPE-Source-Date-Description
app.post('/api/validate-list-name', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const pattern = /^[A-Z]{2,5}-[A-Z]{2,5}-[A-Za-z0-9]+-\d{4}[01]\d[0-3]\d-.+$/;
  const isValid = pattern.test(name);

  const parts = name.split('-');
  const feedback = {
    isValid,
    parts: {
      department: parts[0] || '',
      type: parts[1] || '',
      source: parts[2] || '',
      date: parts[3] || '',
      description: parts.slice(4).join('-') || ''
    }
  };

  if (!isValid) {
    feedback.suggestion = 'Format: DEPT-TYPE-Source-YYYYMMDD-Description';
    feedback.example = 'MKT-OWNER-OwnerPoint-20260404-Orlando_SFR_Absentee';
  }

  res.json(feedback);
});

// ─── Export CSV ──────────────────────────────────────────────────────
app.post('/api/export-csv', (req, res) => {
  const { rows, fields } = req.body;
  if (!rows || rows.length === 0) return res.status(400).json({ error: 'No data to export' });

  try {
    const parser = new Json2CsvParser({ fields: fields || Object.keys(rows[0]) });
    const csv = parser.parse(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=hubspot_import.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ─── HubSpot Batch Import ───────────────────────────────────────────
app.post('/api/hubspot/import', async (req, res) => {
  const { contacts } = req.body;
  if (!contacts || contacts.length === 0) {
    return res.status(400).json({ error: 'No contacts to import' });
  }

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'HUBSPOT_ACCESS_TOKEN not configured' });
  }

  const hubspotClient = new Client({ accessToken: token });
  const BATCH_SIZE = 100;
  const results = { created: 0, errors: [] };

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(contact => ({ properties: contact }));

    try {
      const response = await hubspotClient.crm.contacts.batchApi.create({ inputs });
      results.created += response.results.length;
    } catch (err) {
      const msg = err.body?.message || err.message || 'Unknown error';
      results.errors.push({ batch: Math.floor(i / BATCH_SIZE) + 1, error: msg, count: batch.length });
    }
  }

  res.json({
    success: results.errors.length === 0,
    created: results.created,
    total: contacts.length,
    errors: results.errors
  });
});

// ─── HubSpot Connection Test ────────────────────────────────────────
app.get('/api/hubspot/test', async (req, res) => {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return res.json({ connected: false, error: 'No access token configured' });

  try {
    const hubspotClient = new Client({ accessToken: token });
    const response = await hubspotClient.crm.contacts.basicApi.getPage(1);
    res.json({ connected: true, message: 'Connected to HubSpot' });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// ─── Start Server ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nHubSpot Data Manager running at:`);
  console.log(`  Local: http://localhost:${PORT}`);
  console.log(`  HubSpot: ${process.env.HUBSPOT_ACCESS_TOKEN ? 'Token configured' : 'No token (set HUBSPOT_ACCESS_TOKEN)'}\n`);
});
