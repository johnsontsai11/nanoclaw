/**
 * NanoClaw Agent Runner — Gemini Backend
 * Runs inside a container, receives config via stdin, outputs result to stdout.
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per IPC turn).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { GeminiProvider } from './providers/gemini.provider.js';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

const MAX_HISTORY_TURNS = 20; // Keep context concise to save quota

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Build a system prompt from the group context files (CLAUDE.md equivalent).
 */
function buildSystemPrompt(containerInput: ContainerInput): string {
  const parts: string[] = [];

  // Assistant identity
  if (containerInput.assistantName) {
    parts.push(`You are ${containerInput.assistantName}, a helpful AI assistant.`);
  } else {
    parts.push('You are a helpful AI assistant.');
  }

  // Global CLAUDE.md (non-main groups only)
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
    try {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf-8').trim();
      if (content) parts.push(content);
    } catch { /* skip */ }
  }

  // Group CLAUDE.md
  const groupClaudeMdPath = '/workspace/group/CLAUDE.md';
  if (fs.existsSync(groupClaudeMdPath)) {
    try {
      const content = fs.readFileSync(groupClaudeMdPath, 'utf-8').trim();
      if (content) parts.push(content);
    } catch { /* skip */ }
  }

  // Scheduled task context
  if (containerInput.isScheduledTask) {
    parts.push('Note: This message was sent automatically as a scheduled task, not directly by a user.');
  }

  return parts.join('\n\n');
}

/**
 * Run a single Gemini generateContent call with the accumulated chat history.
 * Polls for IPC _close sentinel concurrently while awaiting the API response.
 */
async function runQuery(
  userText: string,
  history: any[],
  provider: GeminiProvider,
): Promise<{ replyText: string; closedDuringQuery: boolean }> {
  // Check close before starting
  if (shouldClose()) {
    return { replyText: '', closedDuringQuery: true };
  }

  // Build the full contents array: history + new user message
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: userText }] },
  ];

  log(`Calling Provider API (history turns: ${history.length}, prompt length: ${userText.length})`);

  // Race: Provider API call vs _close sentinel poll
  let closedDuringQuery = false;
  let closeCheckInterval: ReturnType<typeof setInterval> | null = null;

  const apiPromise = provider.chat(contents);

  const closePromise = new Promise<void>((resolve) => {
    closeCheckInterval = setInterval(() => {
      if (shouldClose()) {
        closedDuringQuery = true;
        resolve();
      }
    }, IPC_POLL_MS);
  });

  // Wait for API (close detection is best-effort; we finish the request regardless)
  const apiResult = await Promise.race([
    apiPromise.then(r => r),
    closePromise.then(() => null),
  ]);

  if (closeCheckInterval) clearInterval(closeCheckInterval);

  // If closed before API returned, still try to get the result if it resolved
  let replyText = '';
  if (apiResult !== null) {
    const result = apiResult as Awaited<typeof apiPromise>;
    replyText = result.content;
    log(`Provider response received (${replyText.length} chars)`);
  } else {
    // Try to get result from already-pending promise
    try {
      const result = await apiPromise;
      replyText = result.content;
      log(`Provider response received after close signal (${replyText.length} chars)`);
    } catch {
      log('Close detected before Provider response; skipping');
    }
  }

  return { replyText, closedDuringQuery };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Read Gemini credentials from secrets (forwarded by container-runner.ts)
  const apiKey = containerInput.secrets?.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
  const modelName = containerInput.secrets?.NANO_MODEL || process.env.NANO_MODEL || 'gemini-2.0-flash';

  if (!apiKey) {
    writeOutput({
      status: 'error',
      result: null,
      error: 'GOOGLE_API_KEY is not set. Add it to your .env file.'
    });
    process.exit(1);
  }

  const systemPrompt = buildSystemPrompt(containerInput);
  log(`Using model: ${modelName}`);
  log(`System prompt length: ${systemPrompt.length} chars`);

  const provider = new GeminiProvider(apiKey, modelName);
  
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  
  if (systemPrompt) {
    prompt = `System Instructions:\n${systemPrompt}\n\nUser Request:\n${prompt}`;
  }
  
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // In-memory multi-turn history (persists across IPC turns within this container lifetime)
  const history: any[] = [];

  // Query loop: send prompt → append turn to history → wait for IPC → repeat
  try {
    while (true) {
      log(`Starting Provider query (history turns: ${history.length})...`);

      const { replyText, closedDuringQuery } = await runQuery(prompt, history, provider);

      // Append this turn to history for context continuity
      if (prompt) {
        history.push({ role: 'user', parts: [{ text: prompt }] });
      }
      if (replyText) {
        history.push({ role: 'model', parts: [{ text: replyText }] });
      }

      // Truncate history to stay within token limits
      while (history.length > MAX_HISTORY_TURNS) {
        history.shift();
      }

      // Emit result (no sessionId — Provider is stateless; we use in-memory history)
      writeOutput({
        status: 'success',
        result: replyText || null,
      });

      if (closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session-update marker so host can track idle state
      writeOutput({ status: 'success', result: null });

      log('Query ended, waiting for next IPC message...');

      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
