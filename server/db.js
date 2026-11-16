'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash    TEXT NOT NULL,
  must_change_pw   INTEGER NOT NULL DEFAULT 0,
  role             TEXT NOT NULL DEFAULT 'barber' CHECK (role IN ('owner','barber')),
  title            TEXT NOT NULL DEFAULT '',
  bio              TEXT NOT NULL DEFAULT '',
  instagram        TEXT NOT NULL DEFAULT '',
  photo_url        TEXT NOT NULL DEFAULT '',
  color            TEXT NOT NULL DEFAULT '#6b4f9e',
  accepts_bookings INTEGER NOT NULL DEFAULT 1,
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  feed_token       TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'Cuts',
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  buffer_min   INTEGER NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  price_from   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Which services each stylist offers, with optional personal price/duration.
CREATE TABLE IF NOT EXISTS staff_services (
  staff_id     INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id   INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  price_cents  INTEGER,
  duration_min INTEGER,
  PRIMARY KEY (staff_id, service_id)
);

-- Weekly recurring hours. Multiple rows per weekday = split shift / lunch break.
CREATE TABLE IF NOT EXISTS working_hours (
  id        INTEGER PRIMARY KEY,
  staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday   INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,
  end_min   INTEGER NOT NULL,
  CHECK (end_min > start_min)
);

-- Days off / blocked time. NULL start/end = whole day(s).
CREATE TABLE IF NOT EXISTS time_off (
  id         INTEGER PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date_start TEXT NOT NULL,
  date_end   TEXT NOT NULL,
  start_min  INTEGER,
  end_min    INTEGER,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  phone      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS clients_phone ON clients(phone);

CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY,
  staff_id     INTEGER NOT NULL REFERENCES staff(id),
  service_id   INTEGER NOT NULL REFERENCES services(id),
  client_id    INTEGER NOT NULL REFERENCES clients(id),
  date         TEXT NOT NULL,
  start_min    INTEGER NOT NULL,
  end_min      INTEGER NOT NULL,
  buffer_min   INTEGER NOT NULL DEFAULT 0,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'booked'
               CHECK (status IN ('booked','completed','cancelled','no_show')),
  client_notes TEXT NOT NULL DEFAULT '',
  staff_notes  TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online','staff')),
  token        TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS appt_staff_date ON appointments(staff_id, date);
CREATE INDEX IF NOT EXISTS appt_date ON appointments(date);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
`;

const DEFAULT_SETTINGS = {
  shop_name: 'The Shoppe at Castle',
  tagline: 'Femme-owned hair studio in Butcher’s Hill',
  address_line1: '2027 East Lombard Street',
  address_line2: 'Baltimore, MD 21231',
  neighborhood: 'Butcher’s Hill',
  phone: '',
  email: '',
  instagram: 'theshoppeatcastle',
  timezone: 'America/New_York',
  slot_interval_min: 15,
  min_notice_min: 120,
  max_days_ahead: 60,
  cancel_cutoff_hours: 24,
  booking_enabled: true,
  booking_note: 'Appointment only. Please arrive with clean, dry hair unless your service includes a wash.',
  cancellation_policy: 'Need to cancel or reschedule? Use the link in your confirmation at least 24 hours before your appointment. Late cancellations and no-shows may be asked for a deposit next time.',
  announcement: '',
};

function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  // Fill in any settings that don't exist yet (new keys added in later versions).
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, JSON.stringify(v));

  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

function getSettings(db) {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = JSON.parse(row.value);
  return out;
}

function saveSettings(db, patch) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v));
}

/**
 * First-run seed: the two stylists from Instagram, a starter service menu and
 * Tue–Sat hours. Everything here is editable from the staff dashboard.
 * Returns the generated temporary passwords so they can be printed once.
 */
function seed(db, { password } = {}) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;
  if (count > 0) return null;

  const services = [
    // name, category, minutes, buffer, price $, "starting at", description
    ['Custom Haircut', 'Cuts', 60, 0, 60, 0, 'Consultation, precision cut and finish — shears, clippers or both. Any length, any style.'],
    ['Fade or Taper', 'Cuts', 45, 0, 45, 0, 'Skin, low, mid or high fade, burst or taper, finished with a crisp line-up.'],
    ['Clipper Cut / Buzz', 'Cuts', 30, 0, 30, 0, 'One- or two-guard all over, edged and cleaned up.'],
    ['Mullet & Shag', 'Cuts', 60, 0, 65, 0, 'Textured, layered and lived-in. Wolf cuts, modern mullets and shags.'],
    ['Head Shave', 'Cuts', 30, 0, 35, 0, 'Smooth all-over clipper shave with a hot towel finish.'],
    ['Beard Trim & Line-Up', 'Grooming', 20, 0, 20, 0, 'Shape-up, edges and neckline.'],
    ['Hair Design Add-On', 'Grooming', 15, 0, 10, 1, 'Freehand parts and lines added to any cut.'],
    ['Color Consultation', 'Color', 15, 0, 0, 0, 'Talk through goals, history and budget before a color service. Free.'],
    ['All-Over Color', 'Color', 120, 15, 110, 1, 'Single-process root-to-ends color. Final price depends on length and density.'],
    ['Vivid / Fashion Color', 'Color', 180, 15, 160, 1, 'Lavender, silver, blue — lightening plus a vivid or pastel tone. Consultation recommended.'],
    ['Bleach & Tone', 'Color', 150, 15, 140, 1, 'Lift and tone for platinum, silver or a clean base for vivids.'],
    ['Gloss / Toner Refresh', 'Color', 45, 0, 45, 0, 'Refresh faded color and add shine between appointments.'],
  ];
  const insSvc = db.prepare(`INSERT INTO services (name, category, duration_min, buffer_min, price_cents, price_from, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const svcIds = {};
  services.forEach(([name, cat, dur, buf, price, from, desc], i) => {
    svcIds[name] = Number(insSvc.run(name, cat, dur, buf, price * 100, from, desc, i).lastInsertRowid);
  });

  const staff = [
    {
      name: 'Mia', slug: 'mia', email: 'mia@theshoppeatcastle.com', title: 'Stylist & Co-Owner',
      instagram: 'miaelizabethbailey', color: '#7b5ea7', role: 'owner',
      bio: 'Mia specializes in lived-in color, vivids and soft, textured cuts. Bio coming soon.',
      services: ['Custom Haircut', 'Mullet & Shag', 'Clipper Cut / Buzz', 'Color Consultation', 'All-Over Color',
        'Vivid / Fashion Color', 'Bleach & Tone', 'Gloss / Toner Refresh'],
    },
    {
      name: 'Rae', slug: 'rae', email: 'rae@theshoppeatcastle.com', title: 'Barber & Co-Owner',
      instagram: 'raefunkfades', color: '#2f7d6d', role: 'owner',
      bio: 'Rae brings precision fades, sharp parts and modern mullets to every chair. Bio coming soon.',
      services: ['Custom Haircut', 'Fade or Taper', 'Clipper Cut / Buzz', 'Mullet & Shag', 'Head Shave',
        'Beard Trim & Line-Up', 'Hair Design Add-On'],
    },
  ];
  const insStaff = db.prepare(`INSERT INTO staff (name, slug, email, password_hash, must_change_pw, role, title, bio, instagram, color, sort_order, feed_token)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`);
  const insSS = db.prepare('INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)');
  const insHours = db.prepare('INSERT INTO working_hours (staff_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');
  const creds = [];
  staff.forEach((s, i) => {
    const pw = password || token(9);
    const id = Number(insStaff.run(s.name, s.slug, s.email, hashPassword(pw), s.role, s.title, s.bio, s.instagram, s.color, i, token()).lastInsertRowid);
    creds.push({ email: s.email, password: pw });
    for (const name of s.services) insSS.run(id, svcIds[name]);
    for (const wd of [2, 3, 4, 5]) insHours.run(id, wd, 10 * 60, 18 * 60); // Tue–Fri 10–6
    insHours.run(id, 6, 9 * 60, 16 * 60); // Sat 9–4
  });
  return creds;
}

module.exports = { open, seed, getSettings, saveSettings, token, DEFAULT_SETTINGS };
