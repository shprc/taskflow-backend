// Backend API endpoint for task categorization
// Deployed on Vercel as serverless function

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { taskText, existingLists, apiKey } = req.body;

    if (!taskText) {
      return res.status(400).json({ error: 'taskText is required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    const hasExistingLists = existingLists && (
      existingLists.people?.length > 0 || 
      existingLists.projects?.length > 0 || 
      existingLists.actions?.length > 0
    );

    const systemPrompt = `You are a task categorization assistant. Analyze the user's task and return ONLY valid JSON with this structure:
{
  "category": "people" | "projects" | "actions",
  "listName": "specific person name, project name, or 'Personal Actions'",
  "text": "cleaned up task text",
  "tags": ["waiting", "follow-up", "action", "to-contact", "urgent"] (array of applicable tags),
  "dueDate": "YYYY-MM-DD or null"
}

${hasExistingLists ? `IMPORTANT: The user has these existing lists. ALWAYS try to match one of these before creating new ones:
${existingLists.people?.length > 0 ? `- People: ${existingLists.people.join(', ')}` : ''}
${existingLists.projects?.length > 0 ? `- Projects/Meetings: ${existingLists.projects.join(', ')}` : ''}
${existingLists.actions?.length > 0 ? `- Actions: ${existingLists.actions.join(', ')}` : ''}

Match names flexibly (e.g., "Shane" matches "shane", "talk to shane", etc.). Only create a new list if the task clearly refers to a different person/project.
` : ''}
Guidelines:
- If mentioning a person's name (talk to X, ask X, email X), use category "people" and listName as their name
- If mentioning a meeting, project, or initiative, use category "projects" and listName as the meeting/project name
- If it's a personal action without a specific person/meeting context, use category "actions" and listName "Personal Actions"
- Extract any date mentions and convert to YYYY-MM-DD format
- Apply relevant tags based on context
- Clean up the text while preserving meaning`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: taskText
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ 
        error: error.error?.message || 'OpenAI API call failed' 
      });
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    
    // Remove markdown code blocks if present
    const cleanContent = content.replace(/```json\n?|\n?```/g, '');
    const categorized = JSON.parse(cleanContent);

    return res.status(200).json(categorized);

  } catch (error) {
    console.error('Categorization error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
}
