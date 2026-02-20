// api/settings.js — Per-user settings (context + AI key)
const { supabase, requireSession } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await requireSession(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('tf_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(200).json({ context: '', ai_api_key: '', ai_provider: 'openai' });
    }

    const settings = data.settings || {};
    return res.status(200).json({
      context: settings.context || '',
      ai_api_key: settings.ai_api_key || '',
      ai_provider: settings.ai_provider || 'openai',
    });
  }

  if (req.method === 'POST') {
    const incoming = req.body;

    // Get existing settings first
    const { data: existing } = await supabase
      .from('tf_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    const current = existing?.settings || {};
    const merged = { ...current, ...incoming };

    const { error } = await supabase
      .from('tf_settings')
      .upsert({ user_id: userId, settings: merged }, { onConflict: 'user_id' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
