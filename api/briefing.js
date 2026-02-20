// api/briefing.js — AI morning briefing using user's own key if available
const { supabase, requireSession } = require('./_middleware');

async function getAIConfig(userId) {
  const { data } = await supabase
    .from('tf_settings')
    .select('settings')
    .eq('user_id', userId)
    .single();
  
  return {
    apiKey: data?.settings?.ai_api_key || process.env.OPENAI_API_KEY,
    provider: data?.settings?.ai_provider || 'openai',
    context: data?.settings?.context || '',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await requireSession(req, res);
  if (!userId) return;

  const { tasks } = req.body;
  if (!tasks) return res.status(400).json({ error: 'tasks required' });

  const { apiKey, context } = await getAIConfig(userId);
  if (!apiKey) return res.status(500).json({ error: 'No AI API key configured' });

  const taskSummary = tasks
    .filter(t => !t.completed)
    .map(t => `[${t.category}/${t.listName}] ${t.text}${t.notes ? ` — ${t.notes}` : ''}${t.tags?.includes('waiting') ? ' (WAITING)' : ''}`)
    .join('\n');

  const prompt = `You are an executive assistant creating a morning briefing.
${context ? `Context: ${context}` : ''}

Today's open tasks:
${taskSummary}

Create a concise morning briefing with:
1. Top 3 priorities for today
2. Items that need follow-up (waiting items)
3. Any quick wins to knock out

Keep it tight — this is read on a commute.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 600,
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');

    const briefing = data.choices[0].message.content.trim();
    return res.status(200).json({ briefing });
  } catch (err) {
    console.error('Briefing error:', err);
    return res.status(500).json({ error: err.message });
  }
};
