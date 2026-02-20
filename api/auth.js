// api/auth.js — Multi-user PIN login
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pin, username } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  // Default to 'rick' if no username provided (backward compat)
  const targetUsername = (username || 'rick').toLowerCase().trim();

  // Look up user by username
  const { data: authRow, error } = await supabase
    .from('tf_auth')
    .select('*')
    .eq('username', targetUsername)
    .single();

  if (error || !authRow) {
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }

  // Support both 'salt' and 'pin_salt' column names
  const salt = authRow.salt || authRow.pin_salt;
  if (!salt) {
    return res.status(500).json({ error: 'Auth configuration error' });
  }

  const hash = hashPin(pin, salt);
  if (hash !== authRow.pin_hash) {
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }

  // Create session
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('tf_sessions').insert({
    token,
    expires_at: expiresAt,
    user_id: authRow.user_id
  });

  return res.status(200).json({
    token,
    username: authRow.username,
    display_name: authRow.display_name || authRow.username,
    user_id: authRow.user_id
  });
};
