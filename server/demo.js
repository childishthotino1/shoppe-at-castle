'use strict';
// Demo mode: fills a fresh database with sample bookings so a hosted preview
// has something to look at. Never enable this on the real shop's server.
const { nowInZone, addDays } = require('./time');
const { getSettings, saveSettings } = require('./db');
const sched = require('./scheduling');

function seedDemo(db) {
  db.prepare('UPDATE staff SET must_change_pw = 0').run();
  saveSettings(db, { announcement: 'Preview site — bookings here are samples and reset from time to time.' });
  const tz = getSettings(db).timezone;
  const today = nowInZone(tz).date;
  const svc = (n) => db.prepare('SELECT id FROM services WHERE name = ?').get(n).id;
  const staff = (slug) => db.prepare('SELECT id FROM staff WHERE slug = ?').get(slug).id;
  const people = [
    ['Alex Rivera', 'Fade or Taper', 'rae'], ['Jo Park', 'Vivid / Fashion Color', 'mia'], ['Sam Lee', 'Mullet & Shag', 'rae'],
    ['Casey Moore', 'Custom Haircut', 'mia'], ['Taylor Kim', 'Beard Trim & Line-Up', 'rae'], ['Morgan Diaz', 'Gloss / Toner Refresh', 'mia'],
    ['Riley Chen', 'Head Shave', 'rae'], ['Avery Brooks', 'Custom Haircut', 'rae'], ['Quinn Harper', 'All-Over Color', 'mia'],
  ];
  const starts = [600, 660, 720, 780, 840, 900, 960];
  let i = 0;
  for (let d = -6; d < 12; d++) {
    const date = addDays(today, d);
    for (let k = 0; k < 3; k++) {
      const [name, service, who] = people[i++ % people.length];
      const startMin = starts[(i * 3 + d + 14) % starts.length];
      try {
        const a = sched.createAppointment(db, {
          serviceId: svc(service), staffId: staff(who), date, startMin,
          client: { name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: `410-555-01${String(i % 100).padStart(2, '0')}` },
          staffNotes: k === 0 ? 'Prefers a #2 on the sides.' : '',
        }, { source: k === 2 ? 'staff' : 'online', force: true });
        if (d < 0) db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(i % 7 === 0 ? 'no_show' : 'completed', a.id);
      } catch { /* skip closed days / overlaps */ }
    }
  }
  // force:true skips the opening-hours check, so drop anything that landed on a closed day.
  for (const a of db.prepare('SELECT id, staff_id, date, start_min, end_min FROM appointments').all()) {
    const open = sched.openRanges(db, a.staff_id, a.date);
    if (!open.some(([s, e]) => a.start_min >= s && a.end_min <= e)) db.prepare('DELETE FROM appointments WHERE id = ?').run(a.id);
  }
}

module.exports = { seedDemo };
