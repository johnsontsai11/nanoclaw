const Database = require('better-sqlite3');
const db = new Database('/Volumes/DevDisk/nanoclaw/store/messages.db');
const tasks = db.prepare('SELECT id, prompt FROM scheduled_tasks').all();
for (const task of tasks) {
  console.log('Task ID:', task.id);
  console.log('AdAge in prompt:', task.prompt.includes('AdAge'));
  console.log('Marketing in prompt:', task.prompt.includes('MarketWatch'));
  console.log('Prompt head:', task.prompt.substring(0, 150));
}
const groups = db.prepare('SELECT * FROM registered_groups').all();
console.log('Groups:', JSON.stringify(groups, null, 2));
