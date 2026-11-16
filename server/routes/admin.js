'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { getSettings, saveSettings, DEFAULT_SETTINGS, token } = require('../db');
const auth = require('../auth');
const sched = require('../scheduling');
const notify = require('../notify');
const { isValidDate, addDays, nowInZone } = require('../time');

const STAFF_FIELDS = 'id, name, slug, email, role, title, bio, instagram, photo_url, color, accepts_bookings, active, sort_order, must_change_pw';

function str(v, max = 200) { return String(v == null ? '' : v).trim().slice(0, max); }
function int(v) { const n = Number(v); return Number.isInteger(n) ? n : null; }
function bool(v) { return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; }
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stylist'; }

module.exports = function adminRoutes(db, { baseUrl, uploadDir }) {
  const r = express.Router();
  const canEdit = (req, staffId) => req.staff.role === 'owner' || req.staff.id === Number(staffId);
  const forbid = (res) => res.status(403).json({ error: 'You can only change your own calendar and profile.' });
  const fail = (res, err) => {
    if (err instanceof sched.BookingError) return res.status(err.status).json({ error: err.message });
    throw err;
  };

  // ---------- auth ----------
  r.post('/login', auth.rateLimit({ windowMs: 15 * 60000, max: 10, key: 'login' }), (req, res) => {
    const email = str(req.body && req.body.email).toLowerCase();
    const pw = String((req.body && req.body.password) || '');
    const staff = db.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').get(email);
    if (!staff || !auth.verifyPassword(pw, staff.password_hash)) {
      return res.status(401).json({ error: 'That email and password don’t match.' });
    }
    const s = auth.createSession(db, staff.id);
    res.set('Set-Cookie', auth.sessionCookie(req, s.id, auth.SESSION_DAYS * 86400)).json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
    res.set('Set-Cookie', auth.sessionCookie(req, '', 0)).json({ ok: true });
  });

  r.use(auth.requireStaff);
  r.use((req, res, next) => {
    if (req.staff.must_change_pw && !['/me', '/me/password'].includes(req.path)) {
      return res.status(403).json({ error: 'Please set a new password first.', code: 'must_change_pw' });
    }
    next();
  });

  r.get('/me', (req, res) => {
    const me = db.prepare(`SELECT ${STAFF_FIELDS}, feed_token FROM staff WHERE id = ?`).get(req.staff.id);
    me.feed_url = `${baseUrl(req)}/api/feed/${me.feed_token}.ics`;
    delete me.feed_token;
    res.json({ me, settings: getSettings(db), today: nowInZone(getSettings(db).timezone).date });
  });

  r.post('/me/password', (req, res) => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(String(current || ''), req.staff.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    db.prepare('UPDATE staff SET password_hash = ?, must_change_pw = 0 WHERE id = ?').run(auth.hashPassword(String(next)), req.staff.id);
    db.prepare('DELETE FROM sessions WHERE staff_id = ? AND id != ?').run(req.staff.id, req.sessionId);
    res.json({ ok: true });
  });

  r.post('/me/feed/reset', (req, res) => {
    db.prepare('UPDATE staff SET feed_token = ? WHERE id = ?').run(token(), req.staff.id);
    res.json({ ok: true });
  });

  // ---------- dashboard ----------
  r.get('/overview', (req, res) => {
    const s = getSettings(db);
    const today = nowInZone(s.timezone).date;
    const weekEnd = addDays(today, 6);
    const mine = req.query.scope === 'mine';
    const scope = mine ? ' AND a.staff_id = ?' : '';
    const args = mine ? [req.staff.id] : [];
    const q = (sql, ...a) => db.prepare(sql).get(...a, ...args);
    res.json({
      today,
      today_count: q(`SELECT COUNT(*) n FROM appointments a WHERE date = ? AND status IN ('booked','completed')${scope}`, today).n,
      week_count: q(`SELECT COUNT(*) n FROM appointments a WHERE date BETWEEN ? AND ? AND status IN ('booked','completed')${scope}`, today, weekEnd).n,
      week_revenue_cents: q(`SELECT COALESCE(SUM(price_cents),0) n FROM appointments a WHERE date BETWEEN ? AND ? AND status IN ('booked','completed')${scope}`, today, weekEnd).n,
      month_completed_cents: q(`SELECT COALESCE(SUM(price_cents),0) n FROM appointments a WHERE substr(date,1,7) = ? AND status = 'completed'${scope}`, today.slice(0, 7)).n,
      new_online_7d: q(`SELECT COUNT(*) n FROM appointments a WHERE source = 'online' AND created_at >= datetime('now','-7 days')${scope}`).n,
      upcoming: db.prepare(`SELECT a.id, a.date, a.start_min, a.end_min, a.status, sv.name service_name, st.name staff_name, st.color staff_color, c.name client_name
        FROM appointments a JOIN services sv ON sv.id = a.service_id JOIN staff st ON st.id = a.staff_id JOIN clients c ON c.id = a.client_id
        WHERE a.date >= ? AND a.status = 'booked'${scope} ORDER BY a.date, a.start_min LIMIT 8`).all(today, ...args),
    });
  });

  // ---------- calendar ----------
  r.get('/calendar', (req, res) => {
    const { from, to } = req.query;
    if (!isValidDate(from) || !isValidDate(to)) return res.status(400).json({ error: 'Bad date range.' });
    const staffFilter = req.query.staff && req.query.staff !== 'all' ? int(req.query.staff) : null;
    const where = staffFilter ? ' AND a.staff_id = ?' : '';
    const args = staffFilter ? [from, to, staffFilter] : [from, to];
    const appointments = db.prepare(`SELECT a.*, sv.name service_name, st.name staff_name, st.color staff_color,
        c.name client_name, c.email client_email, c.phone client_phone
      FROM appointments a JOIN services sv ON sv.id = a.service_id JOIN staff st ON st.id = a.staff_id JOIN clients c ON c.id = a.client_id
      WHERE a.date BETWEEN ? AND ?${where} ORDER BY a.date, a.start_min`).all(...args);
    const timeOff = db.prepare(`SELECT t.*, st.name staff_name FROM time_off t JOIN staff st ON st.id = t.staff_id
      WHERE t.date_end >= ? AND t.date_start <= ?${staffFilter ? ' AND t.staff_id = ?' : ''}`).all(...args);
    const hours = db.prepare(`SELECT * FROM working_hours${staffFilter ? ' WHERE staff_id = ?' : ''}`).all(...(staffFilter ? [staffFilter] : []));
    res.json({ appointments, time_off: timeOff, hours });
  });

  r.get('/availability', (req, res) => {
    const serviceId = int(req.query.service);
    const staffId = int(req.query.staff);
    if (!serviceId || !staffId || !isValidDate(req.query.date)) return res.status(400).json({ error: 'Bad request.' });
    res.json({ slots: sched.availability(db, { serviceId, staffId, date: req.query.date, excludeApptId: int(req.query.exclude) || 0 }) });
  });

  // ---------- appointments ----------
  r.post('/appointments', (req, res) => {
    const b = req.body || {};
    const staffId = int(b.staff_id);
    const serviceId = int(b.service_id);
    const startMin = int(b.start_min);
    if (!staffId || !serviceId || startMin == null || !isValidDate(b.date)) return res.status(400).json({ error: 'Pick a stylist, service, date and time.' });
    if (!canEdit(req, staffId)) return forbid(res);
    const clientId = int(b.client_id);
    const client = { name: str(b.client_name, 80), email: str(b.client_email, 120).toLowerCase(), phone: str(b.client_phone, 30) };
    if (!clientId && !client.name) return res.status(400).json({ error: 'Add the client’s name.' });
    try {
      const appt = sched.createAppointment(db, {
        serviceId, staffId, date: b.date, startMin, clientId, client,
        durationMin: int(b.duration_min) || undefined,
        priceCents: b.price_cents != null && b.price_cents !== '' ? int(b.price_cents) : undefined,
        staffNotes: str(b.staff_notes, 2000), allowOverlap: bool(b.allow_overlap),
      }, { source: 'staff', force: true });
      if (bool(b.notify_client) && appt.client_email) {
        notify.bookingEvent('booked', appt, { baseUrl: baseUrl(req), settings: getSettings(db) });
      }
      res.status(201).json({ appointment: appt });
    } catch (err) { fail(res, err); }
  });

  r.get('/appointments/:id', (req, res) => {
    const appt = sched.getAppointment(db, int(req.params.id));
    if (!appt) return res.status(404).json({ error: 'Not found.' });
    res.json({ appointment: appt });
  });

  r.patch('/appointments/:id', (req, res) => {
    const id = int(req.params.id);
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!appt) return res.status(404).json({ error: 'Not found.' });
    if (!canEdit(req, appt.staff_id)) return forbid(res);
    const b = req.body || {};
    try {
      if (b.duration_min != null && int(b.duration_min) > 0) {
        const cur = db.prepare('SELECT start_min FROM appointments WHERE id = ?').get(id);
        db.prepare('UPDATE appointments SET end_min = ? WHERE id = ?').run(cur.start_min + int(b.duration_min), id);
      }
      if (b.date || b.start_min != null || b.staff_id) {
        const newStaff = b.staff_id ? int(b.staff_id) : appt.staff_id;
        if (!canEdit(req, newStaff)) return forbid(res);
        const date = b.date || appt.date;
        if (!isValidDate(date)) return res.status(400).json({ error: 'Bad date.' });
        sched.rescheduleAppointment(db, id, { date, startMin: b.start_min != null ? int(b.start_min) : appt.start_min, staffId: newStaff }, { force: true });
      }
      if (b.status) {
        if (!['booked', 'completed', 'cancelled', 'no_show'].includes(b.status)) return res.status(400).json({ error: 'Bad status.' });
        db.prepare(`UPDATE appointments SET status = ?, cancelled_at = CASE WHEN ? = 'cancelled' THEN datetime('now') ELSE NULL END,
          updated_at = datetime('now') WHERE id = ?`).run(b.status, b.status, id);
      }
      if (b.staff_notes != null) db.prepare('UPDATE appointments SET staff_notes = ? WHERE id = ?').run(str(b.staff_notes, 2000), id);
      if (b.price_cents != null && int(b.price_cents) != null) db.prepare('UPDATE appointments SET price_cents = ? WHERE id = ?').run(int(b.price_cents), id);
      const updated = sched.getAppointment(db, id);
      if (bool(b.notify_client) && updated.client_email) {
        const kind = b.status === 'cancelled' ? 'cancelled' : 'rescheduled';
        notify.bookingEvent(kind, updated, { baseUrl: baseUrl(req), settings: getSettings(db) });
      }
      res.json({ appointment: updated });
    } catch (err) { fail(res, err); }
  });

  // ---------- staff ----------
  r.get('/staff', (_req, res) => {
    res.json({ staff: db.prepare(`SELECT ${STAFF_FIELDS} FROM staff ORDER BY active DESC, sort_order, id`).all() });
  });

  r.post('/staff', auth.requireOwner, (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 60);
    const email = str(b.email, 120).toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Name and a valid email are required.' });
    if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(email)) return res.status(409).json({ error: 'Someone already uses that email.' });
    let slug = slugify(name);
    while (db.prepare('SELECT 1 FROM staff WHERE slug = ?').get(slug)) slug += '-' + crypto.randomInt(10, 99);
    const temp = token(9);
    const sort = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM staff').get().n;
    const id = Number(db.prepare(`INSERT INTO staff (name, slug, email, password_hash, must_change_pw, role, title, color, sort_order, feed_token)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).run(name, slug, email, auth.hashPassword(temp), b.role === 'owner' ? 'owner' : 'barber',
      str(b.title, 80) || 'Stylist', str(b.color, 9) || '#555555', sort, token()).lastInsertRowid);
    // Start new team members with the shop's typical hours so they're bookable once services are picked.
    const ins = db.prepare('INSERT INTO working_hours (staff_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');
    for (const wd of [2, 3, 4, 5]) ins.run(id, wd, 600, 1080);
    ins.run(id, 6, 540, 960);
    res.status(201).json({ id, temp_password: temp });
  });

  r.patch('/staff/:id', (req, res) => {
    const id = int(req.params.id);
    if (!canEdit(req, id)) return forbid(res);
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
    if (b.name != null) set('name', str(b.name, 60) || 'Stylist');
    if (b.title != null) set('title', str(b.title, 80));
    if (b.bio != null) set('bio', str(b.bio, 2000));
    if (b.instagram != null) set('instagram', str(b.instagram, 60).replace(/^@/, ''));
    if (b.photo_url != null) set('photo_url', str(b.photo_url, 500));
    if (b.color != null && /^#[0-9a-f]{6}$/i.test(b.color)) set('color', b.color);
    if (b.accepts_bookings != null) set('accepts_bookings', bool(b.accepts_bookings));
    if (b.email != null) {
      const email = str(b.email, 120).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
      if (db.prepare('SELECT 1 FROM staff WHERE email = ? AND id != ?').get(email, id)) return res.status(409).json({ error: 'That email is taken.' });
      set('email', email);
    }
    if (req.staff.role === 'owner') {
      if (b.role != null) {
        if (id === req.staff.id && b.role !== 'owner') return res.status(400).json({ error: 'You can’t remove your own owner access.' });
        set('role', b.role === 'owner' ? 'owner' : 'barber');
      }
      if (b.active != null) {
        if (id === req.staff.id && !bool(b.active)) return res.status(400).json({ error: 'You can’t deactivate yourself.' });
        set('active', bool(b.active));
      }
      if (b.sort_order != null && int(b.sort_order) != null) set('sort_order', int(b.sort_order));
    }
    if (sets.length) db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    if (b.active != null && !bool(b.active)) db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(id);
    res.json({ staff: db.prepare(`SELECT ${STAFF_FIELDS} FROM staff WHERE id = ?`).get(id) });
  });

  r.post('/staff/:id/reset-password', auth.requireOwner, (req, res) => {
    const id = int(req.params.id);
    const temp = token(9);
    db.prepare('UPDATE staff SET password_hash = ?, must_change_pw = 1 WHERE id = ?').run(auth.hashPassword(temp), id);
    db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(id);
    res.json({ temp_password: temp });
  });

  r.post('/staff/:id/photo', express.json({ limit: '6mb' }), (req, res) => {
    const id = int(req.params.id);
    if (!canEdit(req, id)) return forbid(res);
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(req.body && req.body.data_url));
    if (!m) return res.status(400).json({ error: 'Please upload a PNG, JPG or WebP image.' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 4 MB.' });
    fs.mkdirSync(uploadDir, { recursive: true });
    const file = `staff-${id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(uploadDir, file), buf);
    const url = `/uploads/${file}`;
    db.prepare('UPDATE staff SET photo_url = ? WHERE id = ?').run(url, id);
    res.json({ photo_url: url });
  });

  // ---------- hours ----------
  r.get('/staff/:id/hours', (req, res) => {
    res.json({ hours: db.prepare('SELECT weekday, start_min, end_min FROM working_hours WHERE staff_id = ? ORDER BY weekday, start_min').all(int(req.params.id)) });
  });

  r.put('/staff/:id/hours', (req, res) => {
    const id = int(req.params.id);
    if (!canEdit(req, id)) return forbid(res);
    const rows = Array.isArray(req.body && req.body.hours) ? req.body.hours : null;
    if (!rows) return res.status(400).json({ error: 'Bad request.' });
    for (const h of rows) {
      if (![0, 1, 2, 3, 4, 5, 6].includes(h.weekday) || !(int(h.start_min) >= 0) || !(int(h.end_min) <= 1440) || h.end_min <= h.start_min) {
        return res.status(400).json({ error: 'Each shift needs an end time after its start time.' });
      }
    }
    db.tx(() => {
      db.prepare('DELETE FROM working_hours WHERE staff_id = ?').run(id);
      const ins = db.prepare('INSERT INTO working_hours (staff_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');
      for (const h of rows) ins.run(id, h.weekday, h.start_min, h.end_min);
    });
    res.json({ ok: true });
  });

  // ---------- time off ----------
  r.get('/staff/:id/time-off', (req, res) => {
    const today = nowInZone(getSettings(db).timezone).date;
    res.json({ time_off: db.prepare('SELECT * FROM time_off WHERE staff_id = ? AND date_end >= ? ORDER BY date_start').all(int(req.params.id), today) });
  });

  r.post('/staff/:id/time-off', (req, res) => {
    const id = int(req.params.id);
    if (!canEdit(req, id)) return forbid(res);
    const b = req.body || {};
    const dateEnd = b.date_end || b.date_start;
    if (!isValidDate(b.date_start) || !isValidDate(dateEnd) || dateEnd < b.date_start) return res.status(400).json({ error: 'Pick valid dates.' });
    const partial = b.start_min != null && b.start_min !== '' && b.end_min != null && b.end_min !== '';
    if (partial && !(int(b.end_min) > int(b.start_min))) return res.status(400).json({ error: 'End time must be after start time.' });
    const tid = Number(db.prepare('INSERT INTO time_off (staff_id, date_start, date_end, start_min, end_min, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, b.date_start, dateEnd, partial ? int(b.start_min) : null, partial ? int(b.end_min) : null, str(b.reason, 120)).lastInsertRowid);
    const conflicts = db.prepare(`SELECT COUNT(*) n FROM appointments WHERE staff_id = ? AND status = 'booked' AND date BETWEEN ? AND ?
      ${partial ? 'AND start_min < ? AND end_min > ?' : ''}`).get(id, b.date_start, dateEnd, ...(partial ? [int(b.end_min), int(b.start_min)] : [])).n;
    res.status(201).json({ id: tid, conflicts });
  });

  r.delete('/time-off/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM time_off WHERE id = ?').get(int(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found.' });
    if (!canEdit(req, row.staff_id)) return forbid(res);
    db.prepare('DELETE FROM time_off WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // ---------- services ----------
  r.get('/services', (_req, res) => {
    const services = db.prepare('SELECT * FROM services ORDER BY sort_order, id').all();
    const offerings = db.prepare('SELECT * FROM staff_services').all();
    res.json({ services, offerings });
  });

  function serviceFields(b) {
    const out = {};
    if (b.name != null) out.name = str(b.name, 80);
    if (b.description != null) out.description = str(b.description, 600);
    if (b.category != null) out.category = str(b.category, 40) || 'Other';
    if (b.duration_min != null) out.duration_min = int(b.duration_min);
    if (b.buffer_min != null) out.buffer_min = int(b.buffer_min) || 0;
    if (b.price_cents != null) out.price_cents = int(b.price_cents);
    if (b.price_from != null) out.price_from = bool(b.price_from);
    if (b.active != null) out.active = bool(b.active);
    if (b.sort_order != null) out.sort_order = int(b.sort_order) || 0;
    if ('duration_min' in out && !(out.duration_min > 0 && out.duration_min <= 600)) throw new sched.BookingError('Duration must be between 1 and 600 minutes.');
    if ('price_cents' in out && !(out.price_cents >= 0)) throw new sched.BookingError('Price must be zero or more.');
    if ('name' in out && !out.name) throw new sched.BookingError('Service name is required.');
    return out;
  }

  // Any stylist can add a service to the menu (it's added to their own list).
  r.post('/services', (req, res) => {
    try {
      const f = serviceFields(req.body || {});
      if (!f.name || !f.duration_min) return res.status(400).json({ error: 'Name and duration are required.' });
      const sort = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM services').get().n;
      const id = Number(db.prepare(`INSERT INTO services (name, description, category, duration_min, buffer_min, price_cents, price_from, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(f.name, f.description || '', f.category || 'Cuts', f.duration_min, f.buffer_min || 0,
        f.price_cents || 0, f.price_from || 0, sort).lastInsertRowid);
      db.prepare('INSERT OR IGNORE INTO staff_services (staff_id, service_id) VALUES (?, ?)').run(req.staff.id, id);
      res.status(201).json({ id });
    } catch (err) { fail(res, err); }
  });

  r.patch('/services/:id', auth.requireOwner, (req, res) => {
    try {
      const f = serviceFields(req.body || {});
      const keys = Object.keys(f);
      if (keys.length) db.prepare(`UPDATE services SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), int(req.params.id));
      res.json({ service: db.prepare('SELECT * FROM services WHERE id = ?').get(int(req.params.id)) });
    } catch (err) { fail(res, err); }
  });

  r.delete('/services/:id', auth.requireOwner, (req, res) => {
    const id = int(req.params.id);
    const used = db.prepare('SELECT COUNT(*) n FROM appointments WHERE service_id = ?').get(id).n;
    if (used) {
      db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(id);
      return res.json({ archived: true });
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    res.json({ deleted: true });
  });

  // A stylist's personal menu: which services they offer + their own price/length.
  r.put('/staff/:id/services', (req, res) => {
    const id = int(req.params.id);
    if (!canEdit(req, id)) return forbid(res);
    const rows = Array.isArray(req.body && req.body.offerings) ? req.body.offerings : null;
    if (!rows) return res.status(400).json({ error: 'Bad request.' });
    const clean = [];
    for (const o of rows) {
      const sid = int(o.service_id);
      const price = o.price_cents === '' || o.price_cents == null ? null : int(o.price_cents);
      const dur = o.duration_min === '' || o.duration_min == null ? null : int(o.duration_min);
      if (!sid || (price != null && price < 0) || (dur != null && !(dur > 0 && dur <= 600))) {
        return res.status(400).json({ error: 'Check prices and durations.' });
      }
      clean.push([id, sid, price, dur]);
    }
    db.tx(() => {
      db.prepare('DELETE FROM staff_services WHERE staff_id = ?').run(id);
      const ins = db.prepare('INSERT INTO staff_services (staff_id, service_id, price_cents, duration_min) VALUES (?, ?, ?, ?)');
      for (const row of clean) ins.run(...row);
    });
    res.json({ ok: true });
  });

  // ---------- clients ----------
  r.get('/clients', (req, res) => {
    const q = `%${str(req.query.q, 80)}%`;
    res.json({
      clients: db.prepare(`SELECT c.*, COUNT(a.id) visits,
          MAX(CASE WHEN a.status IN ('completed','booked') THEN a.date END) last_visit,
          SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) no_shows,
          COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price_cents END), 0) spent_cents
        FROM clients c LEFT JOIN appointments a ON a.client_id = c.id
        WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
        GROUP BY c.id ORDER BY last_visit DESC NULLS LAST, c.name LIMIT 200`).all(q, q, q),
    });
  });

  r.get('/clients/:id', (req, res) => {
    const id = int(req.params.id);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) return res.status(404).json({ error: 'Not found.' });
    const history = db.prepare(`SELECT a.id, a.date, a.start_min, a.status, a.price_cents, a.staff_notes, a.client_notes, sv.name service_name, st.name staff_name
      FROM appointments a JOIN services sv ON sv.id = a.service_id JOIN staff st ON st.id = a.staff_id
      WHERE a.client_id = ? ORDER BY a.date DESC, a.start_min DESC`).all(id);
    res.json({ client, history });
  });

  r.patch('/clients/:id', (req, res) => {
    const b = req.body || {};
    const id = int(req.params.id);
    const cur = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!cur) return res.status(404).json({ error: 'Not found.' });
    db.prepare('UPDATE clients SET name = ?, email = ?, phone = ?, notes = ? WHERE id = ?').run(
      b.name != null ? str(b.name, 80) || cur.name : cur.name,
      b.email != null ? str(b.email, 120).toLowerCase() : cur.email,
      b.phone != null ? str(b.phone, 30) : cur.phone,
      b.notes != null ? str(b.notes, 4000) : cur.notes, id);
    res.json({ client: db.prepare('SELECT * FROM clients WHERE id = ?').get(id) });
  });

  // ---------- shop settings ----------
  r.put('/settings', auth.requireOwner, (req, res) => {
    const b = req.body || {};
    const patch = {};
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(k in b)) continue;
      if (typeof def === 'number') {
        const n = int(b[k]);
        if (n == null || n < 0) return res.status(400).json({ error: `${k.replace(/_/g, ' ')} must be a whole number.` });
        patch[k] = n;
      } else if (typeof def === 'boolean') patch[k] = !!bool(b[k]);
      else patch[k] = str(b[k], 2000);
    }
    if (patch.slot_interval_min != null && ![5, 10, 15, 20, 30, 60].includes(patch.slot_interval_min)) {
      return res.status(400).json({ error: 'Slot interval must be 5, 10, 15, 20, 30 or 60 minutes.' });
    }
    if (patch.timezone) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone }); } catch { return res.status(400).json({ error: 'Unknown time zone.' }); }
    }
    saveSettings(db, patch);
    res.json({ settings: getSettings(db) });
  });

  return r;
};
