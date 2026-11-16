'use strict';
// Availability engine + booking rules.
const { addDays, weekday, diffDays, nowInZone, minToLabel } = require('./time');
const { getSettings, token } = require('./db');

const BLOCKING = "('booked','completed')";

// ---------- pure helpers (unit-tested) ----------

/** Subtract a list of [start,end) intervals from another list. */
function subtract(ranges, holes) {
  let out = ranges.map((r) => [r[0], r[1]]);
  for (const [hs, he] of holes) {
    const next = [];
    for (const [s, e] of out) {
      if (he <= s || hs >= e) { next.push([s, e]); continue; }
      if (hs > s) next.push([s, hs]);
      if (he < e) next.push([he, e]);
    }
    out = next;
  }
  return out;
}

/**
 * Candidate start times for an appointment of `duration` (+`buffer` cleanup)
 * inside open `ranges`, avoiding `busy` intervals (already buffer-inclusive).
 */
function slotsFor({ ranges, busy, duration, buffer = 0, step = 15, earliest = 0 }) {
  const free = subtract(ranges, busy);
  const slots = [];
  for (const [s, e] of free) {
    // Align to the step grid relative to the start of the open range.
    let t = s;
    if (t < earliest) t = s + Math.ceil((earliest - s) / step) * step;
    for (; t + duration <= e; t += step) {
      // Cleanup buffer may run past close, but must not run into another booking.
      const blockEnd = t + duration + buffer;
      if (busy.some(([bs, be]) => t < be && blockEnd > bs)) continue;
      slots.push(t);
    }
  }
  return slots;
}

// ---------- DB-backed ----------

function staffService(db, staffId, serviceId) {
  return db.prepare(`
    SELECT sv.*, COALESCE(ss.price_cents, sv.price_cents) AS eff_price,
           COALESCE(ss.duration_min, sv.duration_min) AS eff_duration
    FROM staff_services ss
    JOIN services sv ON sv.id = ss.service_id
    JOIN staff st ON st.id = ss.staff_id
    WHERE ss.staff_id = ? AND ss.service_id = ? AND sv.active = 1 AND st.active = 1`).get(staffId, serviceId);
}

function bookableStaffFor(db, serviceId) {
  return db.prepare(`
    SELECT st.id FROM staff st JOIN staff_services ss ON ss.staff_id = st.id
    JOIN services sv ON sv.id = ss.service_id
    WHERE ss.service_id = ? AND st.active = 1 AND st.accepts_bookings = 1 AND sv.active = 1
    ORDER BY st.sort_order, st.id`).all(serviceId).map((r) => r.id);
}

/** Open working ranges for a stylist on a date after removing time off. */
function openRanges(db, staffId, date) {
  const hours = db.prepare('SELECT start_min, end_min FROM working_hours WHERE staff_id = ? AND weekday = ? ORDER BY start_min')
    .all(staffId, weekday(date)).map((r) => [r.start_min, r.end_min]);
  if (!hours.length) return [];
  const off = db.prepare('SELECT start_min, end_min FROM time_off WHERE staff_id = ? AND date_start <= ? AND date_end >= ?')
    .all(staffId, date, date);
  if (off.some((o) => o.start_min == null)) return [];
  return subtract(hours, off.map((o) => [o.start_min, o.end_min]));
}

function busyIntervals(db, staffId, date, excludeApptId = 0) {
  return db.prepare(`SELECT start_min, end_min, buffer_min FROM appointments
    WHERE staff_id = ? AND date = ? AND status IN ${BLOCKING} AND id != ?`)
    .all(staffId, date, excludeApptId).map((a) => [a.start_min, a.end_min + a.buffer_min]);
}

/** Is the date inside the online booking window? Returns earliest start minute or null. */
function bookingWindow(settings, date, now) {
  const today = nowInZone(settings.timezone, now);
  const ahead = diffDays(today.date, date);
  if (ahead < 0 || ahead > settings.max_days_ahead) return null;
  // Minutes from "now" to the start of `date`, used to apply minimum notice.
  const minutesUntilDay = ahead * 1440 - today.minutes;
  return Math.max(0, settings.min_notice_min - minutesUntilDay);
}

/**
 * Available start times for a service on a date.
 * staffId may be a number or 'any'. Returns [{start_min, label, staff_ids}].
 */
function availability(db, { serviceId, staffId, date, now = new Date(), excludeApptId = 0 }) {
  const settings = getSettings(db);
  if (!settings.booking_enabled) return [];
  const earliest = bookingWindow(settings, date, now);
  if (earliest == null) return [];

  const candidates = staffId === 'any' ? bookableStaffFor(db, serviceId) : [Number(staffId)];
  const byStart = new Map();
  for (const sid of candidates) {
    const svc = staffService(db, sid, serviceId);
    if (!svc) continue;
    const st = db.prepare('SELECT accepts_bookings FROM staff WHERE id = ?').get(sid);
    if (!st || !st.accepts_bookings) continue;
    const slots = slotsFor({
      ranges: openRanges(db, sid, date),
      busy: busyIntervals(db, sid, date, excludeApptId),
      duration: svc.eff_duration,
      buffer: svc.buffer_min,
      step: settings.slot_interval_min,
      earliest,
    });
    for (const t of slots) {
      if (!byStart.has(t)) byStart.set(t, []);
      byStart.get(t).push(sid);
    }
  }
  return [...byStart.keys()].sort((a, b) => a - b)
    .map((t) => ({ start_min: t, label: minToLabel(t), staff_ids: byStart.get(t) }));
}

/** Which of the next `days` days have at least one opening. */
function openDays(db, { serviceId, staffId, from, days, now = new Date() }) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const n = availability(db, { serviceId, staffId, date, now }).length;
    out.push({ date, open: n > 0, count: n });
  }
  return out;
}

class BookingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function findOrCreateClient(db, { name, email, phone }) {
  email = (email || '').trim();
  phone = (phone || '').trim();
  let client = null;
  if (email) client = db.prepare('SELECT * FROM clients WHERE email = ? ORDER BY id LIMIT 1').get(email);
  if (!client && phone) client = db.prepare('SELECT * FROM clients WHERE phone = ? ORDER BY id LIMIT 1').get(phone);
  if (client) {
    db.prepare(`UPDATE clients SET name = ?, email = CASE WHEN ? != '' THEN ? ELSE email END,
      phone = CASE WHEN ? != '' THEN ? ELSE phone END WHERE id = ?`)
      .run(name || client.name, email, email, phone, phone, client.id);
    return client.id;
  }
  return Number(db.prepare('INSERT INTO clients (name, email, phone) VALUES (?, ?, ?)').run(name, email, phone).lastInsertRowid);
}

/**
 * Create an appointment. For online bookings the slot must be in the computed
 * availability (re-checked inside the transaction so two people can't grab the
 * same slot). Staff bookings may pass `force` to override hours.
 */
function createAppointment(db, input, { source = 'online', force = false, now = new Date() } = {}) {
  const { serviceId, date, startMin, client, clientNotes = '', staffNotes = '' } = input;
  let staffId = input.staffId;
  return db.tx(() => {
    if (source === 'online' || !force) {
      const slots = availability(db, { serviceId, staffId, date, now });
      const slot = slots.find((s) => s.start_min === startMin);
      if (!slot) throw new BookingError('Sorry, that time was just taken or is no longer available. Please pick another time.', 409);
      if (staffId === 'any') staffId = pickStaff(db, slot.staff_ids, date);
    }
    staffId = Number(staffId);
    const svc = staffService(db, staffId, serviceId)
      || db.prepare('SELECT *, price_cents AS eff_price, duration_min AS eff_duration FROM services WHERE id = ?').get(serviceId);
    if (!svc) throw new BookingError('Unknown service.');
    const endMin = startMin + (input.durationMin || svc.eff_duration);
    if (force) {
      const clash = busyIntervals(db, staffId, date).some(([s, e]) => startMin < e && endMin > s);
      if (clash && !input.allowOverlap) throw new BookingError('That overlaps another appointment on this calendar.', 409);
    }
    const clientId = input.clientId || findOrCreateClient(db, client);
    const tok = token();
    const price = input.priceCents != null ? input.priceCents : svc.eff_price;
    const id = Number(db.prepare(`INSERT INTO appointments
      (staff_id, service_id, client_id, date, start_min, end_min, buffer_min, price_cents, client_notes, staff_notes, source, token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(staffId, serviceId, clientId, date, startMin, endMin, svc.buffer_min, price, clientNotes, staffNotes, source, tok).lastInsertRowid);
    return getAppointment(db, id);
  });
}

/** For "any stylist": give the slot to whoever has the lightest day. */
function pickStaff(db, staffIds, date) {
  const counts = staffIds.map((id) => ({
    id,
    n: db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE staff_id = ? AND date = ? AND status IN ${BLOCKING}`).get(id, date).n,
  }));
  counts.sort((a, b) => a.n - b.n);
  return counts[0].id;
}

function getAppointment(db, id) {
  return db.prepare(`
    SELECT a.*, s.name AS service_name, s.category AS service_category, st.name AS staff_name, st.color AS staff_color,
           c.name AS client_name, c.email AS client_email, c.phone AS client_phone
    FROM appointments a
    JOIN services s ON s.id = a.service_id
    JOIN staff st ON st.id = a.staff_id
    JOIN clients c ON c.id = a.client_id
    WHERE a.id = ?`).get(id);
}

/** Can the client still cancel/reschedule online? */
function clientCanChange(settings, appt, now = new Date()) {
  if (appt.status !== 'booked') return false;
  const today = nowInZone(settings.timezone, now);
  const minutesUntil = diffDays(today.date, appt.date) * 1440 + appt.start_min - today.minutes;
  return minutesUntil >= settings.cancel_cutoff_hours * 60;
}

function rescheduleAppointment(db, id, { date, startMin, staffId }, { force = false, now = new Date() } = {}) {
  return db.tx(() => {
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!appt) throw new BookingError('Appointment not found.', 404);
    const targetStaff = staffId ? Number(staffId) : appt.staff_id;
    const duration = appt.end_min - appt.start_min;
    if (!force) {
      const slots = availability(db, { serviceId: appt.service_id, staffId: targetStaff, date, now, excludeApptId: id });
      if (!slots.some((s) => s.start_min === startMin)) {
        throw new BookingError('That time isn’t available. Please pick another.', 409);
      }
    } else {
      const clash = busyIntervals(db, targetStaff, date, id).some(([s, e]) => startMin < e && startMin + duration > s);
      if (clash) throw new BookingError('That overlaps another appointment on this calendar.', 409);
    }
    db.prepare(`UPDATE appointments SET date = ?, start_min = ?, end_min = ?, staff_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(date, startMin, startMin + duration, targetStaff, id);
    return getAppointment(db, id);
  });
}

module.exports = {
  subtract, slotsFor, availability, openDays, openRanges, createAppointment, rescheduleAppointment,
  getAppointment, clientCanChange, staffService, BookingError, busyIntervals,
};
