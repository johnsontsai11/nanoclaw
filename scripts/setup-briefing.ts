import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getAllTasks, createTask, updateTask } from '../src/db.js';
import { logger } from '../src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const promptPath = path.resolve(__dirname, 'briefing-prompt.txt');
const BRIEFING_PROMPT = fs.readFileSync(promptPath, 'utf8').trim();

async function main() {
  initDatabase();
  const tasks = getAllTasks();
  
  const existing = tasks.find(t => t.prompt.includes('每日早報生成任務') || t.prompt.includes('Daily Morning Briefing Task'));
  
  const taskId = existing ? existing.id : `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  
  const task = {
    id: taskId,
    group_folder: 'main',
    chat_jid: existing ? existing.chat_jid : '',
    prompt: BRIEFING_PROMPT,
    schedule_type: 'cron' as const,
    schedule_value: '0 8 * * *',
    context_mode: 'group' as const,
    status: 'active' as const,
    next_run: existing ? existing.next_run : null,
    created_at: existing ? existing.created_at : new Date().toISOString()
  };

  if (existing) {
    updateTask(taskId, task);
  } else {
    createTask(task);
  }
  console.log(existing ? 'Successfully updated daily briefing task:' : 'Successfully created daily briefing task:', taskId);
}

main().catch(err => {
  console.error('Failed to setup briefing:', err);
  process.exit(1);
});
