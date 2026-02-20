// api/_middleware.js — Shared session validation helper
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function requireSession(req, res) {
  const token = req.headers['x-session'];
  if (!token) {
    res.status(401).json({ error: 'No session token' });
    return null;
  }

  const { data, error } = await supabase
    .from('tf_sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .single();

  if (error || !data) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }

  if (new Date(data.expires_at) < new Date()) {
    res.status(401).json({ error: 'Session expired' });
    return null;
  }

  return data.user_id;
}

module.exports = { supabase, requireSession };
