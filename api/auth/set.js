// api/auth/set.js — POST /api/auth/set — create or change PIN

import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TOKEN_TTL_DAYS = 30;

function hashPin(pin, salt) {
  let hash = salt + pin;
  for (let i = 0; i < 100000; i++) {
    hash = createHash('sha256').update(hash).digest('hex');
  }
  return hash;
}

function generateToken() { return randomBytes(32).toString('hex'); }

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

  const { pin, current_token } = req.body || {};
  if (!pin || !/^\d{4,8}$/.test(String(pin))) {
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  }

  // Check if a PIN already exists — if so, require a valid session to change it
  const { data: authRow } = await supabase
    .from('tf_auth').select('*').single();

  if (authRow) {
    const token = current_token || req.headers['x-session'] || '';
    const { data: sess } = await supabase
      .from('tf_sessions')
      .select('token')
      .eq('token', token)
      .gte('expires_at', new Date().toISOString())
      .single();
    if (!sess) return res.status(401).json({ error: 'Valid session required to change PIN' });
  }

  const salt = randomBytes(16).toString('hex');
  const hash = hashPin(String(pin), salt);
  const token = generateToken();

  await supabase.from('tf_auth').upsert({ id: 1, pin_hash: hash, pin_salt: salt });
  await supabase.from('tf_sessions').insert({ token, expires_at: tokenExpiry() });

  return res.status(200).json({ token, message: 'PIN set successfully' });
}
