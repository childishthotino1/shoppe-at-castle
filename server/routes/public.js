'use strict';
const express = require('express');
const { getSettings } = require('../db');
const { isValidDate, nowInZone, diffDays } = require('../time');
const sched = require('../scheduling');
const ics = require('../ics');
const notify = require('../notify');
const { rateLimit } = require('../auth');

const PUBLIC_SETTINGS = [
  'shop_name', 'tagline', 'address_line1', 'address_line2', 'neighborhood', 'phone', 'email', 'instagram',
  'timezone', 'max_days_ahead', 'cancel_cutoff_hours', 'booking_enabled', 'booking_note',
  'cancellation_policy', 'announcement',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, max = 200) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

function publicAppt(appt, settings) {
  return {
    date: appt.date, start_min: appt.start_min, end_min: appt.end_min, status: appt.status,
    service_name: appt.service_name, staff_name: appt.staff_name, staff_id: appt.staff_id,
    service_id: appt.service_id, price_cents: appt.price_cents, client_name: appt.client_name,
    client_notes: appt.client_notes, token: appt.token,
    can_change: sched.clientCanChange(settings, appt),
  };
}

module.exports = function publicRoutes(db, { baseUrl }) {
  const r = express.Router();

  // Everything the public site needs in one call: shop info, team, menu, hours.
  r.get('/shop', (_req, res) => {
    const settings = getSettings(db);
    const shop = Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, settings[k]]));
    const staff = db.prepare(`SELECT id, name, slug, title, bio, instagram, photo_url, color, accepts_bookings
      FROM staff WHERE active = 1 ORDER BY sort_order, id`).all();
    const services = db.prepare(`SELECT id, name, description, category, duration_min, price_cents, price_from
      FROM services WHERE active = 1 ORDER BY sort_order, id`).all();
    const offerings = db.prepare(`SELECT ss.staff_id, ss.service_id,
        COALESCE(ss.price_cents, sv.price_cents) AS price_cents,
        COALESCE(ss.duration_min, sv.duration_min) AS duration_min
      FROM staff_services ss JOIN staff st ON st.id = ss.staff_id JOIN services sv ON sv.id = ss.service_id
      WHERE st.active = 1 AND sv.active = 1`).all();
    // Combined opening hours across the team, for the "Hours" block.
    const hours = db.prepare(`SELECT weekday, MIN(start_min) AS open, MAX(end_min) AS close
      FROM working_hours wh JOIN staff st ON st.id = wh.staff_id WHERE st.active = 1 GROUP BY weekday`).all();
    for (const s of services) {
      const offers = offerings.filter((o) => o.service_id === s.id);
      s.staff = offers.map((o) => ({ staff_id: o.staff_id, price_cents: o.price_cents, duration_min: o.duration_min }));
      s.min_price_cents = offers.length ? Math.min(...offers.map((o) => o.price_cents)) : s.price_cents;
      s.price_varies = new Set(offers.map((o) => o.price_cents)).size > 1;
    }
    res.json({ shop, staff, services: services.filter((s) => s.staff.length), hours, today: nowInZone(settings.timezone).date });
  });

  function parseAvailQuery(req) {
    const serviceId = Number(req.query.service);
    const staffId = req.query.staff === 'any' || !req.query.staff ? 'any' : Number(req.query.staff);
    if (!Number.isInteger(serviceId) || (staffId !== 'any' && !Number.isInteger(staffId))) return null;
    return { serviceId, staffId };
  }

  r.get('/availability', (req, res) => {
    const q = parseAvailQuery(req);
    if (!q || !isValidDate(req.query.date)) return res.status(400).json({ error: 'Bad request.' });
    res.json({ date: req.query.date, slots: sched.availability(db, { ...q, date: req.query.date }) });
  });

  r.get('/availability/days', (req, res) => {
    const q = parseAvailQuery(req);
    if (!q || !isValidDate(req.query.from)) return res.status(400).json({ error: 'Bad request.' });
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 62);
    res.json({ days: sched.openDays(db, { ...q, from: req.query.from, days }) });
  });

  const bookingLimiter = rateLimit({ windowMs: 15 * 60000, max: 20, key: 'book' });

  r.post('/bookings', bookingLimiter, (req, res) => {
    const b = req.body || {};
    const name = clean(b.name, 80);
    const email = clean(b.email, 120).toLowerCase();
    const phone = clean(b.phone, 30);
    const serviceId = Number(b.service_id);
    const staffId = b.staff_id === 'any' ? 'any' : Number(b.staff_id);
    const startMin = Number(b.start_min);
    if (b.website) return res.status(400).json({ error: 'Bad request.' }); // honeypot
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email so we can send your confirmation.' });
    if (phone && !/^[\d\s()+.-]{7,}$/.test(phone)) return res.status(400).json({ error: 'Please check your phone number.' });
    if (!Number.isInteger(serviceId) || !isValidDate(b.date) || !Number.isInteger(startMin)
      || (staffId !== 'any' && !Number.isInteger(staffId))) {
      return res.status(400).json({ error: 'Please choose a service, date and time.' });
    }
    try {
      const appt = sched.createAppointment(db, {
        serviceId, staffId, date: b.date, startMin,
        client: { name, email, phone }, clientNotes: clean(b.notes, 1000),
      }, { source: 'online' });
      const settings = getSettings(db);
      const staffEmail = db.prepare('SELECT email FROM staff WHERE id = ?').get(appt.staff_id).email;
      notify.bookingEvent('booked', appt, { baseUrl: baseUrl(req), settings, staffEmail });
      res.status(201).json({ appointment: publicAppt(appt, settings) });
    } catch (err) {
      if (err instanceof sched.BookingError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  function byToken(req, res) {
    const row = db.prepare('SELECT id FROM appointments WHERE token = ?').get(String(req.params.token));
    if (!row) { res.status(404).json({ error: 'We couldn’t find that appointment.' }); return null; }
    return sched.getAppointment(db, row.id);
  }

  r.get('/bookings/:token', (req, res) => {
    const appt = byToken(req, res);
    if (!appt) return;
    res.json({ appointment: publicAppt(appt, getSettings(db)) });
  });

  r.get('/bookings/:token/calendar.ics', (req, res) => {
    const appt = byToken(req, res);
    if (!appt) return;
    const s = getSettings(db);
    res.type('text/calendar').set('Content-Disposition', 'attachment; filename="shoppe-appointment.ics"').send(
      ics.calendar(s.shop_name, [{
        uid: `appt-${appt.id}@shoppeatcastle`, date: appt.date, start_min: appt.start_min, end_min: appt.end_min,
        summary: `${appt.service_name} with ${appt.staff_name} — ${s.shop_name}`,
        description: `Manage: ${baseUrl(req)}/manage.html?t=${appt.token}`,
        location: `${s.address_line1}, ${s.address_line2}`,
        status: appt.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
      }], s.timezone),
    );
  });

  r.post('/bookings/:token/cancel', bookingLimiter, (req, res) => {
    const appt = byToken(req, res);
    if (!appt) return;
    const settings = getSettings(db);
    if (!sched.clientCanChange(settings, appt)) {
      return res.status(409).json({ error: `Online changes close ${settings.cancel_cutoff_hours} hours before your appointment. Please contact the shop directly.` });
    }
    db.prepare(`UPDATE appointments SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(appt.id);
    const updated = sched.getAppointment(db, appt.id);
    const staffEmail = db.prepare('SELECT email FROM staff WHERE id = ?').get(appt.staff_id).email;
    notify.bookingEvent('cancelled', updated, { baseUrl: baseUrl(req), settings, staffEmail });
    res.json({ appointment: publicAppt(updated, settings) });
  });

  r.post('/bookings/:token/reschedule', bookingLimiter, (req, res) => {
    const appt = byToken(req, res);
    if (!appt) return;
    const settings = getSettings(db);
    const { date } = req.body || {};
    const startMin = Number(req.body && req.body.start_min);
    if (!isValidDate(date) || !Number.isInteger(startMin)) return res.status(400).json({ error: 'Please pick a new date and time.' });
    if (!sched.clientCanChange(settings, appt)) {
      return res.status(409).json({ error: `Online changes close ${settings.cancel_cutoff_hours} hours before your appointment. Please contact the shop directly.` });
    }
    if (diffDays(nowInZone(settings.timezone).date, date) < 0) return res.status(400).json({ error: 'Please pick a future date.' });
    try {
      const updated = sched.rescheduleAppointment(db, appt.id, { date, startMin });
      const staffEmail = db.prepare('SELECT email FROM staff WHERE id = ?').get(updated.staff_id).email;
      notify.bookingEvent('rescheduled', updated, { baseUrl: baseUrl(req), settings, staffEmail });
      res.json({ appointment: publicAppt(updated, settings) });
    } catch (err) {
      if (err instanceof sched.BookingError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  // Private, read-only calendar feed a stylist can subscribe to from their phone.
  r.get('/feed/:feedToken.ics', (req, res) => {
    const staff = db.prepare('SELECT * FROM staff WHERE feed_token = ? AND active = 1').get(String(req.params.feedToken));
    if (!staff) return res.status(404).send('Not found');
    const s = getSettings(db);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const appts = db.prepare(`SELECT a.*, sv.name AS service_name, c.name AS client_name, c.phone AS client_phone
      FROM appointments a JOIN services sv ON sv.id = a.service_id JOIN clients c ON c.id = a.client_id
      WHERE a.staff_id = ? AND a.date >= ? AND a.status IN ('booked','completed') ORDER BY a.date, a.start_min`).all(staff.id, from);
    res.type('text/calendar').send(ics.calendar(`${s.shop_name} — ${staff.name}`, appts.map((a) => ({
      uid: `appt-${a.id}@shoppeatcastle`, date: a.date, start_min: a.start_min, end_min: a.end_min,
      summary: `${a.client_name} — ${a.service_name}`,
      description: [a.client_phone, a.client_notes].filter(Boolean).join('\n'),
      location: `${s.address_line1}, ${s.address_line2}`,
    })), s.timezone));
  });

  return r;
};
