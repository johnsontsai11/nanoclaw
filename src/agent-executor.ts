import fs from 'fs';
import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
  RETRY_LIMIT,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllTasks,
  getMessagesSince,
  setSession,
} from './db.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import {
  isTriggerAllowed,
  loadSenderAllowlist,
} from './sender-allowlist.js';
import { Channel, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { GroupQueue } from './group-queue.js';

export interface ExecutorState {
  lastAgentTimestamp: Record<string, string>;
  sessions: Record<string, string>;
  registeredGroups: Record<string, RegisteredGroup>;
  channels: Channel[];
  queue: GroupQueue;
  busyChats: Set<string>;
  lastAckSentAt: Map<string, number>;
  saveState: () => void;
}

const ACK_COOLDOWN_MS = 60_000; // 1 minute

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
export async function processGroupMessages(chatJid: string, state: ExecutorState): Promise<boolean> {
  const group = state.registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(state.channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.isMain === true;

  const sinceTimestamp = state.lastAgentTimestamp[chatJid] || '';
  let missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // Backlog safety: If we have an overwhelming number of missed messages,
  // skip the old ones and only process the most recent context to avoid
  // exploding the Token count (TPM) and hitting 429 errors.
  const BACKLOG_THRESHOLD = 10;
  if (missedMessages.length > BACKLOG_THRESHOLD) {
    logger.warn(
      { jid: chatJid, totalMissed: missedMessages.length },
      `Backlog too large, truncating to most recent ${BACKLOG_THRESHOLD} messages`
    );
    missedMessages = missedMessages.slice(-BACKLOG_THRESHOLD);
  }

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        TRIGGER_PATTERN.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages, TIMEZONE);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = state.lastAgentTimestamp[chatJid] || '';
  state.lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  state.saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      state.queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  state.busyChats.add(chatJid);
  // Reset the cooldown timer whenever processing starts fresh, so stale
  // timestamps from previous long-running tasks don't cause "Still working on it..."
  // to fire immediately for a quick follow-up query.
  state.lastAckSentAt.set(chatJid, Date.now());

  // Periodically send "Still working on it..." during long-running tasks.
  // Checks every 10s if we are busy and if a minute has passed since the last interaction.
  const progressInterval = setInterval(() => {
    if (!state.busyChats.has(chatJid)) return;
    
    const now = Date.now();
    const last = state.lastAckSentAt.get(chatJid) ?? 0;
    if (now - last >= ACK_COOLDOWN_MS) {
      state.lastAckSentAt.set(chatJid, now);
      logger.info({ chatJid }, 'Sending periodic progress update');
      channel.sendMessage(chatJid, 'Still working on it...').catch(() => {});
    }
  }, 10_000);

  let hadError = false;
  let outputSentToUser = false;

  try {
    const output = await runAgent(group, prompt, chatJid, state, async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        state.busyChats.add(chatJid);
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        // Strip internal/tool tags using shared formatOutbound
        const text = formatOutbound(raw);
        logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
        if (text) {
          // Fire and forget send message so it doesn't block container cleanup
          channel.sendMessage(chatJid, text).catch((err) =>
            logger.warn({ chatJid, err }, 'Failed to send agent streaming output'),
          );
          outputSentToUser = true;
        }
        // Only reset idle timer on actual results, not session-update markers (result: null)
        resetIdleTimer();
      }

      if (result.status === 'success') {
        if (result.result === null) {
          // Turn completed, waiting for IPC
          state.busyChats.delete(chatJid);
        }
        state.queue.notifyIdle(chatJid);
      }

      if (result.status === 'error') {
        hadError = true;
        state.busyChats.delete(chatJid);
        
        if (result.error && result.error.includes('429 Too Many Requests') && result.error.includes('Quota exceeded')) {
          const currentRetries = state.queue.getRetryCount(chatJid);
          if (currentRetries >= RETRY_LIMIT) {
            channel.sendMessage(
              chatJid,
              `❌ *API Quota Limit* still exceeded after multiple retries. I've stopped trying for now. Please ask again later.`
            ).catch(() => {});
          } else {
            const nextDelaySecs = Math.round((5000 * Math.pow(2, currentRetries)) / 1000);
            channel.sendMessage(
              chatJid,
              `⚠️ *API Quota Limit Reached*\nGoogle says I'm thinking too fast right now. I will automatically try again quietly in ${nextDelaySecs} seconds.`
            ).catch(() => {});
          }
        } else if (result.error && (result.error.includes('API key expired') || result.error.includes('api key not found') || result.error.includes('API_KEY_INVALID'))) {
          channel.sendMessage(
            chatJid,
            `❌ *Invalid API Key!*\n\nGoogle is reporting that your API key is expired or invalid. Please update your \`GOOGLE_API_KEY\` in the \`.env\` file and run \`./restart.sh\`.`
          ).catch(() => {});
        }
      }
    });

    if (output === 'error' || hadError) {
      if (outputSentToUser) return true;
      state.lastAgentTimestamp[chatJid] = previousCursor;
      state.saveState();
      return false;
    }
  } catch (err) {
    logger.error({ group: group.name, err }, 'Critical error in processGroupMessages');
    return false;
  } finally {
    await channel.setTyping?.(chatJid, false);
    state.busyChats.delete(chatJid);
    clearInterval(progressInterval);
    if (idleTimer) clearTimeout(idleTimer);
  }

  return true;
}

export async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  state: ExecutorState,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const sessionId = state.sessions[group.folder];

  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  const { getAvailableGroups } = await import('./index.js');
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(state.registeredGroups)),
  );

  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          state.sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) =>
        state.queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      state.sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    return output.status === 'error' ? 'error' : 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}
