(function () {
  'use strict';
  const S = window.Shoppe;
  const { esc, api, money, minLabel, duration, addDays, parseDate, longDate, avatar } = S;
  const panel = document.getElementById('panel');
  const summary = document.getElementById('summary');
  const stepsEl = document.getElementById('steps');
  const PAGE = 14;

  const params = new URLSearchParams(location.search);
  const state = {
    step: 'service', service: null, staff: null, date: null, slot: null,
    lockedStaff: params.get('staff') ? Number(params.get('staff')) : null,
    pageStart: null, days: [], slots: [], details: { name: '', email: '', phone: '', notes: '' },
  };
  let data;

  const staffById = (id) => data.staff.find((s) => s.id === id);
  const offering = (svc, staffId) => svc.staff.find((o) => o.staff_id === staffId);

  function priceFor() {
    const svc = state.service;
    if (!svc) return null;
    if (state.staff && state.staff !== 'any') {
      const o = offering(svc, state.staff);
      return { cents: o.price_cents, from: !!svc.price_from, mins: o.duration_min };
    }
    return { cents: svc.min_price_cents, from: svc.price_from || svc.price_varies, mins: svc.duration_min };
  }

  // ---------- summary + progress ----------
  function renderChrome() {
    const order = ['service', 'staff', 'time', 'details'];
    const idx = order.indexOf(state.step);
    [...stepsEl.children].forEach((li, i) => { li.className = i < idx ? 'done' : i === idx ? 'current' : ''; });
    stepsEl.hidden = state.step === 'done';
    if (!state.service || state.step === 'done') { summary.hidden = true; return; }
    summary.hidden = false;
    const p = priceFor();
    const who = state.staff === 'any' ? 'First available' : state.staff ? staffById(state.staff).name : '—';
    let slotStaff = '';
    if (state.staff === 'any' && state.slot && state.slot.staff_ids.length === 1) slotStaff = ` (${esc(staffById(state.slot.staff_ids[0]).name)})`;
    summary.innerHTML = `
      <h3>Your appointment</h3>
      <dl>
        <div><dt>Service</dt><dd>${esc(state.service.name)} · ${duration(p.mins)}</dd></div>
        <div><dt>With</dt><dd>${esc(who)}${slotStaff}</dd></div>
        <div><dt>When</dt><dd>${state.date ? longDate(state.date) : '—'}${state.slot ? `<br>${minLabel(state.slot.start_min)}` : ''}</dd></div>
        <div><dt>Where</dt><dd>${esc(data.shop.address_line1)}<br>${esc(data.shop.address_line2)}</dd></div>
      </dl>
      <div class="total" style="margin-top:16px"><span>Total</span><span>${money(p.cents, p.from)}</span></div>
      <p class="note">Pay at the shop. ${esc(data.shop.booking_note || '')}</p>`;
  }

  function go(step) {
    state.step = step;
    ({ service: renderServices, staff: renderStaff, time: renderTime, details: renderDetails })[step]();
    renderChrome();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const h = panel.querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  const backBtn = (to, label = 'Back') => `<button class="back" type="button" data-back="${to}">← ${label}</button>`;
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-back]');
    if (b) go(b.dataset.back);
  });

  // ---------- step 1: service ----------
  function renderServices() {
    let services = data.services;
    if (state.lockedStaff) services = services.filter((s) => offering(s, state.lockedStaff));
    const cats = [...new Set(services.map((s) => s.category))];
    const locked = state.lockedStaff && staffById(state.lockedStaff);
    panel.innerHTML = `
      <h2>Choose a service</h2>
      <p class="sub">${locked ? `Booking with ${esc(locked.name)}. <button class="link" type="button" id="anyone">See everyone’s services</button>` : 'Not sure? A consultation is free.'}</p>
      ${cats.map((c) => `
        <p class="cat-title">${esc(c)}</p>
        <div class="opts">
          ${services.filter((s) => s.category === c).map((s) => {
            const o = locked ? offering(s, locked.id) : null;
            const cents = o ? o.price_cents : s.min_price_cents;
            const from = s.price_from || (!o && s.price_varies);
            return `<button class="opt opt--plain" type="button" data-service="${s.id}" aria-pressed="${state.service && state.service.id === s.id}">
              <span><span class="opt__title">${esc(s.name)}</span><br><span class="opt__desc">${esc(s.description)}</span></span>
              <span class="opt__end">${money(cents, from)}<small>${duration(o ? o.duration_min : s.duration_min)}</small></span>
            </button>`;
          }).join('')}
        </div>`).join('')}`;
    const anyone = document.getElementById('anyone');
    if (anyone) anyone.onclick = () => { state.lockedStaff = null; state.staff = null; renderServices(); };
    panel.querySelectorAll('[data-service]').forEach((b) => b.addEventListener('click', () => {
      state.service = data.services.find((s) => s.id === Number(b.dataset.service));
      state.slot = null; state.date = null;
      if (state.lockedStaff) { state.staff = state.lockedStaff; go('time'); } else if (state.service.staff.length === 1) {
        state.staff = state.service.staff[0].staff_id; go('time');
      } else go('staff');
    }));
  }

  // ---------- step 2: stylist ----------
  function renderStaff() {
    const svc = state.service;
    const people = svc.staff.map((o) => ({ ...staffById(o.staff_id), o })).filter((p) => p.accepts_bookings);
    panel.innerHTML = `
      ${backBtn('service', 'Services')}
      <h2>Who would you like?</h2>
      <p class="sub">${esc(svc.name)}</p>
      <div class="opts">
        <button class="opt" type="button" data-staff="any" aria-pressed="${state.staff === 'any'}">
          <span class="avatar" style="background:var(--ink)">✦</span>
          <span><span class="opt__title">First available</span><br><span class="opt__desc">See the most open times</span></span>
          <span class="opt__end"></span>
        </button>
        ${people.map((p) => `
          <button class="opt" type="button" data-staff="${p.id}" aria-pressed="${state.staff === p.id}">
            ${avatar(p)}
            <span><span class="opt__title">${esc(p.name)}</span><br><span class="opt__desc">${esc(p.title)}</span></span>
            <span class="opt__end">${money(p.o.price_cents, svc.price_from)}<small>${duration(p.o.duration_min)}</small></span>
          </button>`).join('')}
      </div>`;
    panel.querySelectorAll('[data-staff]').forEach((b) => b.addEventListener('click', () => {
      state.staff = b.dataset.staff === 'any' ? 'any' : Number(b.dataset.staff);
      state.slot = null; state.date = null;
      go('time');
    }));
  }

  // ---------- step 3: date + time ----------
  async function loadDays() {
    const q = `service=${state.service.id}&staff=${state.staff}&from=${state.pageStart}&days=${PAGE}`;
    state.days = (await api(`/availability/days?${q}`)).days;
  }

  async function loadSlots() {
    const box = document.getElementById('slots');
    box.innerHTML = '<div class="spinner" aria-label="Loading times"></div>';
    const q = `service=${state.service.id}&staff=${state.staff}&date=${state.date}`;
    state.slots = (await api(`/availability?${q}`)).slots;
    renderSlots();
  }

  function renderSlots() {
    const box = document.getElementById('slots');
    if (!state.slots.length) { box.innerHTML = '<p class="empty">No openings this day — try another date.</p>'; return; }
    const groups = [['Morning', (m) => m < 720], ['Afternoon', (m) => m >= 720 && m < 1020], ['Evening', (m) => m >= 1020]];
    box.innerHTML = groups.map(([label, test]) => {
      const list = state.slots.filter((s) => test(s.start_min));
      if (!list.length) return '';
      return `<p class="slot-group">${label}</p><div class="slots">${list.map((s) =>
        `<button class="slot" type="button" data-slot="${s.start_min}" aria-pressed="${state.slot && state.slot.start_min === s.start_min}">${minLabel(s.start_min)}</button>`).join('')}</div>`;
    }).join('');
    box.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => {
      state.slot = state.slots.find((s) => s.start_min === Number(b.dataset.slot));
      go('details');
    }));
  }

  async function renderTime() {
    const svc = state.service;
    const today = data.today;
    if (!state.pageStart) state.pageStart = today;
    const back = state.lockedStaff || svc.staff.length === 1 ? 'service' : 'staff';
    panel.innerHTML = `
      ${backBtn(back)}
      <h2>Pick a time</h2>
      <p class="sub">${esc(svc.name)} · ${state.staff === 'any' ? 'first available' : esc(staffById(state.staff).name)}</p>
      <div class="day-nav">
        <button class="icon-btn" type="button" id="prev" aria-label="Earlier dates">‹</button>
        <strong id="monthLabel"></strong>
        <button class="icon-btn" type="button" id="next" aria-label="Later dates">›</button>
      </div>
      <div class="days" id="days"><div class="spinner"></div></div>
      <div id="slots"></div>`;
    const maxStart = addDays(today, data.shop.max_days_ahead);

    async function paint() {
      const daysEl = document.getElementById('days');
      document.getElementById('prev').disabled = state.pageStart <= today;
      document.getElementById('next').disabled = addDays(state.pageStart, PAGE) > maxStart;
      try { await loadDays(); } catch (err) { daysEl.innerHTML = `<p class="alert">${esc(err.message)}</p>`; return; }
      const first = parseDate(state.days[0].date);
      document.getElementById('monthLabel').textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      daysEl.innerHTML = state.days.map((d) => {
        const dt = parseDate(d.date);
        return `<button class="day" type="button" data-date="${d.date}" ${d.open ? '' : 'disabled'} aria-pressed="${state.date === d.date}"
          aria-label="${longDate(d.date)}${d.open ? '' : ', no openings'}">
          <small>${dt.toLocaleDateString('en-US', { weekday: 'short' })}</small><strong>${dt.getDate()}</strong></button>`;
      }).join('');
      daysEl.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => {
        state.date = b.dataset.date; state.slot = null;
        daysEl.querySelectorAll('.day').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderChrome();
        loadSlots().catch((err) => { document.getElementById('slots').innerHTML = `<p class="alert">${esc(err.message)}</p>`; });
      }));
      const slotsEl = document.getElementById('slots');
      if (state.date && state.days.some((d) => d.date === state.date && d.open)) {
        loadSlots();
      } else {
        const firstOpen = state.days.find((d) => d.open);
        if (firstOpen) daysEl.querySelector(`[data-date="${firstOpen.date}"]`).click();
        else slotsEl.innerHTML = '<p class="empty">No openings in these two weeks. Try the next dates →</p>';
      }
    }
    document.getElementById('prev').onclick = () => { state.pageStart = addDays(state.pageStart, -PAGE); if (state.pageStart < today) state.pageStart = today; paint(); };
    document.getElementById('next').onclick = () => { state.pageStart = addDays(state.pageStart, PAGE); paint(); };
    paint();
  }

  // ---------- step 4: details ----------
  function renderDetails() {
    const d = state.details;
    panel.innerHTML = `
      ${backBtn('time', 'Change time')}
      <h2>Your details</h2>
      <p class="sub">${longDate(state.date)} at ${minLabel(state.slot.start_min)}</p>
      <form class="form" id="form" novalidate>
        <div class="field"><label for="name">Name</label><input id="name" name="name" autocomplete="name" required value="${esc(d.name)}"></div>
        <div class="row2">
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required value="${esc(d.email)}">
            <span class="hint">We’ll send your confirmation here.</span></div>
          <div class="field"><label for="phone">Phone <span class="hint">(optional)</span></label><input id="phone" name="phone" type="tel" autocomplete="tel" value="${esc(d.phone)}"></div>
        </div>
        <div class="field"><label for="notes">Anything we should know? <span class="hint">(optional)</span></label>
          <textarea id="notes" name="notes" rows="3" placeholder="Inspiration, hair history, pronouns, access needs…">${esc(d.notes)}</textarea></div>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="note" style="margin:0">${esc(data.shop.cancellation_policy)}</p>
        <p class="alert" id="err" role="alert"></p>
        <button class="btn btn--accent btn--block" type="submit" id="submit">Confirm booking</button>
      </form>`;
    const form = document.getElementById('form');
    form.addEventListener('input', () => { for (const k of ['name', 'email', 'phone', 'notes']) state.details[k] = form[k].value; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('err');
      err.textContent = '';
      if (!form.name.value.trim()) { err.textContent = 'Please enter your name.'; form.name.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim())) { err.textContent = 'Please enter a valid email.'; form.email.focus(); return; }
      const btn = document.getElementById('submit');
      btn.disabled = true; btn.textContent = 'Booking…';
      try {
        const res = await api('/bookings', {
          method: 'POST',
          body: {
            service_id: state.service.id, staff_id: state.staff, date: state.date, start_min: state.slot.start_min,
            name: form.name.value, email: form.email.value, phone: form.phone.value, notes: form.notes.value, website: form.website.value,
          },
        });
        renderDone(res.appointment);
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false; btn.textContent = 'Confirm booking';
        if (ex.status === 409) {
          err.innerHTML = `${esc(ex.message)} <button class="link" type="button" data-back="time">Pick another time</button>`;
        }
      }
    });
  }

  function renderDone(a) {
    state.step = 'done';
    renderChrome();
    try { localStorage.setItem('shoppe:lastBooking', a.token); } catch { /* ignore */ }
    panel.innerHTML = `
      <div class="confirm">
        <div class="confirm__check" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></div>
        <h2>You’re booked!</h2>
        <p class="sub">A confirmation is on its way to your inbox.</p>
        <dl>
          <dt>What</dt><dd>${esc(a.service_name)}</dd>
          <dt>With</dt><dd>${esc(a.staff_name)}</dd>
          <dt>When</dt><dd>${longDate(a.date)}<br>${minLabel(a.start_min)} – ${minLabel(a.end_min)}</dd>
          <dt>Where</dt><dd>${esc(data.shop.address_line1)}<br>${esc(data.shop.address_line2)}</dd>
          <dt>Price</dt><dd>${money(a.price_cents, state.service.price_from)}</dd>
        </dl>
        <div class="confirm__actions">
          <a class="btn" href="/api/bookings/${encodeURIComponent(a.token)}/calendar.ics">Add to calendar</a>
          <a class="btn btn--ghost" href="/manage?t=${encodeURIComponent(a.token)}">Reschedule or cancel</a>
        </div>
        <p class="note">Save this page or use the link in your email to make changes.</p>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- boot ----------
  api('/shop').then((d) => {
    data = d;
    if (!d.shop.booking_enabled) {
      panel.innerHTML = `<h2>Online booking is paused</h2><p class="sub" style="margin-top:8px">Please reach out on Instagram <a class="link" href="https://instagram.com/${esc(d.shop.instagram)}">@${esc(d.shop.instagram)}</a>${d.shop.phone ? ` or call ${esc(d.shop.phone)}` : ''}.</p>`;
      return;
    }
    if (state.lockedStaff && !staffById(state.lockedStaff)) state.lockedStaff = null;
    const pre = Number(params.get('service'));
    const svc = pre && d.services.find((s) => s.id === pre);
    if (svc) {
      state.service = svc;
      if (state.lockedStaff && offering(svc, state.lockedStaff)) { state.staff = state.lockedStaff; go('time'); return; }
      if (svc.staff.length === 1) { state.staff = svc.staff[0].staff_id; go('time'); return; }
      go('staff');
      return;
    }
    go('service');
  }).catch((err) => { panel.innerHTML = `<p class="alert">${esc(err.message)}</p>`; });
}());
