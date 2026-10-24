import {
  VERIFIED_BOARD_CONFIGS,
  getBoardById,
  isApprovedOfficialUrl,
} from './boards.ts';
import {
  DEFAULT_MAX_NOTIFICATIONS_PER_RUN,
  DEFAULT_MAX_NOTICE_AGE_DAYS,
  createDeliveryQueueItem,
  evaluateNoticeEligibility,
  parseConfiguredKeywords,
} from './eligibility.ts';
import {
  BOARD_SEED_NOTICES,
  buildOfficialBoardHtmlFixture,
} from './fixtures/htmlFixtures.ts';
import type { BoardSeedNotice } from './fixtures/htmlFixtures.ts';
import { computeNoticeHashes, parseBoardPageContent } from './parser.ts';
import {
  acquireDurableLock,
  createInitialMonitorState,
  releaseDurableLock,
} from './stateStore.ts';
import type { StateStoreAdapter } from './stateStore.ts';
import {
  formatAllZonesTestSummaryTelegram,
  formatProductionNoticeTelegramMessage,
  formatUtcToIstDisplay,
  sendTelegramHtmlMessage,
} from './telegram.ts';
import type {
  AllZonesTestSummary,
  BoardConfig,
  ErrorRecord,
  MonitorState,
  RunHistoryEntry,
  ZoneTestReport,
  ZoneTestVerdict,
} from './types.ts';

export interface FetchBoardResult {
  fetchResult: 'SUCCESS' | 'TIMEOUT' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'SSRF_BLOCKED';
  httpStatus: number | null;
  redirectDestination: string | null;
  contentType: string | null;
  responseSizeBytes: number;
  durationMs: number;
  body: string;
  errorCategory: string | null;
  diagnosticMessage: string;
  dataSourceMode: 'LIVE_NETWORK' | 'DETERMINISTIC_FIXTURE';
}

// Runtime memory registry of simulated new notices injected via the admin test bench in fixture mode
const runtimeInjectedNoticesByBoard: Record<string, BoardSeedNotice[]> = {};

export function injectFixtureNoticeForBoard(boardId: string, notice: BoardSeedNotice): void {
  if (!runtimeInjectedNoticesByBoard[boardId]) {
    runtimeInjectedNoticesByBoard[boardId] = [];
  }
  runtimeInjectedNoticesByBoard[boardId].unshift(notice);
}

export function clearInjectedFixtureNotices(): void {
  for (const key of Object.keys(runtimeInjectedNoticesByBoard)) {
    delete runtimeInjectedNoticesByBoard[key];
  }
}

export interface FetchBoardOptions {
  useFixtures?: boolean;
  fixtureOverrides?: Record<
    string,
    { status?: number; body?: string; contentType?: string; delayMs?: number; throwTimeout?: boolean }
  >;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sharedLiveFetchCache?: Map<string, Promise<FetchBoardResult>>;
  env?: Record<string, string | undefined>;
}

/**
 * Fetches the official unified RRB portal (https://rrb.indianrailways.gov.in/) with SSRF protection,
 * legacy regional domain blocking, bounded timeouts, exponential backoff with jitter, and HTTP 429 compliance.
 */
export async function fetchBoardSource(
  board: BoardConfig,
  options?: FetchBoardOptions
): Promise<FetchBoardResult> {
  const startMs = Date.now();
  const targetUrl = board.noticesUrl || board.sourceUrl;

  // 1. SSRF & unified portal domain allowlist check (blocks all retired regional RRB sites)
  const urlValidation = isApprovedOfficialUrl(targetUrl);
  if (!urlValidation.allowed) {
    return {
      fetchResult: 'SSRF_BLOCKED',
      httpStatus: null,
      redirectDestination: null,
      contentType: null,
      responseSizeBytes: 0,
      durationMs: Date.now() - startMs,
      body: '',
      errorCategory: 'SSRF_DOMAIN_REJECTED',
      diagnosticMessage: urlValidation.reason || 'Blocked unapproved domain.',
      dataSourceMode: options?.useFixtures ? 'DETERMINISTIC_FIXTURE' : 'LIVE_NETWORK',
    };
  }

  // 2. Deterministic fixture mode or explicit test override
  const override = options?.fixtureOverrides?.[board.boardId];
  if (override) {
    if (override.delayMs) {
      await new Promise((r) => setTimeout(r, override.delayMs));
    }
    if (override.throwTimeout) {
      return {
        fetchResult: 'TIMEOUT',
        httpStatus: null,
        redirectDestination: null,
        contentType: null,
        responseSizeBytes: 0,
        durationMs: Date.now() - startMs,
        body: '',
        errorCategory: 'REQUEST_TIMEOUT',
        diagnosticMessage: `Request to ${targetUrl} timed out after configured threshold.`,
        dataSourceMode: 'DETERMINISTIC_FIXTURE',
      };
    }
    const status = override.status ?? 200;
    const body =
      override.body ??
      buildOfficialBoardHtmlFixture(board.boardId, runtimeInjectedNoticesByBoard[board.boardId] || []);
    const contentType = override.contentType ?? 'text/html; charset=utf-8';
    if (status >= 400) {
      return {
        fetchResult: 'HTTP_ERROR',
        httpStatus: status,
        redirectDestination: null,
        contentType,
        responseSizeBytes: Buffer.byteLength(body, 'utf8'),
        durationMs: Date.now() - startMs,
        body: '',
        errorCategory: `HTTP_${status}`,
        diagnosticMessage: `Upstream official portal returned HTTP ${status}.`,
        dataSourceMode: 'DETERMINISTIC_FIXTURE',
      };
    }
    return {
      fetchResult: 'SUCCESS',
      httpStatus: status,
      redirectDestination: null,
      contentType,
      responseSizeBytes: Buffer.byteLength(body, 'utf8'),
      durationMs: Date.now() - startMs,
      body,
      errorCategory: null,
      diagnosticMessage: 'Fetched from deterministic test fixture.',
      dataSourceMode: 'DETERMINISTIC_FIXTURE',
    };
  }

  const effectiveUseFixtures =
    options?.useFixtures !== undefined
      ? Boolean(options.useFixtures)
      : options?.fetchImpl
        ? false
        : process.env.USE_FIXTURES === 'true';
  if (effectiveUseFixtures) {
    const html = buildOfficialBoardHtmlFixture(
      board.boardId,
      runtimeInjectedNoticesByBoard[board.boardId] || []
    );
    return {
      fetchResult: 'SUCCESS',
      httpStatus: 200,
      redirectDestination: null,
      contentType: 'text/html; charset=utf-8',
      responseSizeBytes: Buffer.byteLength(html, 'utf8'),
      durationMs: Math.max(4, Date.now() - startMs),
      body: html,
      errorCategory: null,
      diagnosticMessage: 'Fetched verified HTML structure via deterministic fixture.',
      dataSourceMode: 'DETERMINISTIC_FIXTURE',
    };
  }

  // If a shared in-cycle live fetch cache is active for the unified portal URL, reuse it
  if (options?.sharedLiveFetchCache) {
    const cachedPromise = options.sharedLiveFetchCache.get(targetUrl);
    if (cachedPromise) {
      return cachedPromise;
    }
    const livePromise = executeLiveUnifiedPortalFetch(targetUrl, startMs, options);
    options.sharedLiveFetchCache.set(targetUrl, livePromise);
    return livePromise;
  }

  return executeLiveUnifiedPortalFetch(targetUrl, startMs, options);
}

async function executeLiveUnifiedPortalFetch(
  targetUrl: string,
  startMs: number,
  options?: FetchBoardOptions
): Promise<FetchBoardResult> {
  // 3. Live network fetch with retries, exponential backoff + jitter, redirect validation, and optional mirror/relay support
  const fetchImpl = options?.fetchImpl || fetch;
  const rawTimeout =
    options?.timeoutMs ?? Number(options?.env?.SCRAPER_REQUEST_TIMEOUT_MS ?? process.env.SCRAPER_REQUEST_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 10000;
  const rawRetries =
    options?.maxRetries ?? Number(options?.env?.SCRAPER_MAX_RETRIES ?? process.env.SCRAPER_MAX_RETRIES);
  const maxRetries = Number.isFinite(rawRetries) && rawRetries >= 0 ? Math.floor(rawRetries) : 2;
  const configuredMirrorUrl = (
    options?.env?.RRB_PORTAL_MIRROR_URL ||
    options?.env?.RRB_PORTAL_PROXY_URL ||
    process.env.RRB_PORTAL_MIRROR_URL ||
    process.env.RRB_PORTAL_PROXY_URL ||
    ''
  ).trim();
  const configuredMirrorAuthToken = (
    options?.env?.RRB_PORTAL_MIRROR_AUTH_TOKEN ||
    process.env.RRB_PORTAL_MIRROR_AUTH_TOKEN ||
    ''
  ).trim();

  let lastErrorMsg = 'Unknown fetch failure';
  let lastStatus: number | null = null;
  let wasTimeout = false;

  const candidateUrls = [targetUrl];
  if (configuredMirrorUrl && configuredMirrorUrl.startsWith('https://')) {
    candidateUrls.push(configuredMirrorUrl);
  }

  for (const currentUrl of candidateUrls) {
    const isMirrorAttempt = currentUrl !== targetUrl;
    const retriesForUrl = isMirrorAttempt ? 1 : maxRetries;

    for (let attempt = 0; attempt <= retriesForUrl; attempt++) {
      if (attempt > 0) {
        const backoffMs =
          Math.min(2000, 250 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 120);
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const requestHeaders: Record<string, string> = {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
          'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Upgrade-Insecure-Requests': '1',
        };
        if (isMirrorAttempt && configuredMirrorAuthToken) {
          requestHeaders['X-Relay-Auth'] = configuredMirrorAuthToken;
        }

        const res = await fetchImpl(currentUrl, {
          method: 'GET',
          headers: requestHeaders,
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timer);
        lastStatus = res.status;

        // Validate redirect destination if URL changed on direct target
        let redirectDest: string | null = null;
        if (!isMirrorAttempt && res.url && res.url !== targetUrl) {
          redirectDest = res.url;
          const redirectCheck = isApprovedOfficialUrl(res.url);
          if (!redirectCheck.allowed) {
            return {
              fetchResult: 'SSRF_BLOCKED',
              httpStatus: res.status,
              redirectDestination: res.url,
              contentType: res.headers.get('content-type'),
              responseSizeBytes: 0,
              durationMs: Date.now() - startMs,
              body: '',
              errorCategory: 'UNAPPROVED_REDIRECT_DOMAIN',
              diagnosticMessage: `Redirected to unapproved domain: ${res.url}`,
              dataSourceMode: 'LIVE_NETWORK',
            };
          }
        }

        if (res.status === 429) {
          const retryAfterHeader = res.headers.get('retry-after');
          const retrySecs = retryAfterHeader ? Math.min(5, Number(retryAfterHeader) || 1) : 1;
          lastErrorMsg = `HTTP 429 Too Many Requests (Retry-After: ${retrySecs}s)`;
          if (attempt < retriesForUrl) {
            await new Promise((r) => setTimeout(r, retrySecs * 1000));
            continue;
          }
        }

        if (res.status >= 500) {
          lastErrorMsg = `Upstream server error HTTP ${res.status}`;
          if (attempt < retriesForUrl) continue;
          if (!isMirrorAttempt && candidateUrls.length > 1) break;
          return {
            fetchResult: 'HTTP_ERROR',
            httpStatus: res.status,
            redirectDestination: redirectDest,
            contentType: res.headers.get('content-type'),
            responseSizeBytes: 0,
            durationMs: Date.now() - startMs,
            body: '',
            errorCategory: `HTTP_${res.status}`,
            diagnosticMessage: lastErrorMsg,
            dataSourceMode: 'LIVE_NETWORK',
          };
        }

        if (!res.ok) {
          lastErrorMsg = `Upstream returned HTTP ${res.status}.`;
          if (!isMirrorAttempt && candidateUrls.length > 1) break;
          return {
            fetchResult: 'HTTP_ERROR',
            httpStatus: res.status,
            redirectDestination: redirectDest,
            contentType: res.headers.get('content-type'),
            responseSizeBytes: 0,
            durationMs: Date.now() - startMs,
            body: '',
            errorCategory: `HTTP_${res.status}`,
            diagnosticMessage: lastErrorMsg,
            dataSourceMode: 'LIVE_NETWORK',
          };
        }

        const contentType = res.headers.get('content-type') || 'text/html';
        const body = await res.text();
        return {
          fetchResult: 'SUCCESS',
          httpStatus: res.status,
          redirectDestination: redirectDest,
          contentType,
          responseSizeBytes: Buffer.byteLength(body, 'utf8'),
          durationMs: Date.now() - startMs,
          body,
          errorCategory: null,
          diagnosticMessage: isMirrorAttempt
            ? 'Live HTTP 200 fetch succeeded via configured relay mirror.'
            : 'Live HTTP 200 fetch succeeded.',
          dataSourceMode: 'LIVE_NETWORK',
        };
      } catch (err) {
        clearTimeout(timer);
        const errorObj = err as Error & {
          cause?: {
            name?: string;
            code?: string;
            message?: string;
          };
        };
        const msg = errorObj.message || 'Fetch error';
        const causeCode = errorObj.cause?.code || '';
        const causeMsg = errorObj.cause?.message || '';
        const combinedErrorText = `${errorObj.name || ''} ${msg} ${causeCode} ${causeMsg}`;

        if (
          errorObj.name === 'AbortError' ||
          causeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
          causeCode === 'ETIMEDOUT' ||
          /abort|timed?\s*out|connect\s*timeout/i.test(combinedErrorText)
        ) {
          wasTimeout = true;
          const detail = causeCode
            ? `${causeCode}${causeMsg ? `: ${causeMsg}` : ''}`
            : `aborted after ${timeoutMs}ms`;
          const mirrorHint = configuredMirrorUrl
            ? `Configured relay mirror (${configuredMirrorUrl}) also failed.`
            : 'No RRB_PORTAL_MIRROR_URL relay configured; configure an India-hosted HTTPS relay or self-hosted India runner.';
          lastErrorMsg = `Connection to ${currentUrl} timed out (${detail}; CRIS/NIC firewall 103.110.246.98:443 drops TCP SYN from non-Indian cloud datacenter IPs). ${mirrorHint}`;
        } else {
          const causeSuffix =
            causeCode || causeMsg
              ? ` (${[causeCode, causeMsg].filter(Boolean).join(': ')})`
              : '';
          lastErrorMsg = `${msg}${causeSuffix}`;
        }
      }
    }
  }

  return {
    fetchResult: wasTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    httpStatus: lastStatus,
    redirectDestination: null,
    contentType: null,
    responseSizeBytes: 0,
    durationMs: Date.now() - startMs,
    body: '',
    errorCategory: wasTimeout ? 'FETCH_TIMEOUT' : 'NETWORK_UNREACHABLE',
    diagnosticMessage: lastErrorMsg,
    dataSourceMode: 'LIVE_NETWORK',
  };
}

/**
 * Evaluates a single board for the All-Zones or Per-Zone Test system without mutating production delivery state.
 */
export async function evaluateZoneForTest(
  board: BoardConfig,
  options?: FetchBoardOptions & { nowIso?: string }
): Promise<ZoneTestReport> {
  const nowIso = options?.nowIso || new Date().toISOString();

  if (!board.enabled) {
    return {
      boardId: board.boardId,
      boardName: board.boardName,
      configuredSourceUrl: board.sourceUrl,
      noticesUrl: board.noticesUrl,
      verdict: 'SKIPPED',
      httpStatus: null,
      fetchResult: 'SUCCESS',
      redirectDestination: null,
      responseContentType: null,
      responseSizeBytes: 0,
      fetchDurationMs: 0,
      parsingResult: 'NOT_RUN',
      rawRowsDetected: 0,
      validNormalizedNotices: 0,
      duplicatesFound: 0,
      newestValidPublicationDate: null,
      latestParsedNoticeTitle: null,
      officialDetailUrl: null,
      attachmentUrl: null,
      dateParsingConfidence: 'NONE',
      paginationChecked: false,
      unexpectedPageStructure: false,
      errorCategory: null,
      diagnosticMessage: 'Board is disabled in configuration.',
      dataSourceMode: options?.useFixtures ? 'DETERMINISTIC_FIXTURE' : 'LIVE_NETWORK',
      testedAt: nowIso,
      sampleNotices: [],
    };
  }

  const fetched = await fetchBoardSource(board, options);
  if (fetched.fetchResult !== 'SUCCESS') {
    const verdict: ZoneTestVerdict =
      fetched.fetchResult === 'SSRF_BLOCKED' ? 'BLOCKED' : 'FAIL';
    return {
      boardId: board.boardId,
      boardName: board.boardName,
      configuredSourceUrl: board.sourceUrl,
      noticesUrl: board.noticesUrl,
      verdict,
      httpStatus: fetched.httpStatus,
      fetchResult: fetched.fetchResult,
      redirectDestination: fetched.redirectDestination,
      responseContentType: fetched.contentType,
      responseSizeBytes: fetched.responseSizeBytes,
      fetchDurationMs: fetched.durationMs,
      parsingResult: 'NOT_RUN',
      rawRowsDetected: 0,
      validNormalizedNotices: 0,
      duplicatesFound: 0,
      newestValidPublicationDate: null,
      latestParsedNoticeTitle: null,
      officialDetailUrl: null,
      attachmentUrl: null,
      dateParsingConfidence: 'NONE',
      paginationChecked: false,
      unexpectedPageStructure: false,
      errorCategory: fetched.errorCategory,
      diagnosticMessage: fetched.diagnosticMessage,
      dataSourceMode: fetched.dataSourceMode,
      testedAt: nowIso,
      sampleNotices: [],
    };
  }

  const parsed = parseBoardPageContent(
    fetched.body,
    fetched.contentType,
    board,
    nowIso
  );

  if (parsed.parsingResult === 'CHALLENGE_OR_BLOCK_PAGE') {
    return {
      boardId: board.boardId,
      boardName: board.boardName,
      configuredSourceUrl: board.sourceUrl,
      noticesUrl: board.noticesUrl,
      verdict: 'BLOCKED',
      httpStatus: fetched.httpStatus,
      fetchResult: fetched.fetchResult,
      redirectDestination: fetched.redirectDestination,
      responseContentType: fetched.contentType,
      responseSizeBytes: fetched.responseSizeBytes,
      fetchDurationMs: fetched.durationMs,
      parsingResult: parsed.parsingResult,
      rawRowsDetected: 0,
      validNormalizedNotices: 0,
      duplicatesFound: 0,
      newestValidPublicationDate: null,
      latestParsedNoticeTitle: null,
      officialDetailUrl: null,
      attachmentUrl: null,
      dateParsingConfidence: 'NONE',
      paginationChecked: parsed.paginationChecked,
      unexpectedPageStructure: true,
      errorCategory: parsed.errorCategory,
      diagnosticMessage: parsed.diagnosticMessage,
      dataSourceMode: fetched.dataSourceMode,
      testedAt: nowIso,
      sampleNotices: [],
    };
  }

  if (parsed.parsingResult !== 'VALID' || parsed.validNotices.length === 0) {
    return {
      boardId: board.boardId,
      boardName: board.boardName,
      configuredSourceUrl: board.sourceUrl,
      noticesUrl: board.noticesUrl,
      verdict: 'FAIL',
      httpStatus: fetched.httpStatus,
      fetchResult: fetched.fetchResult,
      redirectDestination: fetched.redirectDestination,
      responseContentType: fetched.contentType,
      responseSizeBytes: fetched.responseSizeBytes,
      fetchDurationMs: fetched.durationMs,
      parsingResult: parsed.parsingResult,
      rawRowsDetected: parsed.rawRowsDetected,
      validNormalizedNotices: 0,
      duplicatesFound: parsed.duplicatesFound,
      newestValidPublicationDate: null,
      latestParsedNoticeTitle: null,
      officialDetailUrl: null,
      attachmentUrl: null,
      dateParsingConfidence: 'NONE',
      paginationChecked: parsed.paginationChecked,
      unexpectedPageStructure: parsed.unexpectedPageStructure,
      errorCategory: parsed.errorCategory,
      diagnosticMessage: parsed.diagnosticMessage,
      dataSourceMode: fetched.dataSourceMode,
      testedAt: nowIso,
      sampleNotices: [],
    };
  }

  // Sort notices by publicationDate descending (when available) to report newest date & latest notice
  const sortedByDate = [...parsed.validNotices].sort((a, b) => {
    if (a.publicationDate && b.publicationDate) {
      return b.publicationDate.localeCompare(a.publicationDate);
    }
    if (a.publicationDate) return -1;
    if (b.publicationDate) return 1;
    return 0;
  });

  const latest = sortedByDate[0];
  const hasHighOrMedDate = latest.publicationDateConfidence !== 'NONE';
  const verdict: ZoneTestVerdict = hasHighOrMedDate ? 'PASS' : 'PARTIAL';

  return {
    boardId: board.boardId,
    boardName: board.boardName,
    configuredSourceUrl: board.sourceUrl,
    noticesUrl: board.noticesUrl,
    verdict,
    httpStatus: fetched.httpStatus,
    fetchResult: fetched.fetchResult,
    redirectDestination: fetched.redirectDestination,
    responseContentType: fetched.contentType,
    responseSizeBytes: fetched.responseSizeBytes,
    fetchDurationMs: fetched.durationMs,
    parsingResult: parsed.parsingResult,
    rawRowsDetected: parsed.rawRowsDetected,
    validNormalizedNotices: parsed.validNotices.length,
    duplicatesFound: parsed.duplicatesFound,
    newestValidPublicationDate: latest.publicationDate,
    latestParsedNoticeTitle: latest.title,
    officialDetailUrl: latest.officialNoticeUrl,
    attachmentUrl: latest.attachmentUrls[0] || null,
    dateParsingConfidence: latest.publicationDateConfidence,
    paginationChecked: parsed.paginationChecked,
    unexpectedPageStructure: parsed.unexpectedPageStructure,
    errorCategory: hasHighOrMedDate ? null : 'MISSING_PUBLICATION_DATE',
    diagnosticMessage: parsed.diagnosticMessage,
    dataSourceMode: fetched.dataSourceMode,
    testedAt: nowIso,
    sampleNotices: sortedByDate.slice(0, 5).map((n) => ({
      noticeId: n.noticeId,
      title: n.title,
      publicationDate: n.publicationDate,
      category: n.category,
      officialNoticeUrl: n.officialNoticeUrl,
      attachmentUrls: n.attachmentUrls,
      fingerprint: n.fingerprint,
    })),
  };
}

/**
 * Runs the All-Zones Test across all 22 configured boards with bounded concurrency.
 * Never marks any notice as delivered in production state.
 */
export async function executeAllZonesTest(options?: {
  useFixtures?: boolean;
  sendTelegramTestSummary?: boolean;
  fixtureOverrides?: FetchBoardOptions['fixtureOverrides'];
  fetchImpl?: typeof fetch;
  telegramFetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<AllZonesTestSummary> {
  const startMs = Date.now();
  const runId = `test_all_${startMs}`;
  const executedAt = new Date(startMs).toISOString();
  const useFixtures = options?.useFixtures ?? (options?.fetchImpl ? false : true);

  const concurrency = Math.max(1, Number(process.env.SCRAPER_CONCURRENCY) || 6);
  const reports: ZoneTestReport[] = [];
  const sharedLiveFetchCache = new Map<string, Promise<FetchBoardResult>>();

  for (let i = 0; i < VERIFIED_BOARD_CONFIGS.length; i += concurrency) {
    const batch = VERIFIED_BOARD_CONFIGS.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((board) =>
        evaluateZoneForTest(board, {
          useFixtures,
          fixtureOverrides: options?.fixtureOverrides,
          fetchImpl: options?.fetchImpl,
          nowIso: executedAt,
          timeoutMs: 3500,
          maxRetries: 0,
          sharedLiveFetchCache,
        })
      )
    );
    reports.push(...batchResults);
  }

  const counts: AllZonesTestSummary['counts'] = {
    PASS: 0,
    PARTIAL: 0,
    FAIL: 0,
    SKIPPED: 0,
    BLOCKED: 0,
  };
  for (const r of reports) {
    counts[r.verdict] += 1;
  }

  const summary: AllZonesTestSummary = {
    runId,
    executedAt,
    executedAtIST: formatUtcToIstDisplay(executedAt),
    dataSourceMode: useFixtures ? 'DETERMINISTIC_FIXTURE' : 'LIVE_NETWORK',
    durationMs: Date.now() - startMs,
    totalBoardsConfigured: VERIFIED_BOARD_CONFIGS.length,
    totalTested: reports.filter((r) => r.verdict !== 'SKIPPED').length,
    counts,
    telegramSummarySent: false,
    telegramMessageId: null,
    reports,
  };

  if (options?.sendTelegramTestSummary) {
    const testMsgHtml = formatAllZonesTestSummaryTelegram(summary);
    const tgOutcome = await sendTelegramHtmlMessage(testMsgHtml, {
      env: options?.env,
      fetchImpl: options?.telegramFetchImpl || options?.fetchImpl,
    });
    summary.telegramSummarySent = tgOutcome.status === 'sent';
    summary.telegramMessageId = tgOutcome.messageId;
  }

  return summary;
}

export interface BootstrapRunResult {
  runId: string;
  status: 'SUCCESS' | 'PARTIAL_INCOMPLETE' | 'FAILED' | 'LOCKED';
  initialized: boolean;
  baselineCompletedAt: string | null;
  boardsTotal: number;
  boardsBaselined: number;
  boardsFailed: number;
  totalBaselineNoticesRecorded: number;
  individualTelegramAlertsSent: 0;
  failedBoardIds: string[];
  message: string;
  state: MonitorState;
}

/**
 * Section 7: Initial Baseline Bootstrap — Absolutely Zero Historical Alerts.
 * Marks baseline complete ONLY when all enabled boards have been successfully fetched, parsed, and persisted.
 */
export async function executeBootstrapBaseline(
  store: StateStoreAdapter,
  options?: FetchBoardOptions & {
    nowIso?: string;
    runId?: string;
    boardSubset?: string[];
  }
): Promise<BootstrapRunResult> {
  const startMs = Date.now();
  const nowIso = options?.nowIso || new Date(startMs).toISOString();
  const runId = options?.runId || `bootstrap_${startMs}`;

  let lockInfo: Awaited<ReturnType<typeof acquireDurableLock>>;
  try {
    lockInfo = await acquireDurableLock(store, runId, 'bootstrap', 120_000, startMs);
  } catch (err) {
    const fallbackState = createInitialMonitorState();
    fallbackState.metrics.githubStateReadFailures += 1;
    return {
      runId,
      status: 'FAILED',
      initialized: false,
      baselineCompletedAt: null,
      boardsTotal: VERIFIED_BOARD_CONFIGS.length,
      boardsBaselined: 0,
      boardsFailed: VERIFIED_BOARD_CONFIGS.length,
      totalBaselineNoticesRecorded: 0,
      individualTelegramAlertsSent: 0,
      failedBoardIds: VERIFIED_BOARD_CONFIGS.map((b) => b.boardId),
      message: `Failed to acquire durable state lock: ${(err as Error).message}`,
      state: fallbackState,
    };
  }

  if (!lockInfo.acquired) {
    return {
      runId,
      status: 'LOCKED',
      initialized: lockInfo.envelope.state.initialized,
      baselineCompletedAt: lockInfo.envelope.state.baselineCompletedAt,
      boardsTotal: VERIFIED_BOARD_CONFIGS.length,
      boardsBaselined: 0,
      boardsFailed: 0,
      totalBaselineNoticesRecorded: Object.keys(lockInfo.envelope.state.knownNotices).length,
      individualTelegramAlertsSent: 0,
      failedBoardIds: [],
      message: lockInfo.reason || 'Another bootstrap or scan holds the durable lock.',
      state: lockInfo.envelope.state,
    };
  }

  const state = lockInfo.envelope.state;
  let currentSha = lockInfo.envelope.sha;
  state.lastAttemptedRunAt = nowIso;
  state.lastRunId = runId;
  state.metrics.totalRuns += 1;

  const enabledBoards = VERIFIED_BOARD_CONFIGS.filter(
    (b) => b.enabled && (!options?.boardSubset || options.boardSubset.includes(b.boardId))
  );

  let boardsSucceededInRun = 0;
  const failedBoardIds: string[] = [];
  let noticesRecordedInRun = 0;
  const sharedLiveFetchCache = new Map<string, Promise<FetchBoardResult>>();

  for (const board of enabledBoards) {
    const bStatus = state.boardStatuses[board.boardId] || {
      boardId: board.boardId,
      boardName: board.boardName,
      baselined: false,
      baselineCompletedAt: null,
      lastAttemptedFetchAt: nowIso,
      lastSuccessfulFetchAt: null,
      lastHttpStatus: null,
      consecutiveFetchFailures: 0,
      consecutiveParserFailures: 0,
      lastDiscoveredCount: 0,
      lastValidNoticeCount: 0,
      lastNewestPublicationDate: null,
      lastErrorCategory: null,
      lastErrorMessage: null,
      parserVersion: board.parserVersion,
    };
    bStatus.lastAttemptedFetchAt = nowIso;

    const fetched = await fetchBoardSource(board, { ...options, sharedLiveFetchCache });
    bStatus.lastHttpStatus = fetched.httpStatus;

    if (fetched.fetchResult !== 'SUCCESS') {
      bStatus.consecutiveFetchFailures += 1;
      bStatus.lastErrorCategory = fetched.errorCategory;
      bStatus.lastErrorMessage = fetched.diagnosticMessage;
      state.boardStatuses[board.boardId] = bStatus;
      failedBoardIds.push(board.boardId);
      appendErrorRecord(state, {
        runId,
        boardId: board.boardId,
        stage: 'FETCH',
        category: fetched.errorCategory || 'FETCH_FAILED',
        message: fetched.diagnosticMessage,
        timestamp: nowIso,
      });
      continue;
    }

    const parsed = parseBoardPageContent(
      fetched.body,
      fetched.contentType,
      board,
      nowIso
    );

    if (parsed.parsingResult !== 'VALID' || parsed.validNotices.length === 0) {
      bStatus.consecutiveParserFailures += 1;
      bStatus.lastErrorCategory = parsed.errorCategory;
      bStatus.lastErrorMessage = parsed.diagnosticMessage;
      state.boardStatuses[board.boardId] = bStatus;
      failedBoardIds.push(board.boardId);
      appendErrorRecord(state, {
        runId,
        boardId: board.boardId,
        stage: 'PARSE',
        category: parsed.errorCategory || 'PARSE_FAILED',
        message: parsed.diagnosticMessage,
        timestamp: nowIso,
      });
      continue;
    }

    // Record all discovered notices strictly as BASELINED_INITIAL with suppressed_baseline status.
    // NEVER queue or send individual historical notices during baseline initialization!
    let newestDate: string | null = state.lastSuccessfulNoticeDatesByBoard[board.boardId] || null;
    for (const notice of parsed.validNotices) {
      const existing = state.knownNotices[notice.noticeId];
      state.knownNotices[notice.noticeId] = {
        ...notice,
        firstSeenAt: existing?.firstSeenAt || nowIso,
        lastSeenAt: nowIso,
        lastObservedAt: nowIso,
        baselineStatus: 'BASELINED_INITIAL',
        deliveryStatus: 'suppressed_baseline',
        deliveredAt: null,
      };
      if (!state.deliveredNoticeIds.includes(notice.noticeId)) {
        state.deliveredNoticeIds.push(notice.noticeId);
      }
      if (!state.deliveredFingerprints.includes(notice.fingerprint)) {
        state.deliveredFingerprints.push(notice.fingerprint);
      }
      if (notice.publicationDate && (!newestDate || notice.publicationDate > newestDate)) {
        newestDate = notice.publicationDate;
      }
      noticesRecordedInRun += 1;
    }

    if (newestDate) {
      state.lastSuccessfulNoticeDatesByBoard[board.boardId] = newestDate;
      bStatus.lastNewestPublicationDate = newestDate;
    }

    bStatus.baselined = true;
    bStatus.baselineCompletedAt = bStatus.baselineCompletedAt || nowIso;
    bStatus.lastSuccessfulFetchAt = nowIso;
    bStatus.consecutiveFetchFailures = 0;
    bStatus.consecutiveParserFailures = 0;
    bStatus.lastDiscoveredCount = parsed.rawRowsDetected;
    bStatus.lastValidNoticeCount = parsed.validNotices.length;
    bStatus.lastErrorCategory = null;
    bStatus.lastErrorMessage = null;
    state.boardStatuses[board.boardId] = bStatus;
    boardsSucceededInRun += 1;
  }

  state.metrics.totalValidNoticesFound += noticesRecordedInRun;

  // Verify whether ALL enabled boards are now baselined
  const allEnabledBoards = VERIFIED_BOARD_CONFIGS.filter((b) => b.enabled);
  const totalBaselinedCount = allEnabledBoards.filter(
    (b) => state.boardStatuses[b.boardId]?.baselined === true
  ).length;
  const allBoardsAccountedFor =
    totalBaselinedCount === allEnabledBoards.length && failedBoardIds.length === 0;

  if (allBoardsAccountedFor) {
    state.initialized = true;
    state.baselineCompletedAt = state.baselineCompletedAt || nowIso;
    state.lastSuccessfulRunAt = nowIso;
    state.lastRunStatus = 'SUCCESS';
    state.resumableScanQueue = null;
  } else {
    state.initialized = false;
    state.baselineCompletedAt = null;
    state.lastRunStatus = boardsSucceededInRun > 0 ? 'PARTIAL_FAILURE' : 'FAILED';
    state.resumableScanQueue = {
      active: true,
      cycleId: runId,
      startedAt: nowIso,
      pendingBoardIds: failedBoardIds,
      completedBoardIds: allEnabledBoards
        .filter((b) => state.boardStatuses[b.boardId]?.baselined)
        .map((b) => b.boardId),
      failedBoardIds,
      mode: 'baseline',
    };
  }

  const historyEntry: RunHistoryEntry = {
    runId,
    mode: 'bootstrap',
    startedAt: nowIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    status: allBoardsAccountedFor ? 'SUCCESS' : 'PARTIAL_FAILURE',
    boardsScanned: enabledBoards.length,
    boardsSucceeded: boardsSucceededInRun,
    boardsFailed: failedBoardIds.length,
    noticesFound: noticesRecordedInRun,
    newNoticesEligible: 0,
    messagesDelivered: 0,
    messagesFailed: 0,
    messagesUncertain: 0,
    summary: allBoardsAccountedFor
      ? `Baseline complete across all ${allEnabledBoards.length} boards (${Object.keys(state.knownNotices).length} historical notices fingerprinted, 0 Telegram alerts sent).`
      : `Incomplete baseline: ${totalBaselinedCount}/${allEnabledBoards.length} boards baselined (${failedBoardIds.length} failed). Production alerts remain disabled.`,
  };
  state.recentRunHistory = [historyEntry, ...state.recentRunHistory].slice(0, 50);

  try {
    const persisted = await releaseDurableLock(
      store,
      state,
      currentSha,
      runId,
      `feat(baseline): persist baseline state (${totalBaselinedCount}/${allEnabledBoards.length} boards)`
    );
    currentSha = persisted.sha;
    return {
      runId,
      status: allBoardsAccountedFor ? 'SUCCESS' : 'PARTIAL_INCOMPLETE',
      initialized: persisted.state.initialized,
      baselineCompletedAt: persisted.state.baselineCompletedAt,
      boardsTotal: allEnabledBoards.length,
      boardsBaselined: totalBaselinedCount,
      boardsFailed: failedBoardIds.length,
      totalBaselineNoticesRecorded: Object.keys(persisted.state.knownNotices).length,
      individualTelegramAlertsSent: 0,
      failedBoardIds,
      message: historyEntry.summary,
      state: persisted.state,
    };
  } catch (writeErr) {
    // State write failed: must NOT mark baseline complete!
    state.initialized = false;
    state.baselineCompletedAt = null;
    state.metrics.githubStateWriteFailures += 1;
    return {
      runId,
      status: 'FAILED',
      initialized: false,
      baselineCompletedAt: null,
      boardsTotal: allEnabledBoards.length,
      boardsBaselined: totalBaselinedCount,
      boardsFailed: failedBoardIds.length,
      totalBaselineNoticesRecorded: 0,
      individualTelegramAlertsSent: 0,
      failedBoardIds,
      message: `Baseline state write failed (${(writeErr as Error).message}); baseline was NOT marked complete.`,
      state,
    };
  }
}

export interface CronMonitorRunOptions extends FetchBoardOptions {
  mode?: 'production' | 'dry_run';
  executionBudgetMs?: number;
  maxBoardsPerBatch?: number;
  olderPublicationDatePolicy?: 'quarantine' | 'allow_if_recent' | 'suppress';
  maxNoticeAgeDays?: number;
  maxAcceptableAgeDays?: number;
  filterKeywords?: string[] | string;
  maxNotificationsPerRun?: number;
  nowIso?: string;
  runId?: string;
  telegramFetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export interface CronMonitorRunResult {
  runId: string;
  mode: 'production' | 'dry_run';
  status: 'SUCCESS' | 'PARTIAL_BATCH' | 'PARTIAL_FAILURE' | 'FAILED' | 'LOCKED' | 'BASELINE_REQUIRED';
  httpStatusCode: number;
  durationMs: number;
  boardsScanned: number;
  boardsSucceeded: number;
  boardsFailed: number;
  noticesDiscovered: number;
  newNoticesEligible: number;
  revisedNoticesEligible: number;
  quarantinedNotices: number;
  duplicateNoticesSuppressed: number;
  deliveriesSent: number;
  deliveriesFailed: number;
  deliveriesUncertain: number;
  remainingBoardsInQueue: number;
  summary: string;
  eligibleNoticeTitles: string[];
  state: MonitorState;
}

/**
 * Executes a scheduled cron run (`POST /api/cron/run`) or administrative dry run (`POST /api/admin/dry-run`).
 * Respects the 30-second cron-job.org execution timeout via `executionBudgetMs` and resumable batch queues.
 * Fails closed if state cannot be read or written.
 */
export async function executeMonitorRun(
  store: StateStoreAdapter,
  options?: CronMonitorRunOptions
): Promise<CronMonitorRunResult> {
  const startMs = Date.now();
  const nowIso = options?.nowIso || new Date(startMs).toISOString();
  const mode = options?.mode || 'production';
  const runId = options?.runId || `${mode}_${startMs}`;
  const executionBudgetMs =
    options?.executionBudgetMs ?? (Number(process.env.CRON_EXECUTION_BUDGET_MS) || 24_000);
  const maxBoardsPerBatch =
    options?.maxBoardsPerBatch ?? (Number(process.env.CRON_BATCH_SIZE) || 22);
  const olderDatePolicy =
    options?.olderPublicationDatePolicy ||
    (process.env.OLDER_PUBLICATION_DATE_POLICY as 'quarantine' | 'allow_if_recent' | 'suppress') ||
    'quarantine';
  const rawMaxAge =
    options?.maxNoticeAgeDays ??
    options?.maxAcceptableAgeDays ??
    Number(options?.env?.MAX_NOTICE_AGE_DAYS || process.env.MAX_NOTICE_AGE_DAYS);
  const maxAcceptableAgeDays =
    Number.isFinite(rawMaxAge) && rawMaxAge > 0 ? rawMaxAge : DEFAULT_MAX_NOTICE_AGE_DAYS;
  const filterKeywords = parseConfiguredKeywords(options?.filterKeywords, options?.env);
  const rawMaxNotifs =
    options?.maxNotificationsPerRun ??
    Number(options?.env?.MAX_NOTIFICATIONS_PER_RUN || process.env.MAX_NOTIFICATIONS_PER_RUN);
  const maxNotificationsPerRun =
    Number.isFinite(rawMaxNotifs) && rawMaxNotifs > 0
      ? Math.floor(rawMaxNotifs)
      : DEFAULT_MAX_NOTIFICATIONS_PER_RUN;

  // 1. Acquire durable lock (fail closed if state read or lock write fails)
  let lockInfo: Awaited<ReturnType<typeof acquireDurableLock>>;
  try {
    lockInfo = await acquireDurableLock(store, runId, 'cron_scan', 90_000, startMs);
  } catch (err) {
    const emptyState = createInitialMonitorState();
    emptyState.metrics.githubStateReadFailures += 1;
    return {
      runId,
      mode,
      status: 'FAILED',
      httpStatusCode: 503,
      durationMs: Date.now() - startMs,
      boardsScanned: 0,
      boardsSucceeded: 0,
      boardsFailed: 0,
      noticesDiscovered: 0,
      newNoticesEligible: 0,
      revisedNoticesEligible: 0,
      quarantinedNotices: 0,
      duplicateNoticesSuppressed: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesUncertain: 0,
      remainingBoardsInQueue: 0,
      summary: `Fail-closed: Unable to read or lock persistent state store (${(err as Error).message}). Zero notices sent.`,
      eligibleNoticeTitles: [],
      state: emptyState,
    };
  }

  if (!lockInfo.acquired) {
    return {
      runId,
      mode,
      status: 'LOCKED',
      httpStatusCode: 409,
      durationMs: Date.now() - startMs,
      boardsScanned: 0,
      boardsSucceeded: 0,
      boardsFailed: 0,
      noticesDiscovered: 0,
      newNoticesEligible: 0,
      revisedNoticesEligible: 0,
      quarantinedNotices: 0,
      duplicateNoticesSuppressed: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesUncertain: 0,
      remainingBoardsInQueue: 0,
      summary: lockInfo.reason || 'Concurrent execution rejected by durable lock.',
      eligibleNoticeTitles: [],
      state: lockInfo.envelope.state,
    };
  }

  const state = lockInfo.envelope.state;
  let currentSha = lockInfo.envelope.sha;
  state.lastAttemptedRunAt = nowIso;
  state.lastRunId = runId;
  state.metrics.totalRuns += 1;

  // 2. Verify baseline readiness before allowing production alerts
  if (!state.initialized || !state.baselineCompletedAt) {
    appendErrorRecord(state, {
      runId,
      boardId: null,
      stage: 'STATE_READ',
      category: 'BASELINE_NOT_COMPLETE',
      message: 'Production cron run invoked before initial baseline was completed.',
      timestamp: nowIso,
    });
    await releaseDurableLock(
      store,
      state,
      currentSha,
      runId,
      `chore(cron): reject production scan before baseline (${runId})`
    ).catch(() => null);

    return {
      runId,
      mode,
      status: 'BASELINE_REQUIRED',
      httpStatusCode: 412,
      durationMs: Date.now() - startMs,
      boardsScanned: 0,
      boardsSucceeded: 0,
      boardsFailed: 0,
      noticesDiscovered: 0,
      newNoticesEligible: 0,
      revisedNoticesEligible: 0,
      quarantinedNotices: 0,
      duplicateNoticesSuppressed: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesUncertain: 0,
      remainingBoardsInQueue: VERIFIED_BOARD_CONFIGS.filter((b) => b.enabled).length,
      summary:
        'Baseline initialization is incomplete. Run POST /api/admin/bootstrap to establish the initial baseline before enabling production alerts.',
      eligibleNoticeTitles: [],
      state,
    };
  }

  // 3. Determine board queue (resumable scan queue support for 30s cron budget)
  const allEnabledIds = VERIFIED_BOARD_CONFIGS.filter((b) => b.enabled).map((b) => b.boardId);
  let queue = state.resumableScanQueue;
  if (!queue || !queue.active || queue.pendingBoardIds.length === 0) {
    queue = {
      active: true,
      cycleId: `cycle_${startMs}`,
      startedAt: nowIso,
      pendingBoardIds: [...allEnabledIds],
      completedBoardIds: [],
      failedBoardIds: [],
      mode: mode === 'dry_run' ? 'dry_run' : 'production',
    };
  }

  let boardsScanned = 0;
  let boardsSucceeded = 0;
  let boardsFailed = 0;
  let noticesDiscovered = 0;
  let newNoticesEligible = 0;
  let revisedNoticesEligible = 0;
  let quarantinedNotices = 0;
  let duplicateNoticesSuppressed = 0;
  const eligibleNoticeTitles: string[] = [];
  const seenCrossBoardKeysInCurrentRun = new Set<string>();
  const sharedLiveFetchCache = new Map<string, Promise<FetchBoardResult>>();

  while (queue.pendingBoardIds.length > 0 && boardsScanned < maxBoardsPerBatch) {
    const elapsedMs = Date.now() - startMs;
    if ( boardsScanned > 0 && elapsedMs >= executionBudgetMs) {
      // Safe execution budget reached: stop scanning more boards and persist resumable queue!
      break;
    }

    const nextBoardId = queue.pendingBoardIds.shift()!;
    const board = getBoardById(nextBoardId);
    if (!board) continue;

    boardsScanned += 1;
    const bStatus = state.boardStatuses[board.boardId];
    const boardIsUnbaselined = !bStatus || !bStatus.baselined;
    const boardWasUnbaselinedOrRecovering =
      boardIsUnbaselined ||
      bStatus.consecutiveFetchFailures > 0 ||
      bStatus.consecutiveParserFailures > 0;

    bStatus.lastAttemptedFetchAt = nowIso;
    const fetched = await fetchBoardSource(board, { ...options, sharedLiveFetchCache });
    bStatus.lastHttpStatus = fetched.httpStatus;

    if (fetched.fetchResult !== 'SUCCESS') {
      boardsFailed += 1;
      bStatus.consecutiveFetchFailures += 1;
      bStatus.lastErrorCategory = fetched.errorCategory;
      bStatus.lastErrorMessage = fetched.diagnosticMessage;
      queue.failedBoardIds.push(board.boardId);
      appendErrorRecord(state, {
        runId,
        boardId: board.boardId,
        stage: 'FETCH',
        category: fetched.errorCategory || 'FETCH_ERROR',
        message: fetched.diagnosticMessage,
        timestamp: nowIso,
      });
      continue;
    }

    const parsed = parseBoardPageContent(
      fetched.body,
      fetched.contentType,
      board,
      nowIso
    );

    if (parsed.parsingResult !== 'VALID' || parsed.validNotices.length === 0) {
      boardsFailed += 1;
      bStatus.consecutiveParserFailures += 1;
      bStatus.lastErrorCategory = parsed.errorCategory;
      bStatus.lastErrorMessage = parsed.diagnosticMessage;
      queue.failedBoardIds.push(board.boardId);
      appendErrorRecord(state, {
        runId,
        boardId: board.boardId,
        stage: 'PARSE',
        category: parsed.errorCategory || 'PARSE_ERROR',
        message: parsed.diagnosticMessage,
        timestamp: nowIso,
      });
      continue;
    }

    // Detect suspicious drastic drops in notice count if board previously had >= 3 notices
    if (bStatus.lastValidNoticeCount >= 3 && parsed.validNotices.length === 0) {
      boardsFailed += 1;
      bStatus.consecutiveParserFailures += 1;
      bStatus.lastErrorCategory = 'SUSPICIOUS_COUNT_DROP';
      bStatus.lastErrorMessage = `Notice count dropped from ${bStatus.lastValidNoticeCount} to 0.`;
      queue.failedBoardIds.push(board.boardId);
      continue;
    }

    noticesDiscovered += parsed.validNotices.length;
    duplicateNoticesSuppressed += parsed.duplicatesFound;

    const maxAllowedWatermarkDate = new Date(Date.parse(nowIso) + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    let newestBoardDate = state.lastSuccessfulNoticeDatesByBoard[board.boardId] || null;

    for (const notice of parsed.validNotices) {
      const decision = evaluateNoticeEligibility(notice, state, {
        stateStoreHealthy: true,
        lockOwnedByCurrentRun: true,
        boardIsUnbaselined,
        boardIsRecoveringOrUnbaselined: boardWasUnbaselinedOrRecovering,
        olderPublicationDatePolicy: olderDatePolicy,
        maxAcceptableAgeDays,
        filterKeywords,
        referenceTimeIso: nowIso,
        seenCrossBoardKeysInCurrentRun,
      });

      if (decision.reasonCode === 'SUPPRESSED_CROSS_BOARD_DUPLICATE') {
        duplicateNoticesSuppressed += 1;
      } else if (
        decision.reasonCode === 'QUARANTINED_MISSING_PUBLICATION_DATE' ||
        decision.reasonCode === 'QUARANTINED_OLDER_PUBLICATION_DATE'
      ) {
        quarantinedNotices += 1;
      }

      if (decision.eligibleForAlert) {
        if (decision.reasonCode === 'ELIGIBLE_DOCUMENT_REVISION') {
          revisedNoticesEligible += 1;
        } else {
          newNoticesEligible += 1;
        }
        eligibleNoticeTitles.push(`[${board.boardName}] ${decision.updatedNotice.title}`);

        if (mode === 'production') {
          state.knownNotices[decision.updatedNotice.noticeId] = decision.updatedNotice;
          const qItem = createDeliveryQueueItem(decision.updatedNotice, nowIso);
          state.pendingDeliveries[qItem.deliveryId] = qItem;
        }
      } else if (mode === 'production') {
        // Persist updated observation timestamps or baseline/quarantine metadata
        state.knownNotices[decision.updatedNotice.noticeId] = decision.updatedNotice;
      }

      // Only advance board watermark from verified non-quarantined notices with HIGH/MEDIUM date confidence and non-future dates
      if (
        decision.updatedNotice.deliveryStatus !== 'quarantined' &&
        decision.updatedNotice.publicationDate &&
        (decision.updatedNotice.publicationDateConfidence === 'HIGH' ||
          decision.updatedNotice.publicationDateConfidence === 'MEDIUM') &&
        decision.updatedNotice.publicationDate <= maxAllowedWatermarkDate &&
        (!newestBoardDate || decision.updatedNotice.publicationDate > newestBoardDate)
      ) {
        newestBoardDate = decision.updatedNotice.publicationDate;
      }
    }

    if (mode === 'production') {
      if (newestBoardDate) {
        state.lastSuccessfulNoticeDatesByBoard[board.boardId] = newestBoardDate;
        bStatus.lastNewestPublicationDate = newestBoardDate;
      }
      bStatus.baselined = true;
      bStatus.baselineCompletedAt = bStatus.baselineCompletedAt || nowIso;
      bStatus.lastSuccessfulFetchAt = nowIso;
      bStatus.consecutiveFetchFailures = 0;
      bStatus.consecutiveParserFailures = 0;
      bStatus.lastDiscoveredCount = parsed.rawRowsDetected;
      bStatus.lastValidNoticeCount = parsed.validNotices.length;
      bStatus.lastErrorCategory = null;
      bStatus.lastErrorMessage = null;
    }

    boardsSucceeded += 1;
    queue.completedBoardIds.push(board.boardId);
  }

  state.metrics.totalValidNoticesFound += noticesDiscovered;
  state.metrics.totalNewNoticesDetected += newNoticesEligible + revisedNoticesEligible;

  // Update resumable queue state
  const remainingBoardsInQueue = queue.pendingBoardIds.length;
  if (remainingBoardsInQueue === 0) {
    queue.active = false;
    state.resumableScanQueue = null;
  } else {
    state.resumableScanQueue = queue;
  }

  // 4. If mode === 'dry_run', release lock without mutating production delivery queues or sending Telegram alerts
  if (mode === 'dry_run') {
    const dryRunErrors = state.recentErrors.filter((e) => e.runId === runId);
    const freshEnvelope = await store.readState();
    const cleanState = freshEnvelope.state;
    cleanState.activeLock = null;
    await store.writeState(
      cleanState,
      freshEnvelope.sha,
      `chore(dry-run): release lock after dry-run (${runId})`
    );
    const returnedState: MonitorState = {
      ...cleanState,
      recentErrors: [...dryRunErrors, ...cleanState.recentErrors].slice(0, 50),
    };
    return {
      runId,
      mode: 'dry_run',
      status: boardsFailed === 0 && remainingBoardsInQueue === 0 ? 'SUCCESS' : 'PARTIAL_FAILURE',
      httpStatusCode: 200,
      durationMs: Date.now() - startMs,
      boardsScanned,
      boardsSucceeded,
      boardsFailed,
      noticesDiscovered,
      newNoticesEligible,
      revisedNoticesEligible,
      quarantinedNotices,
      duplicateNoticesSuppressed,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesUncertain: 0,
      remainingBoardsInQueue,
      summary: `Dry run completed: scanned ${boardsScanned} boards, found ${newNoticesEligible} new & ${revisedNoticesEligible} revised eligible notices (0 production mutations or Telegram sends).`,
      eligibleNoticeTitles,
      state: returnedState,
    };
  }

  // 5. Persist pre-delivery state checkpoint (atomic claim before calling Telegram API!)
  // If this state write fails, fail closed and NEVER send any Telegram alert.
  let deliveriesUncertain = 0;
  let claimedForCurrentRun = 0;
  const pendingItems = Object.values(state.pendingDeliveries);
  for (const item of pendingItems) {
    // Never blindly retry an item that was moved to uncertainDeliveries
    if (state.uncertainDeliveries[item.deliveryId]) {
      delete state.pendingDeliveries[item.deliveryId];
      continue;
    }
    // If an item was left in 'sending' state by a previously interrupted/crashed run,
    // quarantine it into uncertainDeliveries rather than blindly resending!
    if (item.status === 'sending' && item.claimedByRunId && item.claimedByRunId !== runId) {
      deliveriesUncertain += 1;
      state.metrics.totalUncertainDeliveries += 1;
      item.status = 'uncertain';
      item.lastError = `Interrupted mid-flight during prior run (${item.claimedByRunId}).`;
      item.reconciliationNotes =
        'Prior execution crashed or timed out after claiming item for sending. Quarantined as UNCERTAIN to prevent duplicate delivery.';
      item.updatedAt = nowIso;
      delete state.pendingDeliveries[item.deliveryId];
      state.uncertainDeliveries[item.deliveryId] = item;
      if (state.knownNotices[item.noticeId]) {
        state.knownNotices[item.noticeId].deliveryStatus = 'uncertain';
      }
      continue;
    }
    if (claimedForCurrentRun >= maxNotificationsPerRun) {
      // Keep remaining pending notices queued in state.pendingDeliveries for subsequent runs without losing them
      continue;
    }
    claimedForCurrentRun += 1;
    item.status = 'sending';
    item.claimedByRunId = runId;
    item.claimedAt = nowIso;
    item.attemptCount += 1;
    item.lastAttemptAt = nowIso;
    item.updatedAt = nowIso;
    if (state.knownNotices[item.noticeId]) {
      state.knownNotices[item.noticeId].deliveryStatus = 'sending';
    }
  }

  try {
    const checkpointEnv = await store.writeState(
      state,
      currentSha,
      `chore(queue): claim ${claimedForCurrentRun} pending deliveries for ${runId}`
    );
    currentSha = checkpointEnv.sha;
  } catch (writeErr) {
    state.metrics.githubStateWriteFailures += 1;
    return {
      runId,
      mode: 'production',
      status: 'FAILED',
      httpStatusCode: 503,
      durationMs: Date.now() - startMs,
      boardsScanned,
      boardsSucceeded,
      boardsFailed,
      noticesDiscovered,
      newNoticesEligible,
      revisedNoticesEligible,
      quarantinedNotices,
      duplicateNoticesSuppressed,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesUncertain,
      remainingBoardsInQueue,
      summary: `Fail-closed: Pre-delivery GitHub state checkpoint failed (${(writeErr as Error).message}). Halted before Telegram dispatch to guarantee zero duplicate alerts.`,
      eligibleNoticeTitles,
      state,
    };
  }

  // 6. Dispatch claimed notices via Telegram Bot API
  let deliveriesSent = 0;
  let deliveriesFailed = 0;

  for (const item of pendingItems) {
    if (item.claimedByRunId !== runId || item.status !== 'sending') continue;

    const formattedChunks = formatProductionNoticeTelegramMessage(item, nowIso);
    const outcome = await sendTelegramHtmlMessage(formattedChunks.join('\n\n'), {
      env: options?.env,
      fetchImpl: options?.telegramFetchImpl || options?.fetchImpl,
    });

    const completedAtIso = new Date().toISOString();
    if (outcome.status === 'sent') {
      deliveriesSent += 1;
      state.metrics.totalTelegramDelivered += 1;
      item.status = 'sent';
      item.telegramMessageId = outcome.messageId;
      item.deliveredAt = completedAtIso;
      item.lastError = null;
      item.updatedAt = completedAtIso;
      delete state.pendingDeliveries[item.deliveryId];
      delete state.failedDeliveries[item.deliveryId];
      if (!state.deliveredNoticeIds.includes(item.noticeId)) {
        state.deliveredNoticeIds.push(item.noticeId);
      }
      if (!state.deliveredFingerprints.includes(item.fingerprint)) {
        state.deliveredFingerprints.push(item.fingerprint);
      }
      const known = state.knownNotices[item.noticeId];
      if (known) {
        known.deliveryStatus = 'sent';
        known.deliveredAt = completedAtIso;
        if (!state.deliveredContentHashes) state.deliveredContentHashes = [];
        if (!state.deliveredContentHashes.includes(known.contentHash)) {
          state.deliveredContentHashes.push(known.contentHash);
        }
        if (!state.deliveredCrossBoardKeys) state.deliveredCrossBoardKeys = [];
        const { crossBoardDocumentKey } = computeNoticeHashes({
          boardId: known.boardId,
          title: known.title,
          canonicalUrl: known.canonicalUrl,
          attachmentUrls: known.attachmentUrls,
          publicationDate: known.publicationDate,
        });
        if (!state.deliveredCrossBoardKeys.includes(crossBoardDocumentKey)) {
          state.deliveredCrossBoardKeys.push(crossBoardDocumentKey);
        }
      }
    } else if (outcome.status === 'uncertain') {
      deliveriesUncertain += 1;
      state.metrics.totalUncertainDeliveries += 1;
      item.status = 'uncertain';
      item.lastError = outcome.diagnosticMessage;
      item.reconciliationNotes =
        'Timeout/drop after sendMessage dispatch. Quarantined in uncertainDeliveries to prevent duplicate resend until manual reconciliation.';
      item.updatedAt = completedAtIso;
      delete state.pendingDeliveries[item.deliveryId];
      state.uncertainDeliveries[item.deliveryId] = item;
      if (state.knownNotices[item.noticeId]) {
        state.knownNotices[item.noticeId].deliveryStatus = 'uncertain';
      }
      appendErrorRecord(state, {
        runId,
        boardId: item.boardId,
        stage: 'TELEGRAM',
        category: outcome.errorCategory || 'UNCERTAIN_DELIVERY',
        message: outcome.diagnosticMessage,
        timestamp: completedAtIso,
      });
    } else {
      deliveriesFailed += 1;
      state.metrics.totalFailedDeliveries += 1;
      item.status = 'failed';
      item.lastError = outcome.diagnosticMessage;
      item.updatedAt = completedAtIso;
      state.failedDeliveries[item.deliveryId] = item;
      if (item.attemptCount >= 3) {
        delete state.pendingDeliveries[item.deliveryId];
      } else {
        item.status = 'pending';
        state.pendingDeliveries[item.deliveryId] = item;
      }
      if (state.knownNotices[item.noticeId]) {
        state.knownNotices[item.noticeId].deliveryStatus = 'failed';
      }
      appendErrorRecord(state, {
        runId,
        boardId: item.boardId,
        stage: 'TELEGRAM',
        category: outcome.errorCategory || 'TELEGRAM_DELIVERY_FAILED',
        message: outcome.diagnosticMessage,
        timestamp: completedAtIso,
      });
    }
  }

  // 7. Determine overall run status & HTTP status code
  let finalStatus: CronMonitorRunResult['status'] = 'SUCCESS';
  let httpStatusCode = 200;

  if (remainingBoardsInQueue > 0) {
    finalStatus = 'PARTIAL_BATCH';
    // Return 206 Partial Content so cron-job.org / callers never mistake a partial batch for a complete scan
    httpStatusCode = 206;
  } else if (boardsFailed > 0 || deliveriesFailed > 0 || deliveriesUncertain > 0) {
    finalStatus = boardsSucceeded > 0 ? 'PARTIAL_FAILURE' : 'FAILED';
    httpStatusCode = 502;
  } else {
    state.lastSuccessfulRunAt = new Date().toISOString();
  }

  state.lastRunStatus =
    finalStatus === 'PARTIAL_BATCH'
      ? 'PARTIAL_BATCH'
      : finalStatus === 'SUCCESS'
        ? 'SUCCESS'
        : finalStatus === 'PARTIAL_FAILURE'
          ? 'PARTIAL_FAILURE'
          : 'FAILED';

  const summary =
    finalStatus === 'PARTIAL_BATCH'
      ? `Bounded batch completed (${boardsScanned} boards scanned, ${remainingBoardsInQueue} remaining in resumable queue).`
      : `Scanned ${boardsScanned} boards (${boardsSucceeded} OK, ${boardsFailed} failed). Eligible new: ${newNoticesEligible}, revised: ${revisedNoticesEligible}, delivered: ${deliveriesSent}.`;

  const historyEntry: RunHistoryEntry = {
    runId,
    mode: 'cron',
    startedAt: nowIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    status: finalStatus === 'SUCCESS' ? 'SUCCESS' : finalStatus === 'PARTIAL_BATCH' ? 'PARTIAL_BATCH' : finalStatus === 'PARTIAL_FAILURE' ? 'PARTIAL_FAILURE' : 'FAILED',
    boardsScanned,
    boardsSucceeded,
    boardsFailed,
    noticesFound: noticesDiscovered,
    newNoticesEligible: newNoticesEligible + revisedNoticesEligible,
    messagesDelivered: deliveriesSent,
    messagesFailed: deliveriesFailed,
    messagesUncertain: deliveriesUncertain,
    summary,
  };
  state.recentRunHistory = [historyEntry, ...state.recentRunHistory].slice(0, 50);

  const finalEnvelope = await releaseDurableLock(
    store,
    state,
    currentSha,
    runId,
    `feat(cron): complete ${runId} (${finalStatus})`
  );

  return {
    runId,
    mode: 'production',
    status: finalStatus,
    httpStatusCode,
    durationMs: Date.now() - startMs,
    boardsScanned,
    boardsSucceeded,
    boardsFailed,
    noticesDiscovered,
    newNoticesEligible,
    revisedNoticesEligible,
    quarantinedNotices,
    duplicateNoticesSuppressed,
    deliveriesSent,
    deliveriesFailed,
    deliveriesUncertain,
    remainingBoardsInQueue,
    summary,
    eligibleNoticeTitles,
    state: finalEnvelope.state,
  };
}

/**
 * Reconciles an uncertain Telegram delivery item (`mark_sent` or `requeue_retry`).
 */
export async function reconcileUncertainDelivery(
  store: StateStoreAdapter,
  deliveryId: string,
  resolution: 'mark_sent' | 'requeue_retry',
  notes?: string
): Promise<MonitorState> {
  const env = await store.readState();
  const state = env.state;
  const item = state.uncertainDeliveries[deliveryId];
  if (!item) {
    throw new Error(`Uncertain delivery '${deliveryId}' not found.`);
  }

  const nowIso = new Date().toISOString();
  delete state.uncertainDeliveries[deliveryId];

  if (resolution === 'mark_sent') {
    item.status = 'sent';
    item.deliveredAt = nowIso;
    item.reconciliationNotes = notes || 'Manually confirmed delivered in Telegram channel.';
    item.updatedAt = nowIso;
    state.metrics.totalTelegramDelivered += 1;
    delete state.failedDeliveries[deliveryId];
    if (!state.deliveredNoticeIds.includes(item.noticeId)) {
      state.deliveredNoticeIds.push(item.noticeId);
    }
    if (!state.deliveredFingerprints.includes(item.fingerprint)) {
      state.deliveredFingerprints.push(item.fingerprint);
    }
    const known = state.knownNotices[item.noticeId];
    if (known) {
      known.deliveryStatus = 'sent';
      known.deliveredAt = nowIso;
      if (!state.deliveredContentHashes) state.deliveredContentHashes = [];
      if (!state.deliveredContentHashes.includes(known.contentHash)) {
        state.deliveredContentHashes.push(known.contentHash);
      }
      if (!state.deliveredCrossBoardKeys) state.deliveredCrossBoardKeys = [];
      const { crossBoardDocumentKey } = computeNoticeHashes({
        boardId: known.boardId,
        title: known.title,
        canonicalUrl: known.canonicalUrl,
        attachmentUrls: known.attachmentUrls,
        publicationDate: known.publicationDate,
      });
      if (!state.deliveredCrossBoardKeys.includes(crossBoardDocumentKey)) {
        state.deliveredCrossBoardKeys.push(crossBoardDocumentKey);
      }
    }
  } else {
    item.status = 'pending';
    item.reconciliationNotes = notes || 'Manually requeued after confirming non-delivery.';
    item.updatedAt = nowIso;
    state.pendingDeliveries[deliveryId] = item;
    if (state.knownNotices[item.noticeId]) {
      state.knownNotices[item.noticeId].deliveryStatus = 'pending';
    }
  }

  const updated = await store.writeState(
    state,
    env.sha,
    `fix(reconcile): resolve uncertain delivery ${deliveryId} as ${resolution}`
  );
  return updated.state;
}

function appendErrorRecord(
  state: MonitorState,
  params: Omit<ErrorRecord, 'errorId'>
): void {
  const err: ErrorRecord = {
    errorId: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...params,
  };
  state.recentErrors = [err, ...state.recentErrors].slice(0, 100);
}

export { BOARD_SEED_NOTICES };
