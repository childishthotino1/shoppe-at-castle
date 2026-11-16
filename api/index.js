'use strict';
// Vercel entry point for the PREVIEW deployment only. Vercel's disk is
// temporary, so this runs in demo mode with sample data that resets whenever
// Vercel starts a fresh server. Real hosting should use `npm start` with a
// persistent DATA_DIR (see README).
process.env.DEMO = '1';
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/shoppe';
process.env.SEED_PASSWORD = process.env.SEED_PASSWORD || 'preview123';
const { createApp } = require('../server/index');

module.exports = createApp().app;
