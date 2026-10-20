import type { AllZonesTestSummary, DeliveryQueueItem } from './types.ts';

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function escapeTelegramHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatUtcToIstDisplay(isoUtc: string): string {
  try {
    const d = new Date(isoUtc);
    if (Number.isNaN(d.getTime())) return isoUtc;
    return (
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(d) + ' IST'
    );
  } catch {
    return isoUtc;
  }
}

/**
 * Formats an eligible production notice according to Section 9 Telegram Message Format.
 */
export function formatProductionNoticeTelegramMessage(
  item: DeliveryQueueItem,
  detectedAtUtcIso: string
): string[] {
  const boardName = escapeTelegramHtml(item.boardName);
  const category = escapeTelegramHtml(item.category);
  const title = escapeTelegramHtml(item.title);
  const pubDate = escapeTelegramHtml(item.publicationDate || 'Official Portal Date Pending');
  const officialUrl = escapeTelegramHtml(item.officialNoticeUrl);
  const primaryPdf =
    item.attachmentUrls && item.attachmentUrls.length > 0
      ? escapeTelegramHtml(item.attachmentUrls[0])
      : 'Included in Official Notice Link';
  const detectedAtIST = escapeTelegramHtml(formatUtcToIstDisplay(detectedAtUtcIso));

  const fullMessage = [
    '🚆 <b>NEW RRB OFFICIAL NOTICE</b>',
    '',
    `<b>Board:</b> ${boardName}`,
    `<b>Category:</b> ${category}`,
    `<b>Title:</b> ${title}`,
    `<b>Publication Date:</b> ${pubDate}`,
    '',
    '<b>Official Notice:</b>',
    officialUrl,
    '',
    '<b>PDF / Attachment:</b>',
    primaryPdf,
    '',
    `<b>Detected At:</b> ${detectedAtIST}`,
  ].join('\n');

  return splitTelegramMessageSafely(fullMessage);
}

/**
 * Splits a message safely into chunks <= 4096 characters without breaking lines mid-entity.
 */
export function splitTelegramMessageSafely(
  message: string,
  maxLength = TELEGRAM_MAX_MESSAGE_LENGTH
): string[] {
  if (message.length <= maxLength) {
    return [message];
  }
  const lines = message.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (line.length <= maxLength) {
        current = line;
      } else {
        // Hard slice oversized single line
        let remaining = line;
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength));
          remaining = remaining.slice(maxLength);
        }
        current = remaining;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Formats an unmistakable TEST summary for All-Zones Test when test notifications are explicitly requested.
 */
export function formatAllZonesTestSummaryTelegram(summary: AllZonesTestSummary): string {
  const sampleLines = summary.reports.slice(0, 6).map((r) => {
    const t = r.latestParsedNoticeTitle
      ? escapeTelegramHtml(r.latestParsedNoticeTitle.slice(0, 65))
      : 'No notice parsed';
    return `• <b>${escapeTelegramHtml(r.boardName)}:</b> [${r.verdict}] ${t}`;
  });

  return [
    '🧪 <b>[TEST SUMMARY — NOT A PRODUCTION ALERT]</b>',
    '<b>RRB Notice Monitor — All-Zones Verification Report</b>',
    '',
    `<b>Mode:</b> ${escapeTelegramHtml(summary.dataSourceMode)}`,
    `<b>Boards Configured:</b> ${summary.totalBoardsConfigured} | <b>Tested:</b> ${summary.totalTested}`,
    `<b>PASS:</b> ${summary.counts.PASS} | <b>PARTIAL:</b> ${summary.counts.PARTIAL} | <b>FAIL:</b> ${summary.counts.FAIL} | <b>BLOCKED:</b> ${summary.counts.BLOCKED}`,
    '',
    '<b>Sample Verified Board Headlines:</b>',
    ...sampleLines,
    '',
    `<b>Executed At:</b> ${escapeTelegramHtml(summary.executedAtIST)}`,
  ].join('\n');
}

export interface TelegramDeliveryOutcome {
  status: 'sent' | 'failed' | 'uncertain';
  messageId: number | null;
  retryAfterSeconds: number | null;
  errorCategory: string | null;
  diagnosticMessage: string;
}

export interface TelegramConfig {
  configured: boolean;
  botToken: string;
  chatId: string;
  validationErrors: string[];
}

export function getTelegramConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): TelegramConfig {
  const botToken = (env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (env.TELEGRAM_CHAT_ID || '').trim();
  const validationErrors: string[] = [];

  const isPlaceholder = (v: string) =>
    !v || v.startsWith('YOUR_') || v.startsWith('MY_') || v.startsWith('GENERATE_');

  if (isPlaceholder(botToken)) {
    validationErrors.push('TELEGRAM_BOT_TOKEN is not configured');
  }
  if (isPlaceholder(chatId)) {
    validationErrors.push('TELEGRAM_CHAT_ID is not configured');
  }

  return {
    configured: validationErrors.length === 0,
    botToken,
    chatId,
    validationErrors,
  };
}

/**
 * Sends a Telegram message from server-side code.
 * Never logs or exposes the bot token in error messages.
 * Distinguishes definite failures (4xx/429 before dispatch) from post-dispatch network timeouts ('uncertain').
 */
export async function sendTelegramHtmlMessage(
  htmlText: string,
  options?: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }
): Promise<TelegramDeliveryOutcome> {
  const cfg = getTelegramConfigFromEnv(options?.env);
  if (!cfg.configured) {
    return {
      status: 'failed',
      messageId: null,
      retryAfterSeconds: null,
      errorCategory: 'CREDENTIALS_MISSING',
      diagnosticMessage: cfg.validationErrors.join('; '),
    };
  }

  const fetchImpl = options?.fetchImpl || fetch;
  const timeoutMs = options?.timeoutMs ?? 8000;
  const chunks = splitTelegramMessageSafely(htmlText);
  let firstMessageId: number | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: chunks[i],
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { message_id?: number };
        description?: string;
        parameters?: { retry_after?: number };
      };

      if (res.status === 429) {
        const retryAfter = data.parameters?.retry_after ?? 30;
        return {
          status: i > 0 ? 'uncertain' : 'failed',
          messageId: firstMessageId,
          retryAfterSeconds: retryAfter,
          errorCategory: 'RATE_LIMITED_429',
          diagnosticMessage:
            i > 0
              ? `Chunk ${i + 1}/${chunks.length} hit HTTP 429 after Chunk 1 succeeded. Marked UNCERTAIN to prevent duplicate Chunk 1 resend.`
              : `Telegram rate limit hit (HTTP 429). Retry after ${retryAfter}s.`,
        };
      }

      if (!res.ok || !data.ok) {
        const SafeDesc = (data.description || `HTTP ${res.status}`).replace(
          cfg.botToken,
          '[REDACTED_TOKEN]'
        );
        let category = 'TELEGRAM_API_ERROR';
        if (/chat not found/i.test(SafeDesc)) category = 'INVALID_CHAT_ID';
        else if (/blocked by the user/i.test(SafeDesc)) category = 'BOT_BLOCKED';
        else if (/not enough rights|need administrator rights/i.test(SafeDesc))
          category = 'INSUFFICIENT_PERMISSIONS';
        else if (res.status === 401 || res.status === 404) category = 'INVALID_BOT_TOKEN';

        return {
          status: i > 0 ? 'uncertain' : 'failed',
          messageId: firstMessageId,
          retryAfterSeconds: null,
          errorCategory: category,
          diagnosticMessage:
            i > 0
              ? `Chunk ${i + 1}/${chunks.length} rejected (${SafeDesc}) after Chunk 1 was sent. Marked UNCERTAIN to avoid duplicate resend.`
              : `Telegram API rejected message: ${SafeDesc}`,
        };
      }

      if (firstMessageId === null && typeof data.result?.message_id === 'number') {
        firstMessageId = data.result.message_id;
      }
    } catch (err) {
      clearTimeout(timer);
      const safeErrMessage = ((err as Error).message || 'Network error').replace(
        cfg.botToken,
        '[REDACTED_TOKEN]'
      );
      // If the HTTP POST timed out or dropped after transmission, Telegram may have already accepted & delivered it.
      // Mark as 'uncertain' to prevent duplicate alert loops!
      return {
        status: 'uncertain',
        messageId: firstMessageId,
        retryAfterSeconds: null,
        errorCategory: 'POST_TRANSMISSION_TIMEOUT_OR_UNCERTAIN',
        diagnosticMessage: `Request timed out or dropped after sendMessage dispatch (${safeErrMessage}). Marked as UNCERTAIN to prevent duplicate alerts; requires reconciliation.`,
      };
    }
  }

  return {
    status: 'sent',
    messageId: firstMessageId ?? 1,
    retryAfterSeconds: null,
    errorCategory: null,
    diagnosticMessage: `Delivered successfully (Telegram message_id: ${firstMessageId ?? 1}).`,
  };
}

export interface DedicatedTelegramTestReport {
  testedAt: string;
  testedAtIST: string;
  credentialsPresent: boolean;
  missingCredentials: string[];
  botValidated: boolean;
  botUsername: string | null;
  botId: number | null;
  testMessageRequested: boolean;
  testMessageSent: boolean;
  telegramMessageId: number | null;
  errorCategory: string | null;
  diagnosticMessage: string;
  productionStateModified: false;
}

/**
 * Section 12: Dedicated Telegram Connectivity Test.
 * 1. Verifies credentials without printing values.
 * 2. Calls getMe to validate the bot token.
 * 3. Sends a clearly labelled [TEST] message only when sendTestMessage=true.
 * 4. Checks returned message_id and never modifies production notice fingerprints.
 */
export async function runDedicatedTelegramTest(options?: {
  sendTestMessage?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<DedicatedTelegramTestReport> {
  const nowIso = new Date().toISOString();
  const cfg = getTelegramConfigFromEnv(options?.env);
  const fetchImpl = options?.fetchImpl || fetch;
  const sendTestMessage = options?.sendTestMessage ?? true;

  if (!cfg.configured) {
    return {
      testedAt: nowIso,
      testedAtIST: formatUtcToIstDisplay(nowIso),
      credentialsPresent: false,
      missingCredentials: cfg.validationErrors,
      botValidated: false,
      botUsername: null,
      botId: null,
      testMessageRequested: sendTestMessage,
      testMessageSent: false,
      telegramMessageId: null,
      errorCategory: 'CREDENTIALS_MISSING',
      diagnosticMessage: `Required Telegram secrets are not configured: ${cfg.validationErrors.join(', ')}. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in server secrets.`,
      productionStateModified: false,
    };
  }

  try {
    const getMeRes = await fetchImpl(`https://api.telegram.org/bot${cfg.botToken}/getMe`, {
      method: 'GET',
    });
    const getMeData = (await getMeRes.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { id?: number; username?: string; first_name?: string };
      description?: string;
    };

    if (!getMeRes.ok || !getMeData.ok) {
      const desc = (getMeData.description || `HTTP ${getMeRes.status}`).replace(
        cfg.botToken,
        '[REDACTED]'
      );
      return {
        testedAt: nowIso,
        testedAtIST: formatUtcToIstDisplay(nowIso),
        credentialsPresent: true,
        missingCredentials: [],
        botValidated: false,
        botUsername: null,
        botId: null,
        testMessageRequested: sendTestMessage,
        testMessageSent: false,
        telegramMessageId: null,
        errorCategory: 'INVALID_BOT_TOKEN',
        diagnosticMessage: `Telegram getMe validation failed: ${desc}`,
        productionStateModified: false,
      };
    }

    const botUsername = getMeData.result?.username || getMeData.result?.first_name || 'verified_bot';
    const botId = getMeData.result?.id ?? null;

    if (!sendTestMessage) {
      return {
        testedAt: nowIso,
        testedAtIST: formatUtcToIstDisplay(nowIso),
        credentialsPresent: true,
        missingCredentials: [],
        botValidated: true,
        botUsername,
        botId,
        testMessageRequested: false,
        testMessageSent: false,
        telegramMessageId: null,
        errorCategory: null,
        diagnosticMessage: `Bot @${botUsername} validated via getMe (message dispatch skipped as requested).`,
        productionStateModified: false,
      };
    }

    const testHtml = [
      '🧪 <b>[TEST — NOT A PRODUCTION RRB NOTICE]</b>',
      '<b>RRB Official Notice Monitor — Connectivity Verification</b>',
      '',
      `<b>Bot Identity:</b> @${escapeTelegramHtml(botUsername)}`,
      `<b>Timestamp:</b> ${escapeTelegramHtml(formatUtcToIstDisplay(nowIso))}`,
      '<b>Note:</b> This test verifies Telegram Bot API connectivity only and does not alter production notice fingerprints.',
    ].join('\n');

    const outcome = await sendTelegramHtmlMessage(testHtml, {
      env: options?.env,
      fetchImpl,
    });

    return {
      testedAt: nowIso,
      testedAtIST: formatUtcToIstDisplay(nowIso),
      credentialsPresent: true,
      missingCredentials: [],
      botValidated: true,
      botUsername,
      botId,
      testMessageRequested: true,
      testMessageSent: outcome.status === 'sent',
      telegramMessageId: outcome.messageId,
      errorCategory: outcome.errorCategory,
      diagnosticMessage: outcome.diagnosticMessage,
      productionStateModified: false,
    };
  } catch (err) {
    const safeMsg = ((err as Error).message || 'Network failure').replace(
      cfg.botToken,
      '[REDACTED]'
    );
    return {
      testedAt: nowIso,
      testedAtIST: formatUtcToIstDisplay(nowIso),
      credentialsPresent: true,
      missingCredentials: [],
      botValidated: false,
      botUsername: null,
      botId: null,
      testMessageRequested: sendTestMessage,
      testMessageSent: false,
      telegramMessageId: null,
      errorCategory: 'NETWORK_ERROR',
      diagnosticMessage: `Failed to reach Telegram API: ${safeMsg}`,
      productionStateModified: false,
    };
  }
}
