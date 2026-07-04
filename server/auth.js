const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set — set it to a long random string before going live.');
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, accountId: user.account_id, role: user.role },
    JWT_SECRET || 'dev-only-insecure-secret',
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  try {
    const payload = jwt.verify(token, JWT_SECRET || 'dev-only-insecure-secret');
    req.user = { id: payload.sub, accountId: payload.accountId, role: payload.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, requireAuth };
