import {
  ASSISTANT_NAME,
  POLL_INTERVAL,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
import {
  getMessagesSince,
  getNewMessages,
} from './db.js';
import { findChannel, formatMessages } from './router.js';
import {
  isTriggerAllowed,
  loadSenderAllowlist,
} from './sender-allowlist.js';
import { NewMessage } from './types.js';
import { logger } from './logger.js';
import { ExecutorState } from './agent-executor.js';

const ACK_COOLDOWN_MS = 60_000; // 1 minute

export interface SharedState {
  messageLoopRunning: boolean;
  lastTimestamp: string;
  saveState: () => void;
}

export async function startMessageLoop(state: ExecutorState, sharedState: SharedState): Promise<void> {
  if (sharedState.messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  sharedState.messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(state.registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        sharedState.lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        sharedState.lastTimestamp = newTimestamp;
        sharedState.saveState();

        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = state.registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(state.channels, chatJid);
          if (!channel) continue;

          const isMainGroup = group.isMain === true;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          if (needsTrigger) {
            const allowlistCfg = loadSenderAllowlist();
            const hasTrigger = groupMessages.some(
              (m) =>
                TRIGGER_PATTERN.test(m.content.trim()) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!hasTrigger) continue;
          }

          const allPending = getMessagesSince(
            chatJid,
            state.lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          const now = Date.now();
          const lastAck = state.lastAckSentAt.get(chatJid) ?? 0;
          const isBusy = state.queue.isActive(chatJid);

          if (isBusy && (now - lastAck > ACK_COOLDOWN_MS)) {
            state.lastAckSentAt.set(chatJid, now);
            setTimeout(() => {
              if (state.queue.isActive(chatJid)) {
                channel.sendMessage(
                  chatJid,
                  'Got the new input! Still working on the current task...'
                ).catch(() => {});
              }
            }, 5000);
          }

          if (state.queue.sendMessage(chatJid, formatted)) {
            state.busyChats.add(chatJid);
            state.lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            state.saveState();
            channel.setTyping?.(chatJid, true)?.catch(() => {});
          } else {
            state.queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

export function recoverPendingMessages(state: ExecutorState): void {
  for (const [chatJid, group] of Object.entries(state.registeredGroups)) {
    const sinceTimestamp = state.lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      state.queue.enqueueMessageCheck(chatJid);
    }
  }
}
