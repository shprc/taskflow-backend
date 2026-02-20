// /api/auth.js
// POST /api/auth  — verify PIN, return session token
// POST /api/auth/set — set/change PIN (requires current session OR first run)

import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key — backend only, never exposed to browser
);

const TOKEN_TTL_DAYS = 30;

function hashPin(pin, salt) {
  // PBKDF2-style: 100k rounds via repeated SHA-256 with salt
  // Good enough for a personal app; upgrade to bcrypt if adding team members
  let hash = salt + pin;
  for (let i = 0; i < 100000; i++) {
    hash = createHash('sha256').update(hash).digest('hex');
  }
  return hash;
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

function tokenExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_TTL_DAYS);
  return d.toISOString();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = req.url || '';
  const isSet = url.endsWith('/set');
  const { pin, current_token } = req.body || {};

  if (!pin || !/^\d{4,8}$/.test(String(pin))) {
    return res.status(400).json({ error: 'PIN must be 4–8 digits' });
  }

  // ── GET current auth record ───────────────────
  const { data: authRow } = await supabase
    .from('tf_auth')
    .select('*')
    .single();

  // ── SET PIN (first run or change) ─────────────
  if (isSet) {
    // If changing PIN, require a valid session
    if (authRow) {
      const { data: sess } = await supabase
        .from('tf_sessions')
        .select('*')
        .eq('token', current_token || req.headers['x-session'] || '')
        .gte('expires_at', new Date().toISOString())
        .single();

      if (!sess) return res.status(401).json({ error: 'Valid session required to change PIN' });
    }

    const salt = randomBytes(16).toString('hex');
    const hash = hashPin(String(pin), salt);
    const token = generateToken();

    // Upsert auth record
    await supabase.from('tf_auth').upsert({ id: 1, pin_hash: hash, pin_salt: salt });

    // Create session
    await supabase.from('tf_sessions').insert({
      token,
      expires_at: tokenExpiry()
    });

    return res.status(200).json({ token, message: 'PIN set successfully' });
  }

  // ── VERIFY PIN ────────────────────────────────
  if (!authRow) {
    return res.status(404).json({ error: 'No PIN configured' });
  }

  const hash = hashPin(String(pin), authRow.pin_salt);
  if (hash !== authRow.pin_hash) {
    // Constant-time-ish: always do the hash before returning
    return res.status(401).json({ error: 'Incorrect PIN' });
  }

  const token = generateToken();
  await supabase.from('tf_sessions').insert({
    token,
    expires_at: tokenExpiry()
  });

  // Clean up expired sessions while we're here
  await supabase.from('tf_sessions').delete().lt('expires_at', new Date().toISOString());

  return res.status(200).json({ token });
}
