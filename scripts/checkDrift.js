#!/usr/bin/env node
// Are the files this repo copied byte-for-byte from test_all_aroflo still
// identical to their source? Run after changing reporting/tools/auth code in
// either repo: `npm run check-drift`.
//
// Source repo defaults to a sibling folder; override with TEST_ALL_AROFLO_DIR.
// Line endings are ignored (git may check the two repos out differently).
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const SOURCE = process.env.TEST_ALL_AROFLO_DIR || path.join(HERE, '..', 'test_all_aroflo');

// Copied unchanged. A directory entry means every file under it.
const VERBATIM = [
  'src/logger.js',
  'src/zoneFetch.js',
  'src/payments.js',
  'src/kpi.js',
  'src/aroflo/aroFloDates.js',
  'src/aroflo/errors.js',
  'src/aroflo/signing.js',
  'src/auth/db.js',
  'src/auth/middleware.js',
  'src/auth/passwords.js',
  'src/auth/routes.js',
  'src/auth/sessions.js',
  'frontend/tsconfig.json',
  'frontend/src/main.tsx',
  'frontend/src/index.css',
  'frontend/src/nav.ts',
  'frontend/src/lib/csv.ts',
  'frontend/src/hooks/useMediaQuery.ts',
  'frontend/src/components/Modal.tsx',
  'frontend/src/components/NavSettingsModal.tsx',
  'frontend/src/services/api.ts',
  'frontend/src/services/auth.ts',
  'frontend/src/services/navConfig.ts',
  'frontend/src/services/reportingClients.ts',
  'frontend/src/services/reportingConfig.ts',
  'frontend/src/services/reportingEdits.ts',
  'frontend/src/services/reportingInvoicing.ts',
  'frontend/src/services/reportingKpis.ts',
  'frontend/src/services/reportingOverdue.ts',
  'frontend/src/reporting',
  'frontend/src/tools',
];

// Under a VERBATIM directory but deliberately edited here (the overdue
// table's "Assigned" column is dropped — see README).
const EDITED = new Set([
  'frontend/src/reporting/types.ts',
  'frontend/src/reporting/overdueAgeing/OverdueAgeingSection.tsx',
]);

function walk(rel) {
  const full = path.join(HERE, rel);
  if (!fs.statSync(full).isDirectory()) return [rel];
  return fs.readdirSync(full).flatMap((name) => walk(`${rel}/${name}`));
}

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

if (!fs.existsSync(SOURCE)) {
  console.error(`Source repo not found at ${SOURCE} — set TEST_ALL_AROFLO_DIR.`);
  process.exit(2);
}

const files = VERBATIM.flatMap(walk).filter((rel) => !EDITED.has(rel));
const drifted = [];
const missing = [];
for (const rel of files) {
  const src = path.join(SOURCE, rel);
  if (!fs.existsSync(src)) missing.push(rel);
  else if (read(src) !== read(path.join(HERE, rel))) drifted.push(rel);
}

console.log(`${files.length} copied files checked against ${SOURCE}`);
for (const rel of missing) console.log(`  missing in source: ${rel}`);
for (const rel of drifted) console.log(`  DRIFTED: ${rel}`);
if (drifted.length || missing.length) process.exit(1);
console.log('  all identical');
