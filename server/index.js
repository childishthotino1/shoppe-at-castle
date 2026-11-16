'use strict';
const path = require('node:path');
const express = require('express');
const dbm = require('./db');
const auth = require('./auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

function createApp({ dbFile, uploadDir, seedPassword } = {}) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const db = dbm.open(dbFile || path.join(dataDir, 'shoppe.db'));
  const creds = dbm.seed(db, { password: seedPassword || process.env.SEED_PASSWORD });
  if (creds && process.env.DEMO === '1') require('./demo').seedDemo(db);
  uploadDir = uploadDir || path.join(dataDir, 'uploads');

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });
  app.use(express.json({ limit: '6mb' }));
  app.use(auth.loadSession(db));

  // Basic CSRF defence for cookie-authenticated, state-changing requests:
  // browsers always send Origin on cross-site POST/PUT/PATCH/DELETE.
  app.use('/api/admin', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Bad origin.' });
    next();
  });

  app.use('/api', publicRoutes(db, { baseUrl }));
  app.use('/api/admin', adminRoutes(db, { baseUrl, uploadDir }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  });

  return { app, db, creds };
}

if (require.main === module) {
  const { app, creds } = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`The Shoppe at Castle running at http://localhost:${port}`);
    console.log(`Staff dashboard: http://localhost:${port}/admin/`);
    if (creds) {
      console.log('\nFirst run: staff accounts created. Sign in and you will be asked to set a new password.');
      for (const c of creds) console.log(`  ${c.email}  /  ${c.password}`);
      console.log('');
    }
  });
}

module.exports = { createApp };
