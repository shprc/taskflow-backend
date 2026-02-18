# TaskFlow ChatGPT Integration — Setup Guide

## What This Adds
- **Daily Briefing**: ChatGPT reads your open tasks and generates a sharp, executive-style morning brief (focus, risks, pipeline, recommendation)
- **Prioritize Tasks**: ChatGPT scores and reorders your tasks by urgency with one-line reasoning per item
- Optional context field: "I have a board meeting at 2pm" shapes the AI output

---

## File Inventory

| File | Destination |
|------|-------------|
| `taskflow-chatgpt-backend.js` | Your Vercel backend → `api/chatgpt-briefing.js` |
| `taskflow-chatgpt-frontend.js` | Add as `<script>` or paste inline in your main HTML |

---

## Step 1 — Backend: Add the API Endpoint

### 1a. Copy the file
```
taskflow-chatgpt-backend.js → your-backend-repo/api/chatgpt-briefing.js
```

### 1b. Verify your Vercel environment variables
Your backend already has these (used by existing AI categorization) — confirm:
```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   ← service role key (not anon)
```

### 1c. Check your Supabase tasks table columns
The endpoint reads these columns — confirm they exist in your `tasks` table:
```
id, title, status, priority, category, due_date, assigned_to, created_at, user_id, list_id
```
If any are named differently, update the `SELECT` query and `formatTasksForPrompt()` in the backend file.

### 1d. Test the endpoint
```bash
curl -X POST https://taskflow-backend-gamma.vercel.app/api/chatgpt-briefing \
  -H "Content-Type: application/json" \
  -d '{"mode": "briefing", "user_id": "YOUR_USER_ID"}'
```
Expected response shape:
```json
{
  "mode": "briefing",
  "task_count": 12,
  "briefing": "**🎯 TODAY'S FOCUS**\n...",
  "generated_at": "2025-02-17T...",
  "model": "gpt-4o-mini"
}
```

---

## Step 2 — Frontend: Wire Up the Panel

### 2a. Since you're using standalone HTML (no build step), paste inline:

In your main `index.html`, before the closing `</body>`:

```html
<!-- Paste the full contents of taskflow-chatgpt-frontend.js here,
     removing the ES module export line at the bottom -->
```

Or if you have a scripts folder:
```html
<script src="/scripts/chatgpt-panel.js"></script>
```

### 2b. Initialize the panel in your app's DOMContentLoaded / init function:

```javascript
// After your existing app init code:

const chatGPTPanel = new ChatGPTPanel({
  backendUrl: BACKEND_URL  // your existing BACKEND_URL global
});

// Add trigger button to your header/toolbar:
const triggerBtn = createChatGPTTriggerButton(chatGPTPanel);
document.querySelector('#header-actions').appendChild(triggerBtn);
// Adjust the selector to match your actual toolbar element
```

### 2c. If you want to open it from an existing button instead:

```javascript
document.querySelector('#your-existing-btn').addEventListener('click', () => {
  chatGPTPanel.show(currentUser?.id);
});
```

---

## Step 3 — Remove the ES module export (for standalone HTML)

At the bottom of the frontend file, remove or comment out:
```javascript
export { ChatGPTPanel, createChatGPTTriggerButton };
```
This line is only needed if you're using a bundler.

---

## Step 4 — Optional: Pass Filters

The backend supports optional filters if you want to scope the briefing:

```javascript
// Only briefing tasks from a specific list:
const result = await fetch(`${BACKEND_URL}/api/chatgpt-briefing`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'briefing',
    user_id: currentUser.id,
    filters: { list_id: 'abc123' },
    custom_context: 'Focus on GTI-related tasks'
  })
});
```

---

## How It Works (Architecture)

```
User clicks "Generate Briefing"
        │
        ▼
Frontend (taskflow-frontend-lime.vercel.app)
  POST /api/chatgpt-briefing
        │
        ▼
Backend (taskflow-backend-gamma.vercel.app)
  1. Fetches open tasks from Supabase
  2. Formats them into a structured prompt
  3. Sends to gpt-4o-mini with mode-specific instructions
  4. Returns parsed result
        │
        ▼
Frontend renders:
  - Daily Briefing: Markdown-formatted narrative
  - Prioritize: Ranked list with urgency badges + reasoning
```

---

## Cost Estimate

| Scenario | Tokens | Cost (gpt-4o-mini) |
|----------|--------|---------------------|
| 20 tasks, briefing | ~800 in / ~300 out | ~$0.0003 |
| 50 tasks, prioritize | ~1800 in / ~600 out | ~$0.0007 |

Daily usage for one user ≈ **< $0.01/day**

---

## Troubleshooting

**"No tasks returned"** — Check that `user_id` matches what's stored in Supabase. Log `req.body.user_id` and compare to your `tasks.user_id` column.

**CORS error** — The backend sets `Access-Control-Allow-Origin: *`. If still failing, check your Vercel backend's existing CORS middleware isn't overriding it.

**OpenAI 429 rate limit** — gpt-4o-mini has generous limits; this is unlikely. If it happens, add a simple retry in the backend.

**Briefing too generic** — Add more context in the optional context field. You can also edit the system prompt in the backend to include your industry specifics (it already mentions hemp/cannabis).

---

## Next Phase: Real-Time Sync (your #2 priority)

Once this is wired up, the next recommended step is switching from load-only sync to Supabase Realtime. The key change:

```javascript
// Replace your current fetch-on-load pattern with:
const subscription = supabase
  .channel('tasks')
  .on('postgres_changes', 
    { event: '*', schema: 'public', table: 'tasks' }, 
    (payload) => { updateTaskInUI(payload); }
  )
  .subscribe();
```

This keeps all devices in sync without polling and sets up a clean foundation for collaborative features.
