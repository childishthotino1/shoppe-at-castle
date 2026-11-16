'use strict';
// Time helpers. All appointment times are stored as a local calendar date
// ("YYYY-MM-DD") plus minutes after midnight in the shop's own time zone.
// That keeps a single-location shop's schedule immune to DST/UTC confusion.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUTCDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}

function addDays(str, n) {
  const dt = toUTCDate(str);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmtDate(dt);
}

function weekday(str) {
  return toUTCDate(str).getUTCDay(); // 0 = Sunday
}

function diffDays(a, b) {
  return Math.round((toUTCDate(b) - toUTCDate(a)) / 86400000);
}

/** Current date + minutes-after-midnight in the given IANA time zone. */
function nowInZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function minToLabel(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function minToHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function hhmmToMin(str) {
  if (typeof str !== 'string' || !/^\d{1,2}:\d{2}$/.test(str)) return null;
  const [h, m] = str.split(':').map(Number);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Convert a shop-local date + minutes to a UTC Date. Used for calendar
 * (.ics) exports. Works by guessing, then correcting by the zone offset.
 */
function zonedToUTC(dateStr, minutes, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offset = (ts) => {
    const local = nowInZone(timeZone, new Date(ts));
    const [ly, lm, ld] = local.date.split('-').map(Number);
    const asUTC = Date.UTC(ly, lm - 1, ld, Math.floor(local.minutes / 60), local.minutes % 60);
    return asUTC - ts;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts);
}

module.exports = {
  isValidDate, addDays, weekday, diffDays, nowInZone, minToLabel,
  minToHHMM, hhmmToMin, zonedToUTC,
};
