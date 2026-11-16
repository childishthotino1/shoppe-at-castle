'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subtract, slotsFor } = require('../server/scheduling');
const time = require('../server/time');

test('subtract removes holes from ranges', () => {
  assert.deepEqual(subtract([[600, 1080]], [[720, 780]]), [[600, 720], [780, 1080]]);
  assert.deepEqual(subtract([[600, 1080]], [[500, 700]]), [[700, 1080]]);
  assert.deepEqual(subtract([[600, 1080]], [[600, 1080]]), []);
  assert.deepEqual(subtract([[600, 700], [800, 900]], [[650, 850]]), [[600, 650], [850, 900]]);
});

test('slotsFor respects duration, busy time and buffer', () => {
  const slots = slotsFor({ ranges: [[600, 720]], busy: [[660, 690]], duration: 30, step: 15 });
  assert.deepEqual(slots, [600, 615, 630, 690]);
  // A 15-min cleanup buffer after the new appointment must not run into a booking.
  const withBuf = slotsFor({ ranges: [[600, 720]], busy: [[660, 690]], duration: 30, buffer: 15, step: 15 });
  assert.deepEqual(withBuf, [600, 615, 690]);
  // Appointment must end by close.
  assert.deepEqual(slotsFor({ ranges: [[600, 660]], busy: [], duration: 60, step: 15 }), [600]);
});

test('slotsFor applies earliest start on the step grid', () => {
  assert.deepEqual(slotsFor({ ranges: [[600, 720]], busy: [], duration: 30, step: 30, earliest: 610 }), [630, 660, 690]);
});

test('time helpers', () => {
  assert.equal(time.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(time.weekday('2026-11-17'), 2); // Tuesday
  assert.equal(time.isValidDate('2026-02-30'), false);
  assert.equal(time.minToLabel(780), '1:00 pm');
  assert.equal(time.minToLabel(0), '12:00 am');
  // 10:00 New York in winter = 15:00 UTC; in summer = 14:00 UTC
  assert.equal(time.zonedToUTC('2026-12-01', 600, 'America/New_York').toISOString(), '2026-12-01T15:00:00.000Z');
  assert.equal(time.zonedToUTC('2026-07-01', 600, 'America/New_York').toISOString(), '2026-07-01T14:00:00.000Z');
  const n = time.nowInZone('America/New_York', new Date('2026-11-17T04:30:00Z'));
  assert.deepEqual(n, { date: '2026-11-16', minutes: 23 * 60 + 30 });
});
