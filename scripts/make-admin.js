'use strict';

// Promotes an existing user to super-admin:
//   node scripts/make-admin.js your@email.com

const db = require('../src/db');

const email = (process.argv[2] || '').toLowerCase();
if (!email) {
  console.error('Usage:  node scripts/make-admin.js you@email.com');
  process.exit(1);
}
const r = db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', email);
if (r.changes) console.log(`Promoted ${email} to admin ✅`);
else console.log(`No user found with email ${email}`);