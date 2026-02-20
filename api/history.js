// /api/history.js
// GET    /api/history        — fetch recent history entries
// POST   /api/history        — log a new history entry
// DELETE /api/history        — clear all history

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ok = await validateSession(req, res);
  if (!ok) return;

  // ── GET: last 200 history entries ─────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('tf_task_history')
      .select('*')
      .order('ts', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ history: data || [] });
  }

  // ── POST: log new entry ───────────────────────
  if (req.method === 'POST') {
    const { entry } = req.body || {};
    if (!entry || !entry.action || !entry.task_id) {
      return res.status(400).json({ error: 'Invalid history entry' });
    }

    const VALID_ACTIONS = ['create', 'edit_text', 'move_list', 'complete', 'delete'];
    if (!VALID_ACTIONS.includes(entry.action)) {
      return res.status(400).json({ error: 'Invalid action type' });
    }

    const safe = {
      id:      String(entry.id      || '').slice(0, 64),
      task_id: String(entry.task_id || '').slice(0, 64),
      action:  entry.action,
      before:  entry.before || null,
      after:   entry.after  || null,
      ts:      entry.ts || new Date().toISOString()
    };

    const { error } = await supabase.from('tf_task_history').insert(safe);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: clear all history ─────────────────
  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('tf_task_history')
      .delete()
      .neq('id', ''); // delete all rows
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
