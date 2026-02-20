// api/categorize.js — AI categorization using user's own key if available
const { supabase, requireSession } = require('./_middleware');
async function getOpenAIKey(userId) {
  const { data } = await supabase
    .from('tf_settings')
    .select('settings')
    .eq('user_id', userId)
    .single();
  
  const userKey = data?.settings?.ai_api_key;
  // Fall back to env key (Rick's shared key) if user hasn't set their own
  return userKey || process.env.OPENAI_API_KEY;
}
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const userId = await requireSession(req, res);
  if (!userId) return;
  const { text, taskText, lists, existingLists, context } = req.body;
  const inputText = text || taskText;
  if (!inputText) return res.status(400).json({ error: 'text required' });
  const apiKey = await getOpenAIKey(userId);
  if (!apiKey) return res.status(500).json({ error: 'No AI API key configured' });
  const activeLists = existingLists || lists;
  const listContext = activeLists ? `Available lists: ${JSON.stringify(activeLists)}` : '';
  const userContext = context ? `User context: ${JSON.stringify(context)}` : '';
  const prompt = `You are a task categorizer for a task management app.
${userContext}
${listContext}
Categorize this task and assign it to the best EXISTING list from the available lists above. Only suggest a new list name if no existing list is a reasonable match.
Task: "${inputText}"
Categories: "people" (tasks about specific people/team members), "projects" (projects, meetings, topics), "actions" (personal to-dos)
Respond with JSON only:
{
  "category": "people|projects|actions",
  "listName": "best matching list name or suggest a new one",
  "isUpdate": false,
  "updateTargetId": null,
  "confidence": 0.9
}`;
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
        temperature: 0.1,
        max_tokens: 200,
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');
    const content = data.choices[0].message.content.trim();
    const cleaned = content.replace(/```json\n?|\n?```/g, '');
    const result = JSON.parse(cleaned);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Categorize error:', err);
    return res.status(500).json({ error: err.message });
  }
};
