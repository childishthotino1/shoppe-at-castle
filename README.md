# The Shoppe at Castle

Website, online booking and staff dashboard for **The Shoppe at Castle**, a femme-owned hair studio at 2027 East Lombard Street, Butcher's Hill, Baltimore.

## What's included

**For clients** (`/`, `/book`, `/manage`)
- Home page: services and prices (pulled live from the database), team, gallery, hours, map.
- Online booking: pick a service, then a stylist (or "first available"), then a day and time, then enter details. Only real open times are shown.
- A confirmation with an "Add to calendar" (.ics) link, plus a private link to reschedule or cancel (closes 24h before by default).

**For staff** (`/admin/`)
- **Today**: stats and upcoming appointments, for you or the whole shop.
- **Calendar**: day view (one column per stylist) and week view. Tap an appointment to mark it done, no-show or cancelled, move it, change the price or length, or add private notes. Tap an empty spot to book a walk-in or a phone booking.
- **Clients**: search, visit history, total spent, no-shows, and private notes (formulas, preferences, pronouns).
- **Services & prices**: each stylist picks the services they offer and can set their own price and length. Owners edit the shop menu.
- **Hours & time off**: weekly hours, including split shifts, plus vacation days or blocked hours.
- **Profile**: bio, photo, Instagram, calendar color, and a private calendar feed for Apple, Google or Outlook.
- **Shop & team** (owners only): address and contact details, the website banner, booking rules (notice, how far ahead, cancel cutoff, slot interval, pause booking), adding stylists, roles, and password resets.

Stylists can see the whole shop calendar but can change only their own. Owners can change everything.

## Run it

Requires Node.js 22.13 or newer. The database is the SQLite built into Node, so there is nothing else to install.

```bash
npm install
npm start          # http://localhost:3000, staff at /admin/
npm test
```

On first start, Mia's and Rae's accounts are created and their temporary passwords are printed to the log (set `SEED_PASSWORD` to choose one). Each person sets their own password on first sign-in.

## Deploy

Any host that runs Node or Docker and has a **persistent disk** will work, for example Render, Railway, Fly.io or a small VPS. Mount the disk and set `DATA_DIR` to that path. Back up `shoppe.db` from there. See `.env.example` for the settings. To send real confirmation emails, set `RESEND_API_KEY` and `MAIL_FROM`. Without them, emails are only logged.

```bash
docker build -t shoppe . && docker run -p 3000:3000 -v shoppe-data:/data shoppe
```

## Before going live, please check
- **Prices, durations and service list are placeholders** based on the Instagram feed. Edit them in Services.
- Add phone and email in Shop & team, and photos and bios in Profile.
- Gallery images in `public/img/gallery/` were cropped from Instagram screenshots. Swap in full-resolution originals for sharper results.

## Layout
```
server/   index.js (app), db.js (schema + seed), scheduling.js (availability engine),
          routes/public.js, routes/admin.js, auth.js, notify.js, ics.js, time.js
public/   index.html, book.html, manage.html, admin/, css/, js/, img/
test/     node:test unit + API tests
```

## Preview on Vercel
Vercel builds the `Dockerfile` as a container. The preview project sets `DEMO=1`, `SEED_PASSWORD=preview123` and `DATA_DIR=/tmp/shoppe`, so it starts with sample bookings. Its disk is temporary, and data resets when Vercel starts a fresh container. Use it for previews only. Demo staff sign-in: `rae@theshoppeatcastle.com` or `mia@theshoppeatcastle.com`, password `preview123`.
