// api/tasks.js — GET /api/tasks, POST /api/tasks, PATCH /api/tasks/:id, DELETE /api/tasks/:id

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ok = await validateSession(req, res);
  if (!ok) return;

  // Extract task id from URL if present — e.g. /api/tasks/abc123
  const urlParts = (req.url || '').split('/').filter(Boolean);
  const taskId = urlParts.length > 2 ? urlParts[urlParts.length - 1] : null;

  // ── GET /api/tasks — fetch all tasks ─────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('tf_tasks')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tasks: data || [] });
  }

  // ── POST /api/tasks — create new task ─────────────────
  if (req.method === 'POST') {
    const { id, text, list, done, created_at } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'Task text required' });

    const { error } = await supabase.from('tf_tasks').insert({
      id:         id || undefined,
      text:       text.trim().slice(0, 2000),
      list:       list || 'actions',
      done:       done || false,
      created_at: created_at || new Date().toISOString()
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── PATCH /api/tasks/:id — update task ────────────────
  if (req.method === 'PATCH') {
    if (!taskId) return res.status(400).json({ error: 'Task ID required' });
    const { text, list, done } = req.body || {};

    const updates = {};
    if (text !== undefined) updates.text = text.trim().slice(0, 2000);
    if (list !== undefined) updates.list = list;
    if (done !== undefined) updates.done = done;
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('tf_tasks').update(updates).eq('id', taskId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE /api/tasks/:id — delete task ───────────────
  if (req.method === 'DELETE') {
    if (!taskId) return res.status(400).json({ error: 'Task ID required' });
    const { error } = await supabase
      .from('tf_tasks').delete().eq('id', taskId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
