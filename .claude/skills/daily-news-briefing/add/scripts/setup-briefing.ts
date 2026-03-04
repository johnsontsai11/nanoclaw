import { initDatabase, getAllTasks, createTask, updateTask } from '../../../../../dist/db.js';

// ============================================================================
// BRIEFING PROMPT
//
// Design decisions:
// 1. Use agent-browser (not curl) — the LLM recognizes it as its own tool
// 2. Pipe through sed/grep to extract ONLY titles — keeps output small (~1KB)
//    instead of dumping 28KB of raw XML per feed into context
// 3. All RSS fetching in ONE execute_bash block — saves iteration budget
//    (agent-runner has MAX_ITERATIONS=5)
// 4. Let the LLM synthesize the report from clean, pre-parsed title lists
// ============================================================================
const promptPath = path.join(__dirname, '../../../../scripts/briefing-prompt.txt');
const BRIEFING_PROMPT = fs.readFileSync(promptPath, 'utf8').trim();


// ============================================================================
// TASK MANAGEMENT — find by schedule+folder, not by prompt text
// ============================================================================
const main = async () => {
  await initDatabase();
  const tasks = await getAllTasks();

  const briefingTasks = tasks.filter(t =>
    t.group_folder === 'main' &&
    t.schedule_type === 'cron' &&
    t.schedule_value === '0 8 * * *'
  );

  if (briefingTasks.length === 0) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await createTask({
      id: taskId,
      group_folder: 'main',
      chat_jid: '',
      prompt: BRIEFING_PROMPT,
      schedule_type: 'cron',
      schedule_value: '0 8 * * *',
      context_mode: 'group',
      status: 'active',
      next_run: null,
      created_at: new Date().toISOString(),
    });
    console.log('Successfully created daily briefing task:', taskId);
  } else {
    const [primary, ...extras] = briefingTasks;
    await updateTask(primary.id, { ...primary, prompt: BRIEFING_PROMPT, status: 'active' });
    console.log('Successfully updated daily briefing task:', primary.id);

    for (const extra of extras) {
      await updateTask(extra.id, { ...extra, status: 'paused' });
      console.log('Paused duplicate task:', extra.id);
    }
  }
};

main().catch(err => {
  console.error('Failed to setup briefing:', err);
  process.exit(1);
});
