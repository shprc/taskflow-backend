// api/auth/set.js — Create new user or update existing PIN
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

// Middleware to validate session and get user_id
async function getSessionUser(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('tf_sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data.user_id;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pin, username, display_name, admin_token } = req.body;

  // Creating a NEW user requires either:
  // 1. An existing admin session (Rick inviting his boss)
  // 2. No users exist yet (first-time setup)

  const { data: existingUsers } = await supabase.from('tf_auth').select('user_id');

  if (existingUsers && existingUsers.length > 0) {
    // Must have valid session to create new users
    const sessionToken = req.headers['x-session'];
    const userId = await getSessionUser(sessionToken);
    if (!userId) {
      return res.status(401).json({ error: 'Must be logged in to create users' });
    }
  }

  if (!pin || !username) {
    return res.status(400).json({ error: 'PIN and username required' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const pin_hash = hashPin(pin, salt);
  const user_id = crypto.randomUUID();
  const cleanUsername = username.toLowerCase().trim();
  const cleanDisplayName = display_name || username;

  // Check if username already exists
  const { data: existing } = await supabase
    .from('tf_auth')
    .select('username')
    .eq('username', cleanUsername)
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const { error } = await supabase.from('tf_auth').insert({
    user_id,
    username: cleanUsername,
    display_name: cleanDisplayName,
    pin_hash,
    salt
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ 
    success: true, 
    username: cleanUsername,
    display_name: cleanDisplayName,
    user_id 
  });
};
