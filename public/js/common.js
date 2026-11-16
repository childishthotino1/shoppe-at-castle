/* Shared helpers for the public pages. */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went wrong. Please try again.');
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  const money = (cents, from) => {
    if (cents === 0 && !from) return 'Free';
    const v = cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
    return (from ? 'from ' : '') + '$' + v;
  };

  const minLabel = (m) => {
    const h = Math.floor(m / 60); const mm = m % 60;
    return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
  };

  const duration = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`);

  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
  const longDate = (s) => parseDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function initNav() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const toggle = nav.querySelector('.nav__toggle');
    const sheet = nav.querySelector('.nav__sheet');
    if (toggle && sheet) {
      toggle.addEventListener('click', () => {
        const open = sheet.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      sheet.addEventListener('click', (e) => {
        if (e.target.closest('a')) { sheet.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
      });
    }
    const year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();
  }

  const avatar = (s, size = 44) => s.photo_url
    ? `<span class="avatar" style="width:${size}px;height:${size}px"><img src="${esc(s.photo_url)}" alt=""></span>`
    : `<span class="avatar" style="width:${size}px;height:${size}px;background:${esc(s.color)}">${esc(s.name[0])}</span>`;

  window.Shoppe = { esc, api, money, minLabel, duration, parseDate, isoDate, addDays, longDate, DAYS, initNav, avatar };
  document.addEventListener('DOMContentLoaded', initNav);
}());
