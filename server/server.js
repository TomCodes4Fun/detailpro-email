const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

// Load .env if present
try { require('dotenv').config(); } catch (e) {}

const PORT = Number(process.env.PORT || 3333);

// Comma-separated list of allowed frontend origins, e.g.
// ALLOWED_ORIGINS=https://your-app.netlify.app,http://localhost:5500
// If unset, allows all origins (fine for local dev, NOT recommended in production).
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Optional shared secret. If set, /api/send-email requires header: x-api-key
const EMAIL_API_KEY = process.env.EMAIL_API_KEY || '';

function required(name){
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function bool(v){
  return String(v || '').toLowerCase() === 'true' || String(v) === '1';
}

function createTransport(){
  const host = required('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = bool(process.env.SMTP_SECURE);
  const user = required('SMTP_USER');
  const pass = required('SMTP_PASS');

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

let transporter;
function getTransporter(){
  if (!transporter) transporter = createTransport();
  return transporter;
}

const app = express();
app.use(cors(ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : {}));
app.use(express.json({ limit: '5mb' })); // sync payloads (all customers/appointments/etc.) can add up

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'detailpro-crm-email-server', ts: new Date().toISOString() });
});

app.use('/api', require('./api'));

app.post('/api/send-email', async (req, res) => {
  try {
    if (EMAIL_API_KEY && req.get('x-api-key') !== EMAIL_API_KEY) {
      return res.status(401).send('Invalid or missing API key');
    }

    const to = String(req.body?.to || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const text = String(req.body?.text || '').trim();
    const html = req.body?.html ? String(req.body.html) : '';

    if (!to) return res.status(400).send('"to" is required');
    if (!subject) return res.status(400).send('"subject" is required');
    if (!text && !html) return res.status(400).send('"text" or "html" is required');

    const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
    const fromName = process.env.FROM_NAME || 'DetailPro CRM';

    const info = await getTransporter().sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject,
      text: text || undefined,
      html: html || undefined
    });

    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error('send-email error:', err);
    res.status(500).send(String(err?.message || err || 'Unknown error'));
  }
});

app.listen(PORT, () => {
  console.log(`DetailPro Email Server listening on http://localhost:${PORT}`);
  console.log('Health check: GET /api/health');
});
