// api/tasks/[id].js — PATCH (partial update) + DELETE scoped to user
const { supabase, requireSession } = require('../_middleware');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await requireSession(req, res);
  if (!userId) return;

  const taskId = req.query.id || req.url.split('/').pop().split('?')[0];

  if (req.method === 'PATCH') {
    const updates = req.body;
    const dbUpdates = {};
    if (updates.text !== undefined) dbUpdates.text = updates.text;
    if (updates.category !== undefined) dbUpdates.category = updates.category;
    if (updates.listName !== undefined) { dbUpdates.list_name = updates.listName; dbUpdates.list = updates.listName; }
    if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
    if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;
    if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.completed !== undefined) dbUpdates.completed = updates.completed;
    if (updates.completedAt !== undefined) dbUpdates.completed_at = updates.completedAt;
    if (updates.isArchived !== undefined) dbUpdates.is_archived = updates.isArchived;
    dbUpdates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('tf_tasks')
      .update(dbUpdates)
      .eq('id', taskId)
      .eq('user_id', userId); // Security: can only update own tasks

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const idToDelete = req.query.id || taskId;
    const { error } = await supabase
      .from('tf_tasks')
      .delete()
      .eq('id', idToDelete)
      .eq('user_id', userId); // Security: can only delete own tasks

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
