'use strict';
// Booking notifications. By default these are only logged. Set RESEND_API_KEY
// and MAIL_FROM (e.g. "The Shoppe <bookings@yourdomain.com>") to send real
// email through Resend's HTTP API — no extra dependencies needed.
const { minToLabel } = require('./time');

function fmtDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

function describe(appt) {
  return `${appt.service_name} with ${appt.staff_name} on ${fmtDate(appt.date)} at ${minToLabel(appt.start_min)}`;
}

async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from || !to) {
    console.log(`[notify] (not sent) to=${to || '-'} subject="${subject}"`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) console.error('[notify] email failed', res.status, await res.text());
  } catch (err) {
    console.error('[notify] email error', err.message);
  }
}

function manageUrl(baseUrl, appt) {
  return `${baseUrl}/manage.html?t=${appt.token}`;
}

/** kind: 'booked' | 'cancelled' | 'rescheduled' */
function bookingEvent(kind, appt, { baseUrl, settings, staffEmail }) {
  const what = describe(appt);
  const where = `${settings.address_line1}, ${settings.address_line2}`;
  const subjects = {
    booked: `You're booked: ${what}`,
    cancelled: `Cancelled: ${what}`,
    rescheduled: `Rescheduled: ${what}`,
  };
  const clientText = [
    `Hi ${appt.client_name},`, '',
    kind === 'cancelled' ? `Your appointment has been cancelled: ${what}.` : `${what}.`,
    kind === 'cancelled' ? '' : `Where: ${settings.shop_name}, ${where}`,
    kind === 'cancelled' ? '' : `View, add to calendar, reschedule or cancel: ${manageUrl(baseUrl, appt)}`,
    '', settings.cancellation_policy, '', `— ${settings.shop_name}`,
  ].join('\n');
  sendEmail(appt.client_email, subjects[kind], clientText);
  if (staffEmail) {
    sendEmail(staffEmail, `[${kind}] ${appt.client_name} — ${what}`,
      `${appt.client_name} (${appt.client_email || 'no email'}, ${appt.client_phone || 'no phone'})\n${what}\nNotes: ${appt.client_notes || '—'}`);
  }
}

module.exports = { bookingEvent, sendEmail };
