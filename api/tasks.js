// api/tasks.js — GET /api/tasks, POST /api/tasks, DELETE /api/tasks
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

  const urlParts = (req.url || '').split('?')[0].split('/').filter(Boolean);
  const taskId = urlParts.length > 2 ? urlParts[urlParts.length - 1]
               : (req.query?.id || null);

  // ── GET /api/tasks — fetch all tasks ──────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('tf_tasks')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    // Normalize rows back to frontend shape
    const tasks = (data || []).filter(r => !r.is_archived).map(r => ({
      id:           r.id,
      text:         r.text,
      category:     r.category     || 'actions',
      listName:     r.list_name    || r.list || 'Personal Actions',
      tags:         r.tags         || [],
      dueDate:      r.due_date     || null,
      priority:     r.priority     || 'none',
      notes:        r.notes        || '',
      completed:    r.completed    || false,
      createdAt:    r.created_at,
      lastModified: r.last_modified || r.updated_at || r.created_at,
      completedAt:  r.completed_at  || null,
    }));
    const archived = (data || []).filter(r => r.is_archived).map(r => ({
      id:           r.id,
      text:         r.text,
      category:     r.category     || 'actions',
      listName:     r.list_name    || r.list || 'Personal Actions',
      tags:         r.tags         || [],
      dueDate:      r.due_date     || null,
      priority:     r.priority     || 'none',
      notes:        r.notes        || '',
      completed:    true,
      createdAt:    r.created_at,
      lastModified: r.last_modified || r.updated_at || r.created_at,
      completedAt:  r.completed_at  || null,
    }));
    return res.status(200).json({ tasks, archived });
  }

  // ── POST /api/tasks — upsert (create or update) ───────────────────────
  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.text || !String(b.text).trim()) {
      return res.status(400).json({ error: 'Task text required' });
    }

    const row = {
      id:           b.id ? String(b.id) : undefined,
      text:         String(b.text).trim().slice(0, 2000),
      category:     b.category     || 'actions',
      // support both field names the frontend might send
      list_name:    b.list_name    || b.list || 'Personal Actions',
      tags:         Array.isArray(b.tags) ? b.tags : [],
      due_date:     b.due_date     || null,
      priority:     b.priority     || 'none',
      notes:        b.notes        || '',
      completed:    b.completed    || false,
      is_archived:  b.is_archived  || false,
      created_at:   b.created_at   || new Date().toISOString(),
      last_modified: b.last_modified || new Date().toISOString(),
      completed_at: b.completed_at  || null,
    };
    if (!row.id) delete row.id; // let Supabase generate if missing

    const { error } = await supabase
      .from('tf_tasks')
      .upsert(row, { onConflict: 'id' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── PATCH /api/tasks/:id — partial update ────────────────────────────
  if (req.method === 'PATCH') {
    const id = taskId || req.body?.id;
    if (!id) return res.status(400).json({ error: 'Task ID required' });
    const b = req.body || {};
    const updates = { last_modified: new Date().toISOString() };
    if (b.text      !== undefined) updates.text       = String(b.text).trim().slice(0, 2000);
    if (b.list_name !== undefined) updates.list_name  = b.list_name;
    if (b.list      !== undefined) updates.list_name  = b.list;
    if (b.category  !== undefined) updates.category   = b.category;
    if (b.done      !== undefined) updates.completed  = b.done;
    if (b.completed !== undefined) updates.completed  = b.completed;
    if (b.tags      !== undefined) updates.tags       = b.tags;
    if (b.notes     !== undefined) updates.notes      = b.notes;
    if (b.priority  !== undefined) updates.priority   = b.priority;
    if (b.due_date  !== undefined) updates.due_date   = b.due_date;
    if (b.is_archived !== undefined) updates.is_archived = b.is_archived;

    const { error } = await supabase
      .from('tf_tasks').update(updates).eq('id', String(id));
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE /api/tasks — delete by id (query param or body) ───────────
  if (req.method === 'DELETE') {
    const id = taskId || req.query?.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'Task ID required' });
    const { error } = await supabase
      .from('tf_tasks').delete().eq('id', String(id));
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
