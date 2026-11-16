'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/index');
const { nowInZone, addDays, weekday } = require('../server/time');

const PW = 'test-password-1';
let server; let base; let db;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppe-'));
  const made = createApp({ dbFile: ':memory:', uploadDir: dir, seedPassword: PW });
  db = made.db;
  // Make tests independent of the real clock's minimum-notice window.
  db.prepare("UPDATE settings SET value = '0' WHERE key = 'min_notice_min'").run();
  await new Promise((r) => { server = made.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/** Next Tuesday at least 3 days out (all seeded stylists work Tuesdays). */
function nextTuesday() {
  let d = addDays(nowInZone('America/New_York').date, 3);
  while (weekday(d) !== 2) d = addDays(d, 1);
  return d;
}

async function api(method, url, body, cookie) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

async function login(email = 'rae@theshoppeatcastle.com') {
  const r = await api('POST', '/api/admin/login', { email, password: PW });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return cookie;
}

test('public shop info lists stylists and services', async () => {
  const r = await api('GET', '/api/shop');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.staff.map((s) => s.name), ['Mia', 'Rae']);
  assert.ok(r.body.services.find((s) => s.name === 'Fade or Taper'));
  assert.equal(r.body.shop.address_line1, '2027 East Lombard Street');
});

test('book, prevent double-booking, reschedule and cancel', async () => {
  const shop = (await api('GET', '/api/shop')).body;
  const fade = shop.services.find((s) => s.name === 'Fade or Taper');
  const rae = shop.staff.find((s) => s.name === 'Rae');
  const date = nextTuesday();

  const av = await api('GET', `/api/availability?service=${fade.id}&staff=${rae.id}&date=${date}`);
  assert.equal(av.status, 200);
  assert.equal(av.body.slots[0].start_min, 600); // opens at 10:00

  const booking = { service_id: fade.id, staff_id: rae.id, date, start_min: 600, name: 'Sam Client', email: 'sam@example.com', phone: '410-555-0100' };
  const b1 = await api('POST', '/api/bookings', booking);
  assert.equal(b1.status, 201, JSON.stringify(b1.body));
  const tok = b1.body.appointment.token;
  assert.equal(b1.body.appointment.can_change, true);

  const dup = await api('POST', '/api/bookings', { ...booking, email: 'other@example.com' });
  assert.equal(dup.status, 409);
  // Overlapping 10:30 start is gone too (45 min fade until 10:45).
  const av2 = await api('GET', `/api/availability?service=${fade.id}&staff=${rae.id}&date=${date}`);
  assert.ok(!av2.body.slots.some((s) => s.start_min === 630));
  assert.ok(av2.body.slots.some((s) => s.start_min === 645));

  const resched = await api('POST', `/api/bookings/${tok}/reschedule`, { date, start_min: 720 });
  assert.equal(resched.status, 200, JSON.stringify(resched.body));
  assert.equal(resched.body.appointment.start_min, 720);

  const ics = await fetch(`${base}/api/bookings/${tok}/calendar.ics`).then((r) => r.text());
  assert.match(ics, /BEGIN:VEVENT/);

  const cancel = await api('POST', `/api/bookings/${tok}/cancel`);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.appointment.status, 'cancelled');
});

test('"any stylist" books someone who offers the service', async () => {
  const shop = (await api('GET', '/api/shop')).body;
  const cut = shop.services.find((s) => s.name === 'Custom Haircut');
  const date = nextTuesday();
  const r = await api('POST', '/api/bookings', { service_id: cut.id, staff_id: 'any', date, start_min: 900, name: 'Any Person', email: 'any@example.com' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(['Mia', 'Rae'].includes(r.body.appointment.staff_name));
});

test('booking validation', async () => {
  const r = await api('POST', '/api/bookings', { service_id: 1, staff_id: 'any', date: nextTuesday(), start_min: 600, name: 'X', email: 'nope' });
  assert.equal(r.status, 400);
});

test('staff must change password, then can manage schedule', async () => {
  const cookie = await login();
  const blocked = await api('GET', '/api/admin/overview', null, cookie);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'must_change_pw');
  const ch = await api('POST', '/api/admin/me/password', { current: PW, next: 'a-new-password' }, cookie);
  assert.equal(ch.status, 200);
  const ov = await api('GET', '/api/admin/overview', null, cookie);
  assert.equal(ov.status, 200);

  const me = (await api('GET', '/api/admin/me', null, cookie)).body.me;
  const date = nextTuesday();

  // Day off removes availability
  const shop = (await api('GET', '/api/shop')).body;
  const fade = shop.services.find((s) => s.name === 'Fade or Taper');
  const off = await api('POST', `/api/admin/staff/${me.id}/time-off`, { date_start: date, reason: 'Vacation' }, cookie);
  assert.equal(off.status, 201);
  const av = await api('GET', `/api/availability?service=${fade.id}&staff=${me.id}&date=${date}`);
  assert.equal(av.body.slots.length, 0);
  await api('DELETE', `/api/admin/time-off/${off.body.id}`, null, cookie);

  // Personal price override shows on the public menu
  const svc = (await api('GET', '/api/admin/services', null, cookie)).body;
  const mine = svc.offerings.filter((o) => o.staff_id === me.id).map((o) => ({ service_id: o.service_id, price_cents: o.service_id === fade.id ? 5000 : null }));
  assert.equal((await api('PUT', `/api/admin/staff/${me.id}/services`, { offerings: mine }, cookie)).status, 200);
  const shop2 = (await api('GET', '/api/shop')).body;
  assert.equal(shop2.services.find((s) => s.id === fade.id).staff.find((o) => o.staff_id === me.id).price_cents, 5000);

  // Hours edit: closed Tuesdays -> no availability
  const hours = (await api('GET', `/api/admin/staff/${me.id}/hours`, null, cookie)).body.hours.filter((h) => h.weekday !== 2);
  assert.equal((await api('PUT', `/api/admin/staff/${me.id}/hours`, { hours }, cookie)).status, 200);
  const av3 = await api('GET', `/api/availability?service=${fade.id}&staff=${me.id}&date=${date}`);
  assert.equal(av3.body.slots.length, 0);

  // Manual staff booking + mark completed
  const created = await api('POST', '/api/admin/appointments', {
    staff_id: me.id, service_id: fade.id, date, start_min: 600, client_name: 'Walk In',
  }, cookie);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const done = await api('PATCH', `/api/admin/appointments/${created.body.appointment.id}`, { status: 'completed' }, cookie);
  assert.equal(done.body.appointment.status, 'completed');

  const cal = await api('GET', `/api/admin/calendar?from=${date}&to=${date}`, null, cookie);
  assert.ok(cal.body.appointments.length >= 1);
});

test('admin endpoints require login and reject cross-origin writes', async () => {
  assert.equal((await api('GET', '/api/admin/overview')).status, 401);
  const res = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}',
  });
  assert.equal(res.status, 403);
});
