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
import { exec } from 'child_process';
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

async function executeBash(command: string, chatJid: string): Promise<{ output: string; exitCode: number }> {
  log(`DEBUG: executeBash calling: ${command}`);
  
  return new Promise((resolve) => {
    // Prepend /app/src to PATH so our native shims (rss-parser) are found
    const env = { 
      ...process.env, 
      PATH: `/app/src:${process.env.PATH}`,
      CHAT_JID: chatJid 
    };
    log(`Executing bash: ${command}`);
    exec(command, {
      shell: '/bin/bash',
      env
    }, (error, stdout, stderr) => {
      const output = stdout + stderr;
      const exitCode = error ? (error.code || 1) : 0;
      resolve({ output, exitCode });
    });
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

  // Language rules and other guidelines are now managed via skills and global CLAUDE.md
  // No longer hardcoded in the runner source.

  // Hardcoded tool format rules
  parts.push(
    'IMPORTANT: The ONLY way to run code or execute commands is by wrapping bash commands in <execute_bash> tags, like this:\n' +
    '<execute_bash>echo "hello"</execute_bash>\n\n' +
    'ENVIRONMENT: You are running in a Linux container. The following tools are PRE-INSTALLED and MUST be used via <execute_bash>:\n' +
    '- `curl`, `jq`, `sed`, `grep`, `awk`, `date` (standard Linux utilities)\n' +
    '- `agent-browser` (utility for web fetching: use `agent-browser open "URL"`)\n' +
    '- `mcp__nanoclaw__send_message` (utility for sending messages)\n\n' +
    'You MUST use these tools via <execute_bash> to perform tasks.\n\n' +
    'NEVER use <tool_code> tags. NEVER use Python function calls. Only <execute_bash> is supported.',
  );

  // Global CLAUDE.md (all groups, including main)
  const globalClaudeMdPaths = [
    '/workspace/global/CLAUDE.md',
    '/workspace/project/groups/global/CLAUDE.md',
  ];
  for (const globalPath of globalClaudeMdPaths) {
    if (fs.existsSync(globalPath)) {
      try {
        const content = fs.readFileSync(globalPath, 'utf-8').trim();
        if (content) {
          parts.push(content);
          break;
        }
      } catch { /* skip */ }
    }
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

  // Runtime context
  const contextLines: string[] = ['## Runtime Context (injected by host)'];
  if (containerInput.chatJid) {
    contextLines.push(`- **Current group JID**: \`${containerInput.chatJid}\` — use this as \`targetJid\` when scheduling tasks for this group`);
  }
  if (containerInput.groupFolder) {
    contextLines.push(`- **Group folder**: \`${containerInput.groupFolder}\``);
  }
  parts.push(contextLines.join('\n'));

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
  if (shouldClose()) {
    return { replyText: '', closedDuringQuery: true };
  }

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: userText }] },
  ];

  log(`Calling Provider API (history turns: ${history.length}, prompt length: ${userText.length})`);

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

  const apiResult = await Promise.race([
    apiPromise.then(r => r),
    closePromise.then(() => null),
  ]);

  if (closeCheckInterval) clearInterval(closeCheckInterval);

  let replyText = '';
  if (apiResult !== null) {
    const result = apiResult as Awaited<typeof apiPromise>;
    replyText = result.content;
    log(`Provider response received (${replyText.length} chars)`);
  } else {
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
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

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

  const history: any[] = [];

  try {
    let currentPrompt = prompt;
    while (true) {
      log(`Starting Provider query (history turns: ${history.length})...`);

      const { replyText, closedDuringQuery } = await runQuery(currentPrompt, history, provider);
      log(`DEBUG: Raw Gemini response: ${replyText}`);

      // Append user turn to history
      if (currentPrompt) {
        history.push({ role: 'user', parts: [{ text: currentPrompt }] });
      }
      
      let finalReply = replyText;
      let iteration = 0;
      const MAX_ITERATIONS = 10;

      // Tool execution loop
      while (iteration < MAX_ITERATIONS) {
        const bashMatch = finalReply.match(/<execute_bash>([\s\S]*?)<\/execute_bash>/);
        if (!bashMatch) break;

        iteration++;
        const command = bashMatch[1].trim();
        log(`DEBUG: Tool call detected: ${command}`);
        
        // Append model turn (with tool call) to history
        history.push({ role: 'model', parts: [{ text: finalReply }] });

        const { output, exitCode } = await executeBash(command, containerInput.chatJid);
        log(`DEBUG: Tool result (exit ${exitCode}): ${output.slice(0, 50)}...`);
        
        // Wrap observation in a structured tag so Gemini interprets it as a tool result,
        // not as user content to echo back to the user.
        const observation = `<bash_result exit_code="${exitCode}">${output}</bash_result>`;
        
        log(`Bash output (${output.length} chars), re-calling Provider...`);
        
        // Gemini doesn't have "observation" role, so we use "user" for tool results
        const { replyText: nextReply, closedDuringQuery: closedInTool } = await runQuery(observation, history, provider);
        log(`DEBUG: Raw Gemini nextReply: ${nextReply}`);
        
        // Append observation turn to history
        history.push({ role: 'user', parts: [{ text: observation }] });
        
        finalReply = nextReply;
        if (closedInTool) break;
      }

      // Final model turn to history
      if (finalReply) {
        history.push({ role: 'model', parts: [{ text: finalReply }] });
      }

      // Truncate history to stay within token limits
      while (history.length > MAX_HISTORY_TURNS) {
        history.shift();
      }

      // Emit result
      writeOutput({
        status: 'success',
        result: finalReply || null,
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
      currentPrompt = nextMessage;
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
