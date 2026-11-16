/* Staff dashboard — single page app, no build step. */
(function () {
  'use strict';
  const { esc, money, minLabel, duration, addDays, parseDate, isoDate, longDate, DAYS, avatar } = window.Shoppe;
  const app = document.getElementById('app');
  const ICON = {
    today: '<path d="M3 10h18M7 3v4M17 3v4"/><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 15h3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M7 3v4M17 3v4M8 14h2M12 14h2M16 14h0M8 18h2M12 18h2"/>',
    clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3 2.4 3.5 5.2"/>',
    services: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.6 20 18M8.6 16.4 20 6"/>',
    schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    shop: '<path d="M4 10v10h16V10M2 10l2-6h16l2 6c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3Z"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  const S = { me: null, settings: null, today: null, staff: [], services: [], offerings: [], cal: { view: null, date: null, staff: null } };

  // ---------- api ----------
  async function api(path, opts = {}) {
    const res = await fetch('/api/admin' + path, {
      method: opts.method || 'GET', credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !opts.noAuthRedirect) { renderLogin(); throw new Error('Please sign in.'); }
    if (res.status === 403 && data && data.code === 'must_change_pw') { renderChangePassword(); throw new Error(data.error); }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
    return data;
  }

  let toastTimer;
  function toast(msg, err) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = `toast show${err ? ' err' : ''}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
  }
  const fail = (e) => toast(e.message, true);

  const toCents = (v) => { const n = Math.round(parseFloat(String(v).replace(/[$,]/g, '')) * 100); return Number.isFinite(n) ? n : null; };
  const dollars = (c) => (c == null ? '' : (c / 100).toFixed(c % 100 ? 2 : 0));
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const fromHHMM = (s) => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const isOwner = () => S.me.role === 'owner';
  const canEdit = (staffId) => isOwner() || S.me.id === Number(staffId);
  const staffById = (id) => S.staff.find((s) => s.id === Number(id));
  const shortDate = (d) => parseDate(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const statusLabel = { booked: 'Booked', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show' };

  // ---------- auth screens ----------
  function renderLogin() {
    app.innerHTML = `<div class="auth"><form class="auth__card form" id="login">
      <img src="/img/logo.png" alt="">
      <h1>Staff sign in</h1><p class="sub">The Shoppe at Castle</p>
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <p class="alert" id="err" role="alert"></p>
      <button class="btn btn--block" type="submit">Sign in</button>
      <p class="note" style="text-align:center">Forgot your password? Ask a shop owner to reset it.</p>
    </form></div>`;
    document.getElementById('em').focus();
    document.getElementById('login').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/login', { method: 'POST', noAuthRedirect: true, body: { email: document.getElementById('em').value, password: document.getElementById('pw').value } });
        boot();
      } catch (ex) { document.getElementById('err').textContent = ex.message; }
    };
  }

  function renderChangePassword() {
    app.innerHTML = `<div class="auth"><form class="auth__card form" id="cp">
      <img src="/img/logo.png" alt="">
      <h1>Set your password</h1><p class="sub">Choose a new password to finish signing in.</p>
      <div class="field"><label for="cur">Temporary password</label><input id="cur" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="nw">New password</label><input id="nw" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
      <p class="alert" id="err" role="alert"></p>
      <button class="btn btn--block" type="submit">Save &amp; continue</button>
    </form></div>`;
    document.getElementById('cp').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/me/password', { method: 'POST', body: { current: document.getElementById('cur').value, next: document.getElementById('nw').value } });
        boot();
      } catch (ex) { document.getElementById('err').textContent = ex.message; }
    };
  }

  // ---------- shell ----------
  const NAV = [
    ['today', 'Today'], ['calendar', 'Calendar'], ['clients', 'Clients'], ['services', 'Services'],
    ['schedule', 'Hours & time off'], ['profile', 'Profile'], ['shop', 'Shop & team'],
  ];

  function shell(route) {
    const nav = NAV.filter(([k]) => k !== 'shop' || isOwner());
    const mobile = ['today', 'calendar', 'clients', 'services'];
    app.innerHTML = `<div class="shell">
      <aside class="side">
        <a class="brand" href="/" target="_blank"><img src="/img/logo.png" alt=""><span>The Shoppe<small>Staff</small></span></a>
        <nav>${nav.map(([k, l]) => `<a href="#/${k}" class="${route === k ? 'on' : ''}">${svg(k)}${l}</a>`).join('')}</nav>
        <div class="me">${avatar(S.me, 36)}<div><b>${esc(S.me.name)}</b><small>${S.me.role === 'owner' ? 'Owner' : 'Stylist'}</small></div><button id="logout">Sign out</button></div>
      </aside>
      <main class="main" id="main"></main>
      <nav class="tabbar" aria-label="Sections">
        ${mobile.map((k) => `<a href="#/${k}" class="${route === k ? 'on' : ''}">${svg(k)}${NAV.find((n) => n[0] === k)[1]}</a>`).join('')}
        <button type="button" id="moreBtn" class="${mobile.includes(route) ? '' : 'on'}" aria-expanded="false">${svg('more')}More</button>
      </nav>
    </div>`;
    document.getElementById('logout').onclick = logout;
    document.getElementById('moreBtn').onclick = (e) => {
      e.stopPropagation();
      const existing = document.querySelector('.more-menu');
      if (existing) { existing.remove(); return; }
      const m = document.createElement('div');
      m.className = 'more-menu';
      m.innerHTML = nav.filter(([k]) => !mobile.includes(k)).map(([k, l]) => `<a href="#/${k}">${l}</a>`).join('')
        + '<a href="/" target="_blank">View website ↗</a><button type="button" id="logout2">Sign out</button>';
      document.body.appendChild(m);
      m.querySelector('#logout2').onclick = logout;
      setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
    };
    return document.getElementById('main');
  }

  async function logout() {
    await api('/logout', { method: 'POST' }).catch(() => {});
    renderLogin();
  }

  function topbar(title, tools = '') {
    return `<div class="topbar"><h1>${esc(title)}</h1><div class="tools">${tools}</div></div>`;
  }

  // Owners can manage anyone's hours/menu/profile; stylists only their own.
  function staffPicker(current) {
    if (!isOwner()) return '';
    return `<select class="select" id="who" aria-label="Stylist">${S.staff.filter((s) => s.active).map((s) =>
      `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${esc(s.name)}${s.id === S.me.id ? ' (you)' : ''}</option>`).join('')}</select>`;
  }
  function bindPicker(fn) {
    const w = document.getElementById('who');
    if (w) w.onchange = () => fn(Number(w.value));
  }

  // ---------- drawer ----------
  function drawer(title, body, footer = '') {
    closeDrawer();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const d = document.createElement('aside');
    d.className = 'drawer';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', title);
    d.innerHTML = `<header><h2>${esc(title)}</h2><button class="x" type="button" aria-label="Close">×</button></header>
      <div class="body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}`;
    document.body.append(scrim, d);
    scrim.onclick = closeDrawer;
    d.querySelector('.x').onclick = closeDrawer;
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    const f = d.querySelector('input, select, textarea, button:not(.x)');
    (f || d.querySelector('.x')).focus();
    return d;
  }
  function closeDrawer() { document.querySelectorAll('.scrim, .drawer').forEach((n) => n.remove()); }

  // ---------- Today ----------
  async function viewToday(main) {
    const scope = localStorage.getItem('shoppe:scope') || 'mine';
    main.innerHTML = topbar(`Hi, ${S.me.name}`, `<div class="seg"><button data-scope="mine" class="${scope === 'mine' ? 'on' : ''}">Mine</button><button data-scope="all" class="${scope === 'all' ? 'on' : ''}">Whole shop</button></div>
      <button class="btn btn--sm" id="newAppt">+ Appointment</button>`) + '<div class="spinner"></div>';
    main.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => { localStorage.setItem('shoppe:scope', b.dataset.scope); route(); });
    document.getElementById('newAppt').onclick = () => apptForm({ date: S.today, staff_id: S.me.id });
    const o = await api(`/overview?scope=${scope}`);
    const todayList = o.upcoming.filter((a) => a.date === o.today);
    const later = o.upcoming.filter((a) => a.date !== o.today);
    const row = (a) => `<li><button class="rowlink" data-appt="${a.id}">
      <span class="avatar" style="width:10px;height:40px;border-radius:4px;background:${esc(a.staff_color)}"></span>
      <span class="grow"><span class="t">${esc(a.client_name)}</span><br><span class="s">${esc(a.service_name)} · ${esc(a.staff_name)}</span></span>
      <span class="when">${a.date === o.today ? '' : `${shortDate(a.date)}<br>`}${minLabel(a.start_min)}</span></button></li>`;
    main.querySelector('.spinner').outerHTML = `
      <div class="stats">
        <div class="stat"><small>Today</small><strong>${o.today_count}</strong></div>
        <div class="stat"><small>Next 7 days</small><strong>${o.week_count}</strong></div>
        <div class="stat"><small>Booked value (7d)</small><strong>${money(o.week_revenue_cents)}</strong></div>
        <div class="stat"><small>Done this month</small><strong>${money(o.month_completed_cents)}</strong></div>
      </div>
      <div class="two">
        <section class="box"><h2>Still to come today</h2>
          ${todayList.length ? `<ul class="list">${todayList.map(row).join('')}</ul>` : '<p class="muted">Nothing else booked today.</p>'}
          <p style="margin-top:12px"><a class="link" href="#/calendar">Open calendar →</a></p>
        </section>
        <section class="box"><h2>Coming up</h2>
          ${later.length ? `<ul class="list">${later.map(row).join('')}</ul>` : '<p class="muted">No upcoming bookings yet.</p>'}
          <p class="muted" style="margin-top:12px;font-size:14px">${o.new_online_7d} booked online in the last 7 days.</p>
        </section>
      </div>`;
    main.querySelectorAll('[data-appt]').forEach((b) => b.onclick = () => openAppt(Number(b.dataset.appt)));
  }

  // ---------- Calendar ----------
  const PX = 1.1; // pixels per minute

  async function viewCalendar(main) {
    const c = S.cal;
    if (!c.date) c.date = S.today;
    if (!c.view) c.view = window.innerWidth < 760 ? 'day' : 'day';
    if (c.staff == null) c.staff = window.innerWidth < 760 ? String(S.me.id) : 'all';
    const active = S.staff.filter((s) => s.active);
    const weekStart = addDays(c.date, -((parseDate(c.date).getDay() + 6) % 7)); // Monday
    const from = c.view === 'day' ? c.date : weekStart;
    const to = c.view === 'day' ? c.date : addDays(weekStart, 6);
    const label = c.view === 'day' ? longDate(c.date)
      : `${parseDate(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${parseDate(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    main.innerHTML = topbar('Calendar', `
      <button class="icon-btn" id="cPrev" aria-label="Previous">‹</button>
      <button class="btn btn--ghost btn--sm" id="cToday">Today</button>
      <button class="icon-btn" id="cNext" aria-label="Next">›</button>
      <input type="date" class="select" id="cDate" value="${c.date}" aria-label="Go to date">
      <div class="seg"><button data-v="day" class="${c.view === 'day' ? 'on' : ''}">Day</button><button data-v="week" class="${c.view === 'week' ? 'on' : ''}">Week</button></div>
      <select class="select" id="cStaff" aria-label="Whose calendar">
        <option value="all" ${c.staff === 'all' ? 'selected' : ''}>Everyone</option>
        ${active.map((s) => `<option value="${s.id}" ${c.staff === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
      <button class="btn btn--sm" id="newAppt">+ New</button>`)
      + `<p class="muted" style="margin:-6px 0 12px;font-weight:600">${label}</p><div class="cal"><div class="cal__scroll" id="calScroll"><div class="spinner"></div></div></div>`;
    const step = c.view === 'day' ? 1 : 7;
    document.getElementById('cPrev').onclick = () => { c.date = addDays(c.date, -step); route(); };
    document.getElementById('cNext').onclick = () => { c.date = addDays(c.date, step); route(); };
    document.getElementById('cToday').onclick = () => { c.date = S.today; route(); };
    document.getElementById('cDate').onchange = (e) => { if (e.target.value) { c.date = e.target.value; route(); } };
    main.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { c.view = b.dataset.v; route(); });
    document.getElementById('cStaff').onchange = (e) => { c.staff = e.target.value; route(); };
    document.getElementById('newAppt').onclick = () => apptForm({ date: c.date, staff_id: c.staff !== 'all' ? Number(c.staff) : S.me.id });

    const data = await api(`/calendar?from=${from}&to=${to}&staff=${c.staff}`);
    const staffList = c.staff === 'all' ? active : active.filter((s) => String(s.id) === c.staff);
    // Columns: day view = one per stylist; week view = one per day.
    const cols = c.view === 'day'
      ? staffList.map((s) => ({ date: c.date, staff: [s], title: esc(s.name), sub: esc(s.title) }))
      : [...Array(7)].map((_, i) => { const d = addDays(weekStart, i); return { date: d, staff: staffList, title: parseDate(d).toLocaleDateString('en-US', { weekday: 'short' }), sub: parseDate(d).getDate() }; });

    const wd = (d) => parseDate(d).getDay();
    let dayStart = 9 * 60; let dayEnd = 19 * 60;
    for (const h of data.hours) { dayStart = Math.min(dayStart, h.start_min); dayEnd = Math.max(dayEnd, h.end_min); }
    for (const a of data.appointments) { dayStart = Math.min(dayStart, a.start_min); dayEnd = Math.max(dayEnd, a.end_min); }
    dayStart = Math.floor(dayStart / 60) * 60 - 60; dayEnd = Math.min(1440, Math.ceil(dayEnd / 60) * 60 + 60);
    dayStart = Math.max(0, dayStart);
    const H = (dayEnd - dayStart) * PX;
    const y = (m) => (m - dayStart) * PX;
    const colW = c.view === 'day' ? 'minmax(160px, 1fr)' : 'minmax(110px, 1fr)';
    const grid = document.createElement('div');
    grid.className = 'cal__grid';
    grid.style.gridTemplateColumns = `56px repeat(${cols.length}, ${colW})`;
    let html = '<div class="cal__corner"></div>';
    html += cols.map((col) => `<div class="cal__head ${col.date === S.today && c.view === 'week' ? 'today' : ''}">${col.title}<small>${col.sub}</small></div>`).join('');
    // time gutter
    let times = '';
    for (let m = dayStart + 60; m < dayEnd; m += 60) times += `<span style="top:${y(m)}px">${minLabel(m).replace(':00', '')}</span>`;
    html += `<div class="cal__times" style="height:${H}px;position:sticky">${times}</div>`;
    const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
    for (const col of cols) {
      const ids = col.staff.map((s) => s.id);
      let inner = '';
      // open (working) hours
      for (const h of data.hours.filter((x) => ids.includes(x.staff_id) && x.weekday === wd(col.date))) {
        inner += `<div class="cal__open" style="top:${y(h.start_min)}px;height:${(h.end_min - h.start_min) * PX}px"></div>`;
      }
      for (let m = dayStart; m < dayEnd; m += 30) inner += `<div class="cal__line ${m % 60 ? 'half' : ''}" style="top:${y(m)}px"></div>`;
      for (const t of data.time_off.filter((x) => ids.includes(x.staff_id) && x.date_start <= col.date && x.date_end >= col.date)) {
        const s0 = t.start_min == null ? dayStart : t.start_min; const e0 = t.end_min == null ? dayEnd : t.end_min;
        inner += `<div class="cal__off" style="top:${y(s0)}px;height:${(e0 - s0) * PX}px">${c.view === 'week' && ids.length > 1 ? `${esc(t.staff_name)}: ` : ''}${esc(t.reason || 'Time off')}</div>`;
      }
      // appointments with simple lane layout for overlaps
      const appts = data.appointments.filter((a) => a.date === col.date && ids.includes(a.staff_id))
        .sort((a, b) => a.start_min - b.start_min);
      const lanes = [];
      for (const a of appts) {
        let lane = lanes.findIndex((end) => end <= a.start_min);
        if (lane === -1) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = a.end_min; a._lane = lane;
      }
      const n = Math.max(1, lanes.length);
      for (const a of appts) {
        const h = Math.max(22, (a.end_min - a.start_min) * PX - 2);
        inner += `<button class="appt ${a.status}" data-appt="${a.id}" style="top:${y(a.start_min) + 1}px;height:${h}px;left:calc(${(a._lane / n) * 100}% + 3px);width:calc(${100 / n}% - 6px);background:${esc(a.staff_color)}"
          aria-label="${esc(a.client_name)}, ${esc(a.service_name)}, ${minLabel(a.start_min)}">
          <b>${esc(a.client_name)}</b><span>${minLabel(a.start_min)} · ${esc(a.service_name)}</span>${c.view === 'week' && ids.length > 1 ? `<span>${esc(a.staff_name)}</span>` : ''}</button>`;
      }
      if (col.date === S.today && nowMin > dayStart && nowMin < dayEnd) inner += `<div class="cal__now" style="top:${y(nowMin)}px"></div>`;
      html += `<div class="cal__col" style="height:${H}px" data-date="${col.date}" data-staff="${col.staff.length === 1 ? col.staff[0].id : ''}">${inner}</div>`;
    }
    grid.innerHTML = html;
    const scroll = document.getElementById('calScroll');
    scroll.innerHTML = '';
    scroll.appendChild(grid);
    // scroll to first open hour / now
    const target = c.date === S.today && nowMin > dayStart ? y(nowMin) - 120 : y(dayStart + 60);
    scroll.scrollTop = Math.max(0, target);

    grid.addEventListener('click', (e) => {
      const ap = e.target.closest('[data-appt]');
      if (ap) { openAppt(Number(ap.dataset.appt)); return; }
      const col = e.target.closest('.cal__col');
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const m = Math.round((dayStart + (e.clientY - rect.top) / PX) / 15) * 15;
      const sid = col.dataset.staff ? Number(col.dataset.staff) : S.me.id;
      apptForm({ date: col.dataset.date, start_min: m, staff_id: canEdit(sid) ? sid : S.me.id });
    });
  }

  // ---------- appointment drawer ----------
  async function openAppt(id) {
    let a;
    try { a = (await api(`/appointments/${id}`)).appointment; } catch (e) { fail(e); return; }
    if (!a) { toast('Appointment not found', true); return; }
    const editable = canEdit(a.staff_id);
    const d = drawer('Appointment', `
      <p><span class="pill ${a.status}">${statusLabel[a.status]}</span> ${a.source === 'online' ? '<span class="pill staff">Booked online</span>' : ''}</p>
      <h3 style="font-size:24px;margin:12px 0 4px">${esc(a.client_name)}</h3>
      <p class="muted" style="margin-bottom:16px">${a.client_phone ? `<a href="tel:${esc(a.client_phone)}">${esc(a.client_phone)}</a> · ` : ''}${a.client_email ? `<a href="mailto:${esc(a.client_email)}">${esc(a.client_email)}</a>` : ''}</p>
      <dl class="kv">
        <dt>Service</dt><dd>${esc(a.service_name)}</dd>
        <dt>Stylist</dt><dd>${esc(a.staff_name)}</dd>
        <dt>When</dt><dd>${longDate(a.date)}<br>${minLabel(a.start_min)} – ${minLabel(a.end_min)}</dd>
        <dt>Price</dt><dd>${money(a.price_cents)}</dd>
        ${a.client_notes ? `<dt>Client note</dt><dd style="font-weight:400">${esc(a.client_notes)}</dd>` : ''}
      </dl>
      ${editable ? `
      <div class="actions">
        ${a.status !== 'completed' ? '<button class="btn btn--sm" data-status="completed">✓ Mark done</button>' : ''}
        ${a.status !== 'no_show' ? '<button class="btn btn--ghost btn--sm" data-status="no_show">No-show</button>' : ''}
        ${a.status !== 'booked' ? '<button class="btn btn--ghost btn--sm" data-status="booked">Restore</button>' : ''}
        ${a.status !== 'cancelled' ? '<button class="btn btn--danger btn--sm" data-status="cancelled">Cancel</button>' : ''}
      </div>
      <hr class="hr">
      <form class="form" id="edit">
        <div class="row2">
          <div class="field"><label for="ed">Date</label><input id="ed" type="date" value="${a.date}"></div>
          <div class="field"><label for="et">Start</label><input id="et" type="time" step="300" value="${hhmm(a.start_min)}"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="edur">Length (min)</label><input id="edur" type="number" min="5" step="5" value="${a.end_min - a.start_min}"></div>
          <div class="field"><label for="ep">Price ($)</label><input id="ep" inputmode="decimal" value="${dollars(a.price_cents)}"></div>
        </div>
        ${isOwner() ? `<div class="field"><label for="es">Stylist</label><select id="es">${S.staff.filter((s) => s.active).map((s) => `<option value="${s.id}" ${s.id === a.staff_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label for="en">Private notes</label><textarea id="en" rows="3" placeholder="Formula, guard numbers, preferences…">${esc(a.staff_notes)}</textarea></div>
        ${a.client_email ? '<label class="switch"><input type="checkbox" id="enotify"> Email the client about changes</label>' : ''}
      </form>` : '<p class="muted">Only the stylist or an owner can change this appointment.</p>'}
      <p style="margin-top:16px"><button class="link" id="openClient" type="button">View client history →</button></p>`,
    editable ? '<button class="btn" id="save" type="button">Save changes</button>' : '');
    d.querySelector('#openClient').onclick = () => openClient(a.client_id);
    if (!editable) return;
    const notifyOn = () => { const n = d.querySelector('#enotify'); return n ? n.checked : false; };
    d.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
      const st = b.dataset.status;
      if (st === 'cancelled' && !confirm('Cancel this appointment?')) return;
      try {
        await api(`/appointments/${id}`, { method: 'PATCH', body: { status: st, notify_client: st === 'cancelled' && notifyOn() } });
        toast(`Marked ${statusLabel[st].toLowerCase()}`); closeDrawer(); route();
      } catch (e) { fail(e); }
    });
    d.querySelector('#save').onclick = async () => {
      const body = {
        staff_notes: d.querySelector('#en').value,
        price_cents: toCents(d.querySelector('#ep').value),
        duration_min: Number(d.querySelector('#edur').value),
      };
      const nd = d.querySelector('#ed').value; const nt = fromHHMM(d.querySelector('#et').value);
      const ns = d.querySelector('#es') ? Number(d.querySelector('#es').value) : a.staff_id;
      const moved = nd !== a.date || nt !== a.start_min || ns !== a.staff_id;
      if (moved) Object.assign(body, { date: nd, start_min: nt, staff_id: ns, notify_client: notifyOn() });
      try {
        // Apply length before moving so the overlap check uses the new length.
        await api(`/appointments/${id}`, { method: 'PATCH', body });
        toast('Saved'); closeDrawer(); route();
      } catch (e) { fail(e); }
    };
  }

  // ---------- new appointment ----------
  function apptForm(pre = {}) {
    const editableStaff = S.staff.filter((s) => s.active && canEdit(s.id));
    const staffId = Number(pre.staff_id) || S.me.id;
    const d = drawer('New appointment', `
      <form class="form" id="na" autocomplete="off">
        <div class="field" style="position:relative"><label for="cq">Client</label>
          <input id="cq" placeholder="Search name, email or phone — or type a new name">
          <div id="sugg"></div>
          <input type="hidden" id="cid">
        </div>
        <div class="row2">
          <div class="field"><label for="ce">Email</label><input id="ce" type="email"></div>
          <div class="field"><label for="cph">Phone</label><input id="cph" type="tel"></div>
        </div>
        <div class="field"><label for="ns">Stylist</label><select id="ns">${editableStaff.map((s) => `<option value="${s.id}" ${s.id === staffId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="nsv">Service</label><select id="nsv"></select></div>
        <div class="row2">
          <div class="field"><label for="nd">Date</label><input id="nd" type="date" value="${pre.date || S.today}"></div>
          <div class="field"><label for="nt">Start</label><input id="nt" type="time" step="300" value="${pre.start_min != null ? hhmm(pre.start_min) : ''}"></div>
        </div>
        <div><p class="hint" style="font-size:13px;color:var(--muted);margin-bottom:6px">Open times (tap to fill):</p><div class="chips" id="openTimes"></div></div>
        <div class="row2">
          <div class="field"><label for="ndur">Length (min)</label><input id="ndur" type="number" min="5" step="5"></div>
          <div class="field"><label for="np">Price ($)</label><input id="np" inputmode="decimal"></div>
        </div>
        <div class="field"><label for="nn">Private notes</label><textarea id="nn" rows="2"></textarea></div>
        <label class="switch"><input type="checkbox" id="nnotify"> Email the client a confirmation</label>
        <label class="switch"><input type="checkbox" id="noverlap"> Allow double-booking</label>
        <p class="alert" id="nerr"></p>
      </form>`, '<button class="btn" id="create" type="button">Book it</button>');
    const $ = (s) => d.querySelector(s);
    function fillServices() {
      const sid = Number($('#ns').value);
      const offered = new Set(S.offerings.filter((o) => o.staff_id === sid).map((o) => o.service_id));
      const list = S.services.filter((s) => s.active);
      $('#nsv').innerHTML = `<optgroup label="Their menu">${list.filter((s) => offered.has(s.id)).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>
        <optgroup label="Other services">${list.filter((s) => !offered.has(s.id)).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>`;
      fillDefaults();
    }
    function fillDefaults() {
      const sid = Number($('#ns').value); const svcId = Number($('#nsv').value);
      const svc = S.services.find((s) => s.id === svcId);
      const o = S.offerings.find((x) => x.staff_id === sid && x.service_id === svcId);
      if (!svc) return;
      $('#ndur').value = (o && o.duration_min) || svc.duration_min;
      $('#np').value = dollars((o && o.price_cents != null) ? o.price_cents : svc.price_cents);
      loadOpen();
    }
    async function loadOpen() {
      const box = $('#openTimes');
      box.innerHTML = '<span class="muted" style="font-size:13px">Loading…</span>';
      try {
        const { slots } = await api(`/availability?service=${$('#nsv').value}&staff=${$('#ns').value}&date=${$('#nd').value}`);
        box.innerHTML = slots.length ? slots.slice(0, 40).map((s) => `<button type="button" class="slot" data-m="${s.start_min}">${minLabel(s.start_min)}</button>`).join('')
          : '<span class="muted" style="font-size:13px">No open times within booking hours. You can still type a time.</span>';
        box.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
          $('#nt').value = hhmm(Number(b.dataset.m));
          box.querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        });
      } catch { box.innerHTML = ''; }
    }
    $('#ns').onchange = fillServices;
    $('#nsv').onchange = fillDefaults;
    $('#nd').onchange = loadOpen;
    fillServices();

    let searchTimer;
    $('#cq').oninput = () => {
      $('#cid').value = '';
      clearTimeout(searchTimer);
      const q = $('#cq').value.trim();
      if (q.length < 2) { $('#sugg').innerHTML = ''; return; }
      searchTimer = setTimeout(async () => {
        const { clients } = await api(`/clients?q=${encodeURIComponent(q)}`);
        $('#sugg').innerHTML = clients.length ? `<div class="suggest">${clients.slice(0, 8).map((c) =>
          `<button type="button" data-c="${c.id}">${esc(c.name)} <span class="muted">${esc(c.email || c.phone)}</span></button>`).join('')}</div>` : '';
        $('#sugg').querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
          const c = clients.find((x) => x.id === Number(b.dataset.c));
          $('#cq').value = c.name; $('#cid').value = c.id; $('#ce').value = c.email; $('#cph').value = c.phone;
          $('#sugg').innerHTML = '';
        });
      }, 200);
    };

    $('#create').onclick = async () => {
      $('#nerr').textContent = '';
      const start = fromHHMM($('#nt').value);
      if (start == null) { $('#nerr').textContent = 'Pick a start time.'; return; }
      try {
        await api('/appointments', {
          method: 'POST',
          body: {
            staff_id: Number($('#ns').value), service_id: Number($('#nsv').value), date: $('#nd').value, start_min: start,
            client_id: $('#cid').value ? Number($('#cid').value) : null,
            client_name: $('#cq').value, client_email: $('#ce').value, client_phone: $('#cph').value,
            duration_min: Number($('#ndur').value), price_cents: toCents($('#np').value), staff_notes: $('#nn').value,
            notify_client: $('#nnotify').checked, allow_overlap: $('#noverlap').checked,
          },
        });
        toast('Booked'); closeDrawer(); route();
      } catch (e) { $('#nerr').textContent = e.message; }
    };
  }

  // ---------- Clients ----------
  async function viewClients(main) {
    main.innerHTML = topbar('Clients') + `<div class="box">
      <input class="input" id="cs" type="search" placeholder="Search by name, email or phone" aria-label="Search clients" style="margin-bottom:12px">
      <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Contact</th><th>Visits</th><th>Last visit</th><th>Spent</th></tr></thead><tbody id="ct"></tbody></table></div></div>`;
    async function load(q = '') {
      const { clients } = await api(`/clients?q=${encodeURIComponent(q)}`);
      document.getElementById('ct').innerHTML = clients.map((c) => `<tr style="cursor:pointer" data-c="${c.id}" tabindex="0">
        <td class="name">${esc(c.name)}${c.no_shows ? ` <span class="pill no_show">${c.no_shows} no-show</span>` : ''}</td>
        <td class="desc">${esc(c.email)}${c.email && c.phone ? '<br>' : ''}${esc(c.phone)}</td>
        <td>${c.visits}</td><td>${c.last_visit ? shortDate(c.last_visit) : '—'}</td><td>${money(c.spent_cents)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No clients yet — they’ll appear here after their first booking.</td></tr>';
      document.querySelectorAll('[data-c]').forEach((r) => {
        r.onclick = () => openClient(Number(r.dataset.c));
        r.onkeydown = (e) => { if (e.key === 'Enter') openClient(Number(r.dataset.c)); };
      });
    }
    let t;
    document.getElementById('cs').oninput = (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value), 200); };
    load();
  }

  async function openClient(id) {
    const { client: c, history } = await api(`/clients/${id}`);
    const d = drawer(c.name, `
      <form class="form" id="cf">
        <div class="field"><label for="cn">Name</label><input id="cn" value="${esc(c.name)}"></div>
        <div class="row2">
          <div class="field"><label for="cem">Email</label><input id="cem" type="email" value="${esc(c.email)}"></div>
          <div class="field"><label for="cp">Phone</label><input id="cp" type="tel" value="${esc(c.phone)}"></div>
        </div>
        <div class="field"><label for="cno">Notes</label><textarea id="cno" rows="4" placeholder="Allergies, color formulas, preferences, pronouns…">${esc(c.notes)}</textarea></div>
      </form>
      <hr class="hr"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px">History</h3>
      <ul class="list">${history.map((h) => `<li><span class="grow"><span class="t">${esc(h.service_name)}</span> <span class="pill ${h.status}">${statusLabel[h.status]}</span><br>
        <span class="s">${shortDate(h.date)} ${minLabel(h.start_min)} · ${esc(h.staff_name)} · ${money(h.price_cents)}</span>
        ${h.staff_notes ? `<br><span class="s" style="white-space:normal">📝 ${esc(h.staff_notes)}</span>` : ''}</span></li>`).join('') || '<li class="muted">No visits yet.</li>'}</ul>`,
    `<button class="btn" id="csave" type="button">Save</button><button class="btn btn--ghost" id="cbook" type="button">Book again</button>`);
    d.querySelector('#csave').onclick = async () => {
      try {
        await api(`/clients/${id}`, { method: 'PATCH', body: { name: d.querySelector('#cn').value, email: d.querySelector('#cem').value, phone: d.querySelector('#cp').value, notes: d.querySelector('#cno').value } });
        toast('Client saved'); closeDrawer(); if (location.hash === '#/clients') route();
      } catch (e) { fail(e); }
    };
    d.querySelector('#cbook').onclick = () => {
      apptForm({ staff_id: S.me.id });
      const dd = document.querySelector('.drawer');
      dd.querySelector('#cq').value = c.name; dd.querySelector('#cid').value = c.id;
      dd.querySelector('#ce').value = c.email; dd.querySelector('#cph').value = c.phone;
    };
  }

  // ---------- Services ----------
  async function viewServices(main, who = S.me.id) {
    await refreshServices();
    const person = staffById(who);
    const mine = new Map(S.offerings.filter((o) => o.staff_id === who).map((o) => [o.service_id, o]));
    const cats = [...new Set(S.services.map((s) => s.category))];
    main.innerHTML = topbar('Services & prices', `${staffPicker(who)}<button class="btn btn--sm" id="addSvc">+ New service</button>`) + `
      <section class="box">
        <h2>${who === S.me.id ? 'Your menu' : `${esc(person.name)}’s menu`}</h2>
        <p class="muted" style="margin-bottom:12px;font-size:14px">Tick the services ${who === S.me.id ? 'you offer' : 'they offer'}. Leave price or length blank to use the shop default.</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Offer</th><th>Service</th><th>Price ($)</th><th>Length (min)</th>${isOwner() ? '<th></th>' : ''}</tr></thead>
          <tbody>${cats.map((cat) => `<tr><td colspan="5" style="padding-top:18px"><span class="eyebrow">${esc(cat)}</span></td></tr>`
            + S.services.filter((s) => s.category === cat).map((s) => {
              const o = mine.get(s.id);
              return `<tr class="svc-row ${o ? '' : 'off'}" data-s="${s.id}">
                <td><input type="checkbox" class="on" ${o ? 'checked' : ''} aria-label="Offer ${esc(s.name)}" style="width:20px;height:20px;accent-color:var(--accent)"></td>
                <td><span class="name">${esc(s.name)}</span>${s.active ? '' : ' <span class="pill cancelled">Hidden</span>'}<br><span class="desc">Default ${money(s.price_cents, s.price_from)} · ${duration(s.duration_min)}</span></td>
                <td><input type="text" inputmode="decimal" class="pr" placeholder="${dollars(s.price_cents)}" value="${o && o.price_cents != null ? dollars(o.price_cents) : ''}"></td>
                <td><input type="number" min="5" step="5" class="du" placeholder="${s.duration_min}" value="${o && o.duration_min != null ? o.duration_min : ''}"></td>
                ${isOwner() ? `<td><button class="mini" data-edit="${s.id}" type="button">Edit</button></td>` : ''}
              </tr>`;
            }).join('')).join('')}
          </tbody></table></div>
        <div style="margin-top:16px;display:flex;gap:8px"><button class="btn" id="saveMenu">Save menu</button></div>
      </section>`;
    bindPicker((id) => viewServices(main, id));
    main.querySelectorAll('.svc-row .on').forEach((cb) => cb.onchange = () => cb.closest('tr').classList.toggle('off', !cb.checked));
    main.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => serviceForm(S.services.find((s) => s.id === Number(b.dataset.edit)), () => viewServices(main, who)));
    document.getElementById('addSvc').onclick = () => serviceForm(null, () => viewServices(main, who));
    document.getElementById('saveMenu').onclick = async () => {
      const offerings = [...main.querySelectorAll('.svc-row')].filter((r) => r.querySelector('.on').checked).map((r) => ({
        service_id: Number(r.dataset.s),
        price_cents: r.querySelector('.pr').value.trim() === '' ? null : toCents(r.querySelector('.pr').value),
        duration_min: r.querySelector('.du').value === '' ? null : Number(r.querySelector('.du').value),
      }));
      try { await api(`/staff/${who}/services`, { method: 'PUT', body: { offerings } }); toast('Menu saved — live on the website'); viewServices(main, who); } catch (e) { fail(e); }
    };
  }

  function serviceForm(s, done) {
    const isNew = !s;
    s = s || { name: '', description: '', category: 'Cuts', duration_min: 30, buffer_min: 0, price_cents: 0, price_from: 0, active: 1 };
    const cats = [...new Set(S.services.map((x) => x.category))];
    const d = drawer(isNew ? 'New service' : 'Edit service', `
      <form class="form">
        <div class="field"><label for="sn">Name</label><input id="sn" value="${esc(s.name)}" required></div>
        <div class="field"><label for="sd">Description</label><textarea id="sd" rows="3">${esc(s.description)}</textarea></div>
        <div class="field"><label for="sc">Category</label><input id="sc" list="cats" value="${esc(s.category)}"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="row2">
          <div class="field"><label for="sp">Default price ($)</label><input id="sp" inputmode="decimal" value="${dollars(s.price_cents)}"></div>
          <div class="field"><label for="sdu">Length (min)</label><input id="sdu" type="number" min="5" step="5" value="${s.duration_min}"></div>
        </div>
        <div class="field"><label for="sb">Clean-up buffer after (min)</label><input id="sb" type="number" min="0" step="5" value="${s.buffer_min}"><span class="hint">Blocks time after the appointment, e.g. for processing or cleaning.</span></div>
        <label class="switch"><input type="checkbox" id="sf" ${s.price_from ? 'checked' : ''}> Show as “from” price</label>
        ${isNew ? '' : `<label class="switch"><input type="checkbox" id="sa" ${s.active ? 'checked' : ''}> Visible &amp; bookable</label>`}
        ${isNew ? '<p class="hint" style="color:var(--muted);font-size:13px">It’ll be added to your menu automatically.</p>' : ''}
      </form>`,
    `<button class="btn" id="ss" type="button">${isNew ? 'Add service' : 'Save'}</button>${isNew ? '' : '<button class="btn btn--danger" id="sdel" type="button">Delete</button>'}`);
    const $ = (q) => d.querySelector(q);
    $('#ss').onclick = async () => {
      const body = {
        name: $('#sn').value, description: $('#sd').value, category: $('#sc').value,
        price_cents: toCents($('#sp').value) || 0, duration_min: Number($('#sdu').value), buffer_min: Number($('#sb').value) || 0,
        price_from: $('#sf').checked,
      };
      if (!isNew) body.active = $('#sa').checked;
      try {
        if (isNew) await api('/services', { method: 'POST', body }); else await api(`/services/${s.id}`, { method: 'PATCH', body });
        toast('Service saved'); closeDrawer(); done();
      } catch (e) { fail(e); }
    };
    if (!isNew) $('#sdel').onclick = async () => {
      if (!confirm(`Delete “${s.name}”? Services with past bookings are hidden instead.`)) return;
      try { const r = await api(`/services/${s.id}`, { method: 'DELETE' }); toast(r.archived ? 'Hidden (has booking history)' : 'Deleted'); closeDrawer(); done(); } catch (e) { fail(e); }
    };
  }

  // ---------- Hours & time off ----------
  async function viewSchedule(main, who = S.me.id) {
    const [{ hours }, { time_off: off }] = await Promise.all([api(`/staff/${who}/hours`), api(`/staff/${who}/time-off`)]);
    const editable = canEdit(who);
    const order = [1, 2, 3, 4, 5, 6, 0];
    main.innerHTML = topbar('Hours & time off', staffPicker(who)) + `<div class="two">
      <section class="box"><h2>Weekly hours</h2>
        <p class="muted" style="font-size:14px;margin-bottom:8px">Clients can only book inside these hours. Add a second shift to leave room for a break.</p>
        <div id="week">${order.map((wd) => `<div class="day-row" data-wd="${wd}"><span class="d">${DAYS[wd]}</span><div class="shifts">
          ${hours.filter((h) => h.weekday === wd).map((h) => shiftRow(h.start_min, h.end_min)).join('') || '<span class="muted closedtxt" style="padding-top:8px">Off</span>'}
          <button class="mini add" type="button">+ Add hours</button></div></div>`).join('')}</div>
        <button class="btn" id="saveHours" style="margin-top:16px">Save hours</button>
      </section>
      <section class="box"><h2>Time off &amp; blocked time</h2>
        <form class="form" id="toForm">
          <div class="row2">
            <div class="field"><label for="tos">From</label><input id="tos" type="date" value="${S.today}" required></div>
            <div class="field"><label for="toe">To</label><input id="toe" type="date" value="${S.today}"></div>
          </div>
          <label class="switch"><input type="checkbox" id="toPart"> Only part of the day</label>
          <div class="row2" id="toTimes" hidden>
            <div class="field"><label for="tst">Start</label><input id="tst" type="time" value="12:00"></div>
            <div class="field"><label for="tet">End</label><input id="tet" type="time" value="13:00"></div>
          </div>
          <div class="field"><label for="tor">Reason (only staff see this)</label><input id="tor" placeholder="Vacation, lunch, education…"></div>
          <button class="btn btn--ghost" type="submit">Block this time</button>
        </form>
        <ul class="list" style="margin-top:16px">${off.map((t) => `<li><span class="grow"><span class="t">${esc(t.reason || 'Time off')}</span><br>
          <span class="s">${shortDate(t.date_start)}${t.date_end !== t.date_start ? ` – ${shortDate(t.date_end)}` : ''}${t.start_min != null ? ` · ${minLabel(t.start_min)}–${minLabel(t.end_min)}` : ' · all day'}</span></span>
          ${editable ? `<button class="mini danger" data-del="${t.id}">Remove</button>` : ''}</li>`).join('') || '<li class="muted">No upcoming time off.</li>'}</ul>
      </section></div>`;
    bindPicker((id) => viewSchedule(main, id));
    const week = document.getElementById('week');
    week.addEventListener('click', (e) => {
      if (e.target.classList.contains('add')) {
        const box = e.target.parentElement;
        const ct = box.querySelector('.closedtxt'); if (ct) ct.remove();
        const last = [...box.querySelectorAll('.shift')].pop();
        const start = last ? fromHHMM(last.querySelector('.e').value) + 60 : 600;
        e.target.insertAdjacentHTML('beforebegin', shiftRow(Math.min(start, 1320), Math.min(start + 240, 1440)));
      }
      if (e.target.classList.contains('rm')) e.target.closest('.shift').remove();
    });
    document.getElementById('saveHours').onclick = async () => {
      const rows = [];
      for (const r of week.querySelectorAll('.day-row')) {
        for (const s of r.querySelectorAll('.shift')) {
          rows.push({ weekday: Number(r.dataset.wd), start_min: fromHHMM(s.querySelector('.s').value), end_min: fromHHMM(s.querySelector('.e').value) });
        }
      }
      try { await api(`/staff/${who}/hours`, { method: 'PUT', body: { hours: rows } }); toast('Hours saved'); viewSchedule(main, who); } catch (e) { fail(e); }
    };
    document.getElementById('toPart').onchange = (e) => { document.getElementById('toTimes').hidden = !e.target.checked; };
    document.getElementById('toForm').onsubmit = async (e) => {
      e.preventDefault();
      const part = document.getElementById('toPart').checked;
      try {
        const r = await api(`/staff/${who}/time-off`, {
          method: 'POST',
          body: {
            date_start: document.getElementById('tos').value, date_end: document.getElementById('toe').value || document.getElementById('tos').value,
            start_min: part ? fromHHMM(document.getElementById('tst').value) : null, end_min: part ? fromHHMM(document.getElementById('tet').value) : null,
            reason: document.getElementById('tor').value,
          },
        });
        toast(r.conflicts ? `Blocked. Heads up: ${r.conflicts} existing booking(s) fall in that time.` : 'Time blocked', !!r.conflicts);
        viewSchedule(main, who);
      } catch (ex) { fail(ex); }
    };
    main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      try { await api(`/time-off/${b.dataset.del}`, { method: 'DELETE' }); toast('Removed'); viewSchedule(main, who); } catch (e) { fail(e); }
    });
  }
  const shiftRow = (s, e) => `<div class="shift"><input type="time" class="s" value="${hhmm(s)}" aria-label="Start"> to <input type="time" class="e" value="${hhmm(Math.min(e, 1439))}" aria-label="End"><button class="mini danger rm" type="button">Remove</button></div>`;

  // ---------- Profile ----------
  async function viewProfile(main, who = S.me.id) {
    const { staff } = await api('/staff');
    S.staff = staff;
    const p = staffById(who);
    const self = who === S.me.id;
    main.innerHTML = topbar('Profile', staffPicker(who)) + `<div class="two">
      <section class="box"><h2>${self ? 'Your public profile' : `${esc(p.name)}’s profile`}</h2>
        <form class="form" id="pf">
          <div class="photo-edit">${avatar(p, 80)}<div><label class="btn btn--ghost btn--sm" style="cursor:pointer">Upload photo<input type="file" id="ph" accept="image/png,image/jpeg,image/webp" hidden></label>
            ${p.photo_url ? '<button type="button" class="mini danger" id="phx">Remove</button>' : ''}</div></div>
          <div class="row2">
            <div class="field"><label for="pn">Name</label><input id="pn" value="${esc(p.name)}"></div>
            <div class="field"><label for="pt">Title</label><input id="pt" value="${esc(p.title)}" placeholder="Barber, Colorist…"></div>
          </div>
          <div class="field"><label for="pb">Bio</label><textarea id="pb" rows="5">${esc(p.bio)}</textarea></div>
          <div class="row2">
            <div class="field"><label for="pi">Instagram</label><input id="pi" value="${esc(p.instagram)}" placeholder="username"></div>
            <div class="field"><label for="pc">Calendar color</label><input id="pc" type="color" value="${esc(p.color)}" style="height:48px;padding:4px"></div>
          </div>
          <div class="field"><label for="pe">Sign-in email</label><input id="pe" type="email" value="${esc(p.email)}"></div>
          <label class="switch"><input type="checkbox" id="pa" ${p.accepts_bookings ? 'checked' : ''}> Accept online bookings</label>
          <button class="btn" type="submit">Save profile</button>
        </form>
      </section>
      ${self ? `<div>
        <section class="box"><h2>Sync to your phone calendar</h2>
          <p class="muted" style="font-size:14px;margin-bottom:10px">Subscribe to this private link in Apple Calendar, Google Calendar or Outlook to see your bookings there. Anyone with the link can see your appointments — keep it private.</p>
          <div class="copy"><input class="input" id="feed" readonly value="${esc(S.me.feed_url)}"><button class="btn btn--sm" id="copyFeed" type="button">Copy</button></div>
          <p style="margin-top:10px"><button class="mini danger" id="resetFeed" type="button">Reset link</button></p>
        </section>
        <section class="box"><h2>Change password</h2>
          <form class="form" id="pwf">
            <div class="field"><label for="pw1">Current password</label><input id="pw1" type="password" autocomplete="current-password"></div>
            <div class="field"><label for="pw2">New password</label><input id="pw2" type="password" autocomplete="new-password" minlength="8"></div>
            <button class="btn btn--ghost" type="submit">Update password</button>
          </form>
        </section></div>` : ''}
    </div>`;
    bindPicker((id) => viewProfile(main, id));
    const $ = (q) => main.querySelector(q);
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/staff/${who}`, { method: 'PATCH', body: { name: $('#pn').value, title: $('#pt').value, bio: $('#pb').value, instagram: $('#pi').value, color: $('#pc').value, email: $('#pe').value, accepts_bookings: $('#pa').checked } });
        toast('Profile saved'); await refreshMe(); viewProfile(main, who);
      } catch (ex) { fail(ex); }
    };
    $('#ph').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) { toast('Please choose an image under 4 MB', true); return; }
      const r = new FileReader();
      r.onload = async () => {
        try { await api(`/staff/${who}/photo`, { method: 'POST', body: { data_url: r.result } }); toast('Photo updated'); await refreshMe(); viewProfile(main, who); } catch (ex) { fail(ex); }
      };
      r.readAsDataURL(f);
    };
    if ($('#phx')) $('#phx').onclick = async () => { await api(`/staff/${who}`, { method: 'PATCH', body: { photo_url: '' } }); await refreshMe(); viewProfile(main, who); };
    if (self) {
      $('#copyFeed').onclick = () => { navigator.clipboard.writeText($('#feed').value).then(() => toast('Copied')); };
      $('#resetFeed').onclick = async () => {
        if (!confirm('Reset your calendar link? Calendars subscribed to the old link will stop updating.')) return;
        await api('/me/feed/reset', { method: 'POST' }); await refreshMe(); viewProfile(main, who); toast('New link created');
      };
      $('#pwf').onsubmit = async (e) => {
        e.preventDefault();
        try { await api('/me/password', { method: 'POST', body: { current: $('#pw1').value, next: $('#pw2').value } }); toast('Password updated'); e.target.reset(); } catch (ex) { fail(ex); }
      };
    }
  }

  // ---------- Shop & team (owners) ----------
  async function viewShop(main) {
    if (!isOwner()) { main.innerHTML = topbar('Shop') + '<p class="muted">Only owners can change shop settings.</p>'; return; }
    const [{ staff }, me] = await Promise.all([api('/staff'), api('/me')]);
    S.staff = staff; const st = me.settings;
    const f = (k, label, type = 'text', hint = '') => `<div class="field"><label for="s_${k}">${label}</label><input id="s_${k}" type="${type}" value="${esc(st[k])}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    const ta = (k, label, hint = '') => `<div class="field"><label for="s_${k}">${label}</label><textarea id="s_${k}" rows="3">${esc(st[k])}</textarea>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    main.innerHTML = topbar('Shop & team') + `<div class="two">
      <section class="box"><h2>Shop details</h2>
        <form class="form" id="sf">
          ${f('shop_name', 'Shop name')}
          <div class="row2">${f('address_line1', 'Street address')}${f('address_line2', 'City, state, ZIP')}</div>
          <div class="row2">${f('phone', 'Phone', 'tel')}${f('email', 'Public email', 'email')}</div>
          ${f('instagram', 'Instagram username')}
          ${f('announcement', 'Website banner', 'text', 'Optional. Shown at the top of the home page — e.g. holiday hours or “Vote for us in Best of Baltimore!”')}
          <hr class="hr"><h2>Booking rules</h2>
          <label class="switch"><input type="checkbox" id="s_booking_enabled" ${st.booking_enabled ? 'checked' : ''}> Online booking is on</label>
          <div class="row2">
            <div class="field"><label for="s_slot_interval_min">Start times every</label><select id="s_slot_interval_min">${[5, 10, 15, 20, 30, 60].map((n) => `<option ${n === st.slot_interval_min ? 'selected' : ''} value="${n}">${n} minutes</option>`).join('')}</select></div>
            ${f('min_notice_min', 'Minimum notice (minutes)', 'number', 'How soon before a slot clients can still book it.')}
          </div>
          <div class="row2">
            ${f('max_days_ahead', 'Book up to (days ahead)', 'number')}
            ${f('cancel_cutoff_hours', 'Online cancel/reschedule cutoff (hours)', 'number')}
          </div>
          ${ta('booking_note', 'Booking note', 'Shown on the booking summary.')}
          ${ta('cancellation_policy', 'Cancellation policy', 'Shown before clients confirm and in emails.')}
          <button class="btn" type="submit">Save shop settings</button>
        </form>
      </section>
      <section class="box"><h2>Team</h2>
        <ul class="list">${staff.map((p) => `<li>${avatar(p, 40)}<span class="grow"><span class="t">${esc(p.name)}</span> ${p.role === 'owner' ? '<span class="pill">Owner</span>' : ''} ${p.active ? '' : '<span class="pill cancelled">Inactive</span>'}<br><span class="s">${esc(p.email)}</span></span>
          <button class="mini" data-team="${p.id}">Manage</button></li>`).join('')}</ul>
        <hr class="hr"><h2>Add a team member</h2>
        <form class="form" id="nf">
          <div class="row2"><div class="field"><label for="nfn">Name</label><input id="nfn" required></div><div class="field"><label for="nfe">Email</label><input id="nfe" type="email" required></div></div>
          <div class="row2"><div class="field"><label for="nft">Title</label><input id="nft" placeholder="Barber"></div>
            <div class="field"><label for="nfr">Access</label><select id="nfr"><option value="barber">Stylist — own calendar &amp; menu</option><option value="owner">Owner — everything</option></select></div></div>
          <button class="btn btn--ghost" type="submit">Add &amp; create login</button>
        </form>
      </section></div>`;
    const $ = (q) => main.querySelector(q);
    $('#sf').onsubmit = async (e) => {
      e.preventDefault();
      const body = {};
      for (const k of ['shop_name', 'address_line1', 'address_line2', 'phone', 'email', 'instagram', 'announcement', 'booking_note', 'cancellation_policy']) body[k] = $(`#s_${k}`).value;
      for (const k of ['slot_interval_min', 'min_notice_min', 'max_days_ahead', 'cancel_cutoff_hours']) body[k] = Number($(`#s_${k}`).value);
      body.booking_enabled = $('#s_booking_enabled').checked;
      try { const r = await api('/settings', { method: 'PUT', body }); S.settings = r.settings; toast('Shop settings saved'); } catch (ex) { fail(ex); }
    };
    $('#nf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/staff', { method: 'POST', body: { name: $('#nfn').value, email: $('#nfe').value, title: $('#nft').value, role: $('#nfr').value, color: '#' + Math.floor(Math.random() * 0x777777 + 0x222222).toString(16) } });
        showTemp($('#nfn').value, $('#nfe').value, r.temp_password);
      } catch (ex) { fail(ex); }
    };
    main.querySelectorAll('[data-team]').forEach((b) => b.onclick = () => teamDrawer(staffById(Number(b.dataset.team)), () => viewShop(main)));
  }

  function showTemp(name, email, pw) {
    drawer('Login created', `<p>Share these sign-in details with <b>${esc(name)}</b>. They’ll choose their own password the first time they sign in.</p>
      <dl class="kv" style="margin-top:16px"><dt>Sign in at</dt><dd>${esc(location.origin)}/admin/</dd><dt>Email</dt><dd>${esc(email)}</dd><dt>Temporary password</dt><dd><code style="font-size:16px">${esc(pw)}</code></dd></dl>
      <p class="muted" style="font-size:14px">Next: set their services in <b>Services</b> and check their hours in <b>Hours &amp; time off</b>.</p>`,
    '<button class="btn" type="button" id="okT">Done</button>');
    document.getElementById('okT').onclick = () => { closeDrawer(); route(); };
  }

  function teamDrawer(p, done) {
    const self = p.id === S.me.id;
    const d = drawer(p.name, `
      <div class="form">
        <div class="field"><label for="tr">Access</label><select id="tr" ${self ? 'disabled' : ''}><option value="barber" ${p.role === 'barber' ? 'selected' : ''}>Stylist — own calendar &amp; menu</option><option value="owner" ${p.role === 'owner' ? 'selected' : ''}>Owner — everything</option></select></div>
        <div class="field"><label for="to">Order on website</label><input id="to" type="number" value="${p.sort_order}"></div>
        <label class="switch"><input type="checkbox" id="ta" ${p.active ? 'checked' : ''} ${self ? 'disabled' : ''}> Active (can sign in, shown on site)</label>
      </div>
      <hr class="hr">
      <p class="muted" style="font-size:14px;margin-bottom:8px">Locked out? Create a new temporary password.</p>
      <button class="btn btn--ghost btn--sm" id="trp" type="button">Reset password</button>
      <p style="margin-top:16px;display:grid;gap:6px"><a class="link" href="#/schedule" id="gh">Edit their hours →</a><a class="link" href="#/services" id="gs">Edit their services →</a><a class="link" href="#/profile" id="gp">Edit their profile →</a></p>`,
    '<button class="btn" id="tsave" type="button">Save</button>');
    const go = (fn) => (e) => { e.preventDefault(); closeDrawer(); const r = e.currentTarget.getAttribute('href'); location.hash = r; setTimeout(() => fn(document.getElementById('main'), p.id), 50); };
    d.querySelector('#gh').onclick = go(viewSchedule);
    d.querySelector('#gs').onclick = go(viewServices);
    d.querySelector('#gp').onclick = go(viewProfile);
    d.querySelector('#tsave').onclick = async () => {
      const body = { sort_order: Number(d.querySelector('#to').value) };
      if (!self) { body.role = d.querySelector('#tr').value; body.active = d.querySelector('#ta').checked; }
      try { await api(`/staff/${p.id}`, { method: 'PATCH', body }); toast('Saved'); closeDrawer(); done(); } catch (e) { fail(e); }
    };
    d.querySelector('#trp').onclick = async () => {
      if (!confirm(`Reset ${p.name}’s password? They’ll be signed out everywhere.`)) return;
      try { const r = await api(`/staff/${p.id}/reset-password`, { method: 'POST' }); showTemp(p.name, p.email, r.temp_password); } catch (e) { fail(e); }
    };
  }

  // ---------- routing / boot ----------
  async function refreshMe() {
    const r = await api('/me');
    S.me = r.me; S.settings = r.settings; S.today = r.today;
    S.staff = (await api('/staff')).staff;
  }
  async function refreshServices() {
    const r = await api('/services');
    S.services = r.services; S.offerings = r.offerings;
  }

  const VIEWS = { today: viewToday, calendar: viewCalendar, clients: viewClients, services: viewServices, schedule: viewSchedule, profile: viewProfile, shop: viewShop };

  async function route() {
    if (!S.me) return;
    closeDrawer();
    document.querySelectorAll('.more-menu').forEach((n) => n.remove());
    const key = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'today';
    const view = VIEWS[key] || viewToday;
    const main = shell(VIEWS[key] ? key : 'today');
    try { await view(main); } catch (e) { if (S.me) main.insertAdjacentHTML('beforeend', `<p class="alert">${esc(e.message)}</p>`); }
  }

  async function boot() {
    try {
      const r = await api('/me', { noAuthRedirect: true });
      S.me = r.me; S.settings = r.settings; S.today = r.today;
      if (S.me.must_change_pw) { renderChangePassword(); return; }
      S.staff = (await api('/staff')).staff;
      await refreshServices();
      route();
    } catch { renderLogin(); }
  }

  window.addEventListener('hashchange', route);
  boot();
}());
