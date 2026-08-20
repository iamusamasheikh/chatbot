'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const config = require('../config');

// SQLite database via Node's built-in node:sqlite (no native compilation needed).
// Schema is simple and portable — migrating to PostgreSQL later is straightforward.

const dbPath = path.join(config.paths.data, 'sites.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id            TEXT PRIMARY KEY,
  owner_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT,
  site_url      TEXT,
  greeting      TEXT,
  knowledge     TEXT,
  trained_at    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id           TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  visitor_name TEXT,
  started_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  text       TEXT NOT NULL,
  mode       TEXT,
  at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  email   TEXT NOT NULL,
  phone   TEXT,
  message TEXT,
  at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics (
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  sessions   INTEGER NOT NULL DEFAULT 0,
  messages   INTEGER NOT NULL DEFAULT 0,
  live_chats INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date)
);

CREATE INDEX IF NOT EXISTS idx_messages_site ON messages(site_id);
CREATE INDEX IF NOT EXISTS idx_sessions_site ON chat_sessions(site_id);
CREATE INDEX IF NOT EXISTS idx_leads_site ON leads(site_id);
`);

// Migrations: safely add columns that newer versions need (idempotent).
function addColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch (e) { /* already exists */ }
  }
}

addColumn('sites', 'theme_color', "TEXT DEFAULT '#2563eb'");
addColumn('sites', 'webhook_url', 'TEXT');
addColumn('sites', 'is_whitelabel', 'INTEGER DEFAULT 0');
addColumn('sites', 'bot_name', "TEXT DEFAULT 'Nova AI'");
addColumn('sites', 'hide_branding', 'INTEGER DEFAULT 0');
addColumn('sites', 'custom_brand_name', 'TEXT');
addColumn('sites', 'custom_brand_url', 'TEXT');
addColumn('sites', 'last_ping_at', 'TEXT');

module.exports = db;