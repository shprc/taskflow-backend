// TaskFlow Backend - Upstash Redis for persistent context storage
// Uses Upstash REST API directly (no SDK needed)

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// Simple Upstash REST client
const kv = {
  get: async (key) => {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await r.json();
    if (data.result === null || data.result === undefined) return null;
    try { return JSON.parse(data.result); } catch(e) { return data.result; }
  },
  set: async (key, value) => {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(value) })
    });
    return await r.json();
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const path = req.url?.split('?')[0];

  // GET /api/context
  if (req.method === 'GET' && path === '/api/context') {
    try {
      const context = await kv.get('taskflow:context') || {};
      const corrections = await kv.get('taskflow:corrections') || [];
      const people = await kv.get('taskflow:people') || [];
      const projects = await kv.get('taskflow:projects') || [];
      return res.status(200).json({ context, corrections, people, projects });
    } catch(e) {
      console.error('GET context error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // PUT /api/context
  if (req.method === 'PUT' && path === '/api/context') {
    try {
      const { context, people, projects } = req.body;
      if (context !== undefined) await kv.set('taskflow:context', context);
      if (people !== undefined) await kv.set('taskflow:people', people);
      if (projects !== undefined) await kv.set('taskflow:projects', projects);
      return res.status(200).json({ success: true });
    } catch(e) {
      console.error('PUT context error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // POST /api/correction
  if (req.method === 'POST' && path === '/api/correction') {
    try {
      const { original, corrected, taskText } = req.body;
      const corrections = await kv.get('taskflow:corrections') || [];
      const updated = [{
        taskText,
        original,
        corrected,
        timestamp: new Date().toISOString()
      }, ...corrections].slice(0, 100);
      await kv.set('taskflow:corrections', updated);
      return res.status(200).json({ success: true });
    } catch(e) {
      console.error('POST correction error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // POST /api/categorize
  try {
    const { taskText, existingLists, apiKey, context: reqContext, mode } = req.body;

    if (!taskText) return res.status(400).json({ error: 'taskText is required' });
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

    const safeText = String(taskText).slice(0, 1000);

    // Load stored context from Upstash
    let storedContext = {};
    let corrections = [];
    let people = [];
    let projects = [];

    if (KV_URL && KV_TOKEN) {
      try {
        [storedContext, corrections, people, projects] = await Promise.all([
          kv.get('taskflow:context').then(r => r || {}),
          kv.get('taskflow:corrections').then(r => r || []),
          kv.get('taskflow:people').then(r => r || []),
          kv.get('taskflow:projects').then(r => r || [])
        ]);
      } catch(e) {
        console.warn('KV read failed, continuing without stored context:', e.message);
      }
    }

    // Merge stored + request context
    const context = { ...storedContext, ...(reqContext || {}) };

    // Build context string for AI
    const contextParts = [];

    if (context.role) contextParts.push(`User's role: ${context.role}`);

    if (people.length > 0) {
      contextParts.push(`Team members:\n${people.map(p =>
        `- ${p.name}${p.role ? ` (${p.role})` : ''}${p.keywords ? ` | Keywords: ${p.keywords}` : ''}`
      ).join('\n')}`);
    } else if (context.team) {
      contextParts.push(`Team members:\n${context.team}`);
    }

    if (projects.length > 0) {
      contextParts.push(`Active projects:\n${projects.map(p =>
        `- ${p.name}${p.keywords ? ` | Keywords: ${p.keywords}` : ''}`
      ).join('\n')}`);
    } else if (context.projects) {
      contextParts.push(`Active projects:\n${context.projects}`);
    }

    if (context.rules) contextParts.push(`Custom rules:\n${context.rules}`);

    // Include recent corrections as AI learning examples
    if (corrections.length > 0) {
      contextParts.push(`Learning from past corrections (use these patterns):\n${corrections.slice(0, 25).map(c =>
        `- "${c.taskText}" → ${c.corrected.category}/${c.corrected.listName}`
      ).join('\n')}`);
    }

    const contextStr = contextParts.join('\n\n');

    // Email draft mode
    if (mode === 'email') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a professional email drafting assistant.\n\n${contextStr ? `Context:\n${contextStr}\n\n` : ''}Write a concise professional email. Return ONLY valid JSON with fields "subject" (string) and "body" (string). No markdown, no code blocks.`
            },
            { role: 'user', content: safeText }
          ],
          temperature: 0.7,
          max_tokens: 600
        })
      });

      if (!response.ok) {
        const err = await response.json();
        return res.status(response.status).json({ error: err.error?.message || 'OpenAI error' });
      }

      const data = await response.json();
      const content = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '');
      try {
        return res.status(200).json(JSON.parse(content));
      } catch(e) {
        return res.status(200).json({ subject: 'Follow up', body: content });
      }
    }

    // Categorization mode
    const hasExisting = existingLists && (
      existingLists.people?.length > 0 ||
      existingLists.projects?.length > 0 ||
      existingLists.actions?.length > 0
    );

    const systemPrompt = `You are a task categorization assistant for a busy professional.
${contextStr ? `\nIMPORTANT CONTEXT:\n${contextStr}\n` : ''}
${hasExisting ? `\nEXISTING LISTS - match these before creating new ones:
${existingLists.people?.length > 0 ? `People: ${existingLists.people.join(', ')}` : ''}
${existingLists.projects?.length > 0 ? `Projects: ${existingLists.projects.join(', ')}` : ''}
${existingLists.actions?.length > 0 ? `Actions: ${existingLists.actions.join(', ')}` : ''}
Match flexibly - "talk to dom" → "Dom", "IL meeting" → "IL Expansion" etc.
` : ''}
Return ONLY valid JSON (no markdown, no code blocks):
{
  "category": "people" | "projects" | "actions",
  "listName": "exact person/project name or 'Personal Actions'",
  "text": "cleaned task text",
  "tags": ["urgent"|"waiting"|"follow-up"|"action"|"to-contact"],
  "dueDate": "YYYY-MM-DD or null"
}

Rules:
- Person mentioned → category: "people", listName: their name
- Meeting/project → category: "projects"
- Otherwise → category: "actions", listName: "Personal Actions"
- Extract any dates, add relevant tags, clean up text`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: safeText }
        ],
        temperature: 0.2,
        max_tokens: 250
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'OpenAI error' });
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '');
    return res.status(200).json(JSON.parse(content));

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
