// api/auth.js — POST /api/auth — verify PIN, return session token

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

  const { pin } = req.body || {};
  if (!pin || !/^\d{4,8}$/.test(String(pin))) {
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  }

  const { data: authRow } = await supabase
    .from('tf_auth').select('*').single();

  if (!authRow) {
    return res.status(404).json({ error: 'No PIN configured' });
  }

  const hash = hashPin(String(pin), authRow.pin_salt);
  if (hash !== authRow.pin_hash) {
    return res.status(401).json({ error: 'Incorrect PIN' });
  }

  const token = generateToken();
  await supabase.from('tf_sessions').insert({ token, expires_at: tokenExpiry() });
  await supabase.from('tf_sessions').delete().lt('expires_at', new Date().toISOString());

  return res.status(200).json({ token });
}
