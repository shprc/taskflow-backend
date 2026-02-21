// api/admin.js — User management (admin only)
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

async function requireAdmin(req, res) {
  const token = req.headers['x-session'];
  if (!token) { res.status(401).json({ error: 'No session' }); return null; }

  const { data: session } = await supabase
    .from('tf_sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .single();

  if (!session || new Date(session.expires_at) < new Date()) {
    res.status(401).json({ error: 'Invalid or expired session' }); return null;
  }

  // Check if this user is an admin
  const { data: user } = await supabase
    .from('tf_auth')
    .select('username, is_admin')
    .eq('user_id', session.user_id)
    .single();

  if (!user?.is_admin) {
    res.status(403).json({ error: 'Admin access required' }); return null;
  }

  return session.user_id;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  // GET /api/admin — list all users
  if (req.method === 'GET') {
    const { data: users, error } = await supabase
      .from('tf_auth')
      .select('user_id, username, display_name, is_admin, is_active, created_at')
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users });
  }

  // POST /api/admin — create new user
  if (req.method === 'POST') {
    const { username, pin, display_name, is_admin } = req.body;
    if (!username || !pin) return res.status(400).json({ error: 'username and pin required' });
    if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });

    // Check username not taken
    const { data: existing } = await supabase
      .from('tf_auth')
      .select('username')
      .eq('username', username.toLowerCase().trim())
      .single();

    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const salt = generateSalt();
    const pin_hash = hashPin(pin, salt);
    const user_id = crypto.randomUUID();

    const { error } = await supabase.from('tf_auth').insert({
      user_id,
      username: username.toLowerCase().trim(),
      display_name: display_name || username,
      pin_hash,
      pin_salt: salt,
      salt,
      is_admin: !!is_admin,
      is_active: true,
    });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, user_id, username: username.toLowerCase().trim() });
  }

  // PUT /api/admin — update user (reset PIN, toggle admin, toggle active)
  if (req.method === 'PUT') {
    const { user_id, pin, display_name, is_admin, is_active } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const updates = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (is_admin !== undefined) updates.is_admin = is_admin;
    if (is_active !== undefined) updates.is_active = is_active;
    if (pin) {
      if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
      const salt = generateSalt();
      updates.pin_hash = hashPin(pin, salt);
      updates.pin_salt = salt;
      updates.salt = salt;
    }

    const { error } = await supabase.from('tf_auth').update(updates).eq('user_id', user_id);
    if (error) return res.status(500).json({ error: error.message });

    // If deactivating, kill all their sessions
    if (is_active === false) {
      await supabase.from('tf_sessions').delete().eq('user_id', user_id);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
