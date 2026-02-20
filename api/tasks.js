// api/tasks.js — Multi-user tasks (GET all / POST upsert)
const { supabase, requireSession } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await requireSession(req, res);
  if (!userId) return;

  // GET — fetch all tasks for this user
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('tf_tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const tasks = data.map(r => ({
      id: r.id,
      text: r.text,
      category: r.category || 'actions',
      listName: r.list_name || r.list || 'actions',
      tags: r.tags || [],
      dueDate: r.due_date,
      priority: r.priority || 'none',
      notes: r.notes || '',
      completed: r.completed || false,
      createdAt: r.created_at,
      lastModified: r.updated_at,
      completedAt: r.completed_at,
    }));

    return res.status(200).json(tasks);
  }

  // POST — upsert single task
  if (req.method === 'POST') {
    const t = req.body;
    if (!t || !t.id) return res.status(400).json({ error: 'Task id required' });

    const { error } = await supabase.from('tf_tasks').upsert({
      id: t.id,
      user_id: userId,
      text: t.text,
      category: t.category || 'actions',
      list_name: t.listName || 'actions',
      list: t.listName || 'actions',
      tags: t.tags || [],
      due_date: t.dueDate || null,
      priority: t.priority || 'none',
      notes: t.notes || '',
      completed: t.completed || false,
      created_at: t.createdAt,
      updated_at: new Date().toISOString(),
      completed_at: t.completedAt || null,
      is_archived: t.isArchived || false,
    }, { onConflict: 'id' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
