(function () {
  'use strict';
  const { api, esc, money, duration, DAYS, minLabel } = window.Shoppe;
  const IG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>';

  let data;
  let filter = 'All';

  function renderMenu() {
    const cats = ['All', ...new Set(data.services.map((s) => s.category))];
    document.getElementById('menuTabs').innerHTML = cats.map((c) =>
      `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === filter}">${esc(c)}</button>`).join('');
    const staffById = Object.fromEntries(data.staff.map((s) => [s.id, s]));
    const list = data.services.filter((s) => filter === 'All' || s.category === filter);
    document.getElementById('menu').innerHTML = list.map((s) => {
      const who = s.staff.map((o) => staffById[o.staff_id]).filter(Boolean);
      const from = s.price_from || s.price_varies;
      return `<article class="menu__item">
        <h3>${esc(s.name)}</h3>
        <div class="menu__price">${money(s.min_price_cents, from)}<small>${duration(s.duration_min)}</small></div>
        <p class="menu__desc">${esc(s.description)}</p>
        <div class="menu__meta">
          ${who.map((p) => `<span><i class="dot" style="background:${esc(p.color)}"></i>${esc(p.name)}</span>`).join('')}
          <a href="/book?service=${s.id}">Book →</a>
        </div>
      </article>`;
    }).join('') || '<p class="empty">No services listed yet.</p>';
  }

  function renderTeam() {
    document.getElementById('teamList').innerHTML = data.staff.map((p) => `
      <article class="person">
        <div class="person__photo" style="${p.photo_url ? '' : `background:${esc(p.color)}`}">
          ${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="${esc(p.name)}">` : `<span class="person__initial">${esc(p.name[0])}</span>`}
        </div>
        <div class="person__body">
          <h3>${esc(p.name)}</h3>
          <p class="person__role">${esc(p.title)}</p>
          <p class="person__bio">${esc(p.bio)}</p>
          <div class="person__actions">
            ${p.accepts_bookings ? `<a class="btn btn--sm" href="/book?staff=${p.id}">Book with ${esc(p.name)}</a>` : ''}
            ${p.instagram ? `<a class="ig" href="https://instagram.com/${esc(p.instagram)}" target="_blank" rel="noopener">${IG}@${esc(p.instagram)}</a>` : ''}
          </div>
        </div>
      </article>`).join('');
  }

  function renderVisit() {
    const { shop } = data;
    document.getElementById('address').innerHTML = `<strong>${esc(shop.address_line1)}</strong><br>${esc(shop.address_line2)}`;
    const bits = [];
    if (shop.phone) bits.push(`<a href="tel:${esc(shop.phone.replace(/[^\d+]/g, ''))}">${esc(shop.phone)}</a>`);
    if (shop.email) bits.push(`<a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a>`);
    if (shop.instagram) bits.push(`<a href="https://instagram.com/${esc(shop.instagram)}" target="_blank" rel="noopener">@${esc(shop.instagram)}</a>`);
    document.getElementById('contact').innerHTML = bits.join('');
    const todayIdx = new Date().getDay();
    const order = [1, 2, 3, 4, 5, 6, 0];
    document.getElementById('hours').innerHTML = order.map((d) => {
      const h = data.hours.find((x) => x.weekday === d);
      return `<li class="${d === todayIdx ? 'today' : ''}"><span>${DAYS[d]}</span>${h ? `<span>${minLabel(h.open)} – ${minLabel(h.close)}</span>` : '<span class="closed">Closed</span>'}</li>`;
    }).join('');
    if (shop.announcement) document.getElementById('announce').textContent = shop.announcement;
  }

  document.getElementById('menuTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    filter = b.dataset.cat;
    renderMenu();
  });

  api('/shop').then((d) => {
    data = d;
    renderMenu();
    renderTeam();
    renderVisit();
  }).catch(() => {
    document.getElementById('menu').innerHTML = '<p class="empty">The menu couldn’t load right now. Please refresh, or message us on Instagram.</p>';
  });
}());
