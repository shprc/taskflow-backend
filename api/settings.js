// /api/settings.js
// GET  /api/settings — fetch settings
// POST /api/settings — save settings
// All calls require X-Session header with valid token

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key — backend only
);

async function validateSession(req, res) {
  const token = req.headers['x-session'] || '';
  if (!token) { res.status(401).json({ error: 'No session token' }); return false; }

  const { data } = await supabase
    .from('tf_sessions')
    .select('token')
    .eq('token', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (!data) { res.status(401).json({ error: 'Invalid or expired session' }); return false; }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ok = await validateSession(req, res);
  if (!ok) return;

  // ── GET settings ──────────────────────────────
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('tf_settings')
      .select('*')
      .eq('id', 1)
      .single();

    return res.status(200).json({
      settings: data?.settings || {}
    });
  }

  // ── POST settings ─────────────────────────────
  if (req.method === 'POST') {
    const { settings } = req.body || {};
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload' });
    }

    // Only store what we trust — strip anything unexpected
    const safe = {
      ai_context: typeof settings.ai_context === 'string'
        ? settings.ai_context.slice(0, 2000)
        : '',
      ai_notes: typeof settings.ai_notes === 'string'
        ? settings.ai_notes.slice(0, 2000)
        : '',
      lists: Array.isArray(settings.lists)
        ? settings.lists.map(l => ({
            id:        String(l.id    || '').slice(0, 64),
            name:      String(l.name  || '').slice(0, 100),
            pinned:    Boolean(l.pinned),
            collapsed: Boolean(l.collapsed),
            order:     Number.isFinite(l.order) ? l.order : 99
          }))
        : []
    };

    const { error } = await supabase
      .from('tf_settings')
      .upsert({ id: 1, settings: safe, updated_at: new Date().toISOString() });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, settings: safe });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
