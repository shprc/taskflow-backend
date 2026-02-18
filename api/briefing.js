import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getDaysOverdue(dueDateStr) {
  if (!dueDateStr) return null;
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - due) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

function formatTasksForPrompt(tasks) {
  return tasks.map((t, i) => {
    const overdue = getDaysOverdue(t.due_date);
    const duePart = t.due_date
      ? `due ${t.due_date}${overdue ? ` (OVERDUE ${overdue}d)` : ''}`
      : 'no due date';
    const statusPart = t.completed ? 'completed' : 'open';
    return `${i + 1}. [${t.priority?.toUpperCase() || 'NORMAL'}] ${t.text} | ${t.category || 'Uncategorized'} | ${duePart} | status: ${statusPart}`;
  }).join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      mode = 'briefing',
      filters = {},
      custom_context = '',
    } = req.body;

    let query = supabase
      .from('tf_tasks')
      .select('*')
      .eq('completed', false)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });

    if (filters.list_name) query = query.eq('list_name', filters.list_name);

    const { data: tasks, error: dbError } = await query;
    if (dbError) throw new Error(`Supabase error: ${dbError.message}`);
    
    if (!tasks || tasks.length === 0) {
      return res.json({
        mode,
        task_count: 0,
        briefing: "You have no open tasks right now. Enjoy the calm!",
        prioritized_tasks: [],
        priority_reasoning: "No tasks to prioritize.",
        generated_at: new Date().toISOString(),
      });
    }

    const today = getTodayStr();
    const taskList = formatTasksForPrompt(tasks);

    const systemPrompt = `You are a sharp, direct executive assistant embedded in TaskFlow, a task management app used by professionals in the cannabis/hemp beverage industry. 
Your job is to help the user cut through noise and focus on what truly matters today.
Be concise, specific, and actionable. Never pad responses. Today's date is ${today}.`;

    let userPrompt = '';

    if (mode === 'prioritize' || mode === 'both') {
      userPrompt += `
## TASK PRIORITIZATION REQUEST

Here are the user's current open tasks:
${taskList}

${custom_context ? `Additional context from user: "${custom_context}"` : ''}

Return a JSON response with this exact structure:
{
  "prioritized_tasks": [
    {
      "original_index": <1-based number matching the task list above>,
      "title": "<task title>",
      "priority_score": <1-100, higher = more urgent>,
      "urgency_label": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "reason": "<1 sentence why this rank>"
    }
  ],
  "priority_reasoning": "<2-3 sentence overall summary of your prioritization logic>"
}

Sort by priority_score descending. Only include the top 10 tasks if there are more than 10.
`;
    }

    if (mode === 'briefing' || mode === 'both') {
      userPrompt += `
## DAILY BRIEFING REQUEST

Here are the user's current open tasks:
${taskList}

${custom_context ? `Additional context from user: "${custom_context}"` : ''}

Write a sharp, executive-style daily briefing. Structure it as:

**🎯 TODAY'S FOCUS** (2-3 most important tasks to complete today, with one sentence why each matters)

**⚠️ NEEDS ATTENTION** (overdue items or things at risk of slipping — be specific)

**📋 YOUR PIPELINE** (brief overview of what's queued up beyond today)

**💡 RECOMMENDATION** (one tactical suggestion for the day — e.g., delegate X, block time for Y, etc.)

Keep the entire briefing under 250 words. Be direct and professional. No filler phrases.
`;
    }

    const isJsonMode = mode === 'prioritize';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 1200,
      ...(isJsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    const rawResponse = completion.choices[0].message.content;

    let result = {
      mode,
      task_count: tasks.length,
      generated_at: new Date().toISOString(),
      model: 'gpt-4o-mini',
    };

    if (mode === 'prioritize') {
      const parsed = JSON.parse(rawResponse);
      result.prioritized_tasks = parsed.prioritized_tasks || [];
      result.priority_reasoning = parsed.priority_reasoning || '';
    } else if (mode === 'briefing') {
      result.briefing = rawResponse;
    } else if (mode === 'both') {
      const jsonMatch = rawResponse.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          result.prioritized_tasks = parsed.prioritized_tasks || [];
          result.priority_reasoning = parsed.priority_reasoning || '';
          result.briefing = rawResponse.replace(jsonMatch[0], '').trim();
        } catch {
          result.briefing = rawResponse;
          result.prioritized_tasks = [];
        }
      } else {
        result.briefing = rawResponse;
        result.prioritized_tasks = [];
      }
    }

    return res.json(result);

  } catch (err) {
    console.error('ChatGPT briefing error:', err);
    return res.status(500).json({
      error: 'Failed to generate briefing',
      details: err.message,
    });
  }
}
