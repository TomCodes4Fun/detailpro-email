const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { signToken, requireAuth } = require('./auth');

const router = express.Router();

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}

// ---- Sign up: creates a new account + the first admin user ----
router.post('/signup', async (req, res) => {
  const { email, password, name, businessName } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with that email already exists' });

    await client.query('BEGIN');

    const accountResult = await client.query(
      `INSERT INTO accounts (business_name, plan) VALUES ($1, 'free') RETURNING id, business_name, plan`,
      [String(businessName || 'My Detailing Business').trim()]
    );
    const account = accountResult.rows[0];

    const passwordHash = await bcrypt.hash(String(password), 10);
    const userResult = await client.query(
      `INSERT INTO users (account_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING id, account_id, email, name, role`,
      [account.id, String(email).toLowerCase(), passwordHash, String(name).trim()]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO account_data (account_id, data) VALUES ($1, '{}'::jsonb)`,
      [account.id]
    );

    await client.query('COMMIT');

    const token = signToken(user);
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      account: { id: account.id, businessName: account.business_name, plan: account.plan }
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[signup]', e);
    res.status(500).json({ error: 'Could not create account' });
  } finally {
    client.release();
  }
});

// ---- Log in ----
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const result = await pool.query(
      `SELECT u.id, u.account_id, u.email, u.password_hash, u.name, u.role,
              a.business_name, a.plan
       FROM users u JOIN accounts a ON a.id = u.account_id
       WHERE u.email = $1`,
      [String(email).toLowerCase()]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      account: { id: user.account_id, businessName: user.business_name, plan: user.plan }
    });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: 'Could not log in' });
  }
});

// ---- Current user + account + teammates ----
router.get('/me', requireAuth, async (req, res) => {
  try {
    const accountResult = await pool.query(
      `SELECT id, business_name, plan FROM accounts WHERE id = $1`,
      [req.user.accountId]
    );
    const teamResult = await pool.query(
      `SELECT id, email, name, role FROM users WHERE account_id = $1 ORDER BY created_at ASC`,
      [req.user.accountId]
    );
    if (!accountResult.rows[0]) return res.status(404).json({ error: 'Account not found' });

    res.json({
      account: {
        id: accountResult.rows[0].id,
        businessName: accountResult.rows[0].business_name,
        plan: accountResult.rows[0].plan
      },
      currentUserId: req.user.id,
      team: teamResult.rows
    });
  } catch (e) {
    console.error('[me]', e);
    res.status(500).json({ error: 'Could not load account' });
  }
});

// ---- Update business profile (admin only) ----
router.put('/account', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can edit business profile' });
  const { businessName } = req.body || {};
  if (!businessName || !String(businessName).trim()) {
    return res.status(400).json({ error: 'Business name is required' });
  }
  try {
    const result = await pool.query(
      `UPDATE accounts SET business_name = $1 WHERE id = $2 RETURNING id, business_name, plan`,
      [String(businessName).trim(), req.user.accountId]
    );
    res.json({ account: { id: result.rows[0].id, businessName: result.rows[0].business_name, plan: result.rows[0].plan } });
  } catch (e) {
    console.error('[update account]', e);
    res.status(500).json({ error: 'Could not update business profile' });
  }
});

// ---- Invite a teammate (admin only). They get a temp password to log in and should change it. ----
router.post('/team', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can add teammates' });
  const { email, name, role, password } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Temporary password must be at least 8 characters' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'That email is already in use' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = await pool.query(
      `INSERT INTO users (account_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role`,
      [req.user.accountId, String(email).toLowerCase(), passwordHash, String(name).trim(), role === 'admin' ? 'admin' : 'staff']
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (e) {
    console.error('[add teammate]', e);
    res.status(500).json({ error: 'Could not add teammate' });
  }
});

router.delete('/team/:userId', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can remove teammates' });
  if (req.params.userId === req.user.id) return res.status(400).json({ error: "You can't remove your own account" });
  try {
    await pool.query(`DELETE FROM users WHERE id = $1 AND account_id = $2`, [req.params.userId, req.user.accountId]);
    res.status(204).end();
  } catch (e) {
    console.error('[remove teammate]', e);
    res.status(500).json({ error: 'Could not remove teammate' });
  }
});

// ---- Data sync: one JSON blob per account (customers, appointments, etc.) ----
router.get('/sync', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT data, updated_at FROM account_data WHERE account_id = $1`, [req.user.accountId]);
    if (!result.rows[0]) return res.json({ data: {}, updatedAt: null });
    res.json({ data: result.rows[0].data, updatedAt: result.rows[0].updated_at });
  } catch (e) {
    console.error('[sync get]', e);
    res.status(500).json({ error: 'Could not load data' });
  }
});

router.put('/sync', requireAuth, async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data must be an object' });
  try {
    const result = await pool.query(
      `INSERT INTO account_data (account_id, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (account_id) DO UPDATE SET data = $2::jsonb, updated_at = now()
       RETURNING updated_at`,
      [req.user.accountId, JSON.stringify(data)]
    );
    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (e) {
    console.error('[sync put]', e);
    res.status(500).json({ error: 'Could not save data' });
  }
});

module.exports = router;
