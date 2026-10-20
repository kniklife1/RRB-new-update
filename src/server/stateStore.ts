import fs from 'node:fs/promises';
import path from 'node:path';
import {
  VERIFIED_BOARD_CONFIGS,
  CURRENT_PARSER_VERSION,
  migrateLegacyUrlToUnifiedPortal,
} from './boards.ts';
import { canonicalizeOfficialUrl, computeNoticeHashes } from './parser.ts';
import type {
  BoardRuntimeStatus,
  DeliveryQueueItem,
  DurableLock,
  MonitorState,
  NormalizedNotice,
} from './types.ts';

export const CURRENT_STATE_SCHEMA_VERSION = 2;

export interface StateEnvelope {
  state: MonitorState;
  sha: string | null;
  storageBackend: 'github' | 'local-mirror';
  repositoryInfo: {
    configured: boolean;
    owner: string;
    repo: string;
    branch: string;
    statePath: string;
  };
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  statePath: string;
}

export function getGitHubConfigFromEnv(env: Record<string, string | undefined> = process.env): {
  configured: boolean;
  config: GitHubConfig;
  validationErrors: string[];
} {
  const rawToken = (env.GH_STATE_TOKEN || env.GITHUB_TOKEN || '').trim();
  const repoParts = (env.GITHUB_REPOSITORY || '').trim().split('/');
  const fallbackOwner = repoParts.length === 2 ? repoParts[0].trim() : '';
  const fallbackRepo = repoParts.length === 2 ? repoParts[1].trim() : '';

  const owner = (env.GITHUB_OWNER || fallbackOwner).trim();
  const repo = (env.GITHUB_REPO || fallbackRepo).trim();
  const branch = (env.GITHUB_BRANCH || env.GITHUB_REF_NAME || 'main').trim();
  const statePath = (env.GITHUB_STATE_PATH || 'state/notices.json').trim().replace(/^\/+/, '');

  const validationErrors: string[] = [];
  const isPlaceholder = (val: string) =>
    !val ||
    val.startsWith('YOUR_') ||
    val.startsWith('MY_') ||
    val.startsWith('GENERATE_');

  if (isPlaceholder(rawToken)) validationErrors.push('GITHUB_TOKEN (or GH_STATE_TOKEN) is missing or placeholder');
  if (isPlaceholder(owner)) validationErrors.push('GITHUB_OWNER (or GITHUB_REPOSITORY) is missing or placeholder');
  if (isPlaceholder(repo)) validationErrors.push('GITHUB_REPO (or GITHUB_REPOSITORY) is missing or placeholder');
  if (!/^[a-zA-Z0-9._/-]+$/.test(branch)) validationErrors.push('GITHUB_BRANCH has invalid characters');
  if (statePath.includes('..') || !statePath.endsWith('.json')) {
    validationErrors.push('GITHUB_STATE_PATH must be a safe relative .json path');
  }

  return {
    configured: validationErrors.length === 0,
    config: { token: rawToken, owner, repo, branch, statePath },
    validationErrors,
  };
}

export function createInitialMonitorState(): MonitorState {
  const boardStatuses: Record<string, BoardRuntimeStatus> = {};
  for (const board of VERIFIED_BOARD_CONFIGS) {
    boardStatuses[board.boardId] = {
      boardId: board.boardId,
      boardName: board.boardName,
      baselined: false,
      baselineCompletedAt: null,
      lastAttemptedFetchAt: null,
      lastSuccessfulFetchAt: null,
      lastHttpStatus: null,
      consecutiveFetchFailures: 0,
      consecutiveParserFailures: 0,
      lastDiscoveredCount: 0,
      lastValidNoticeCount: 0,
      lastNewestPublicationDate: null,
      lastErrorCategory: null,
      lastErrorMessage: null,
      parserVersion: CURRENT_PARSER_VERSION,
    };
  }

  return {
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    initialized: false,
    baselineCompletedAt: null,
    lastSuccessfulRunAt: null,
    lastAttemptedRunAt: null,
    lastRunStatus: 'IDLE',
    lastRunId: null,
    activeLock: null,
    resumableScanQueue: null,
    boardStatuses,
    knownNotices: {},
    deliveredNoticeIds: [],
    deliveredFingerprints: [],
    deliveredContentHashes: [],
    deliveredCrossBoardKeys: [],
    pendingDeliveries: {},
    failedDeliveries: {},
    uncertainDeliveries: {},
    recentRunHistory: [],
    recentErrors: [],
    lastSuccessfulNoticeDatesByBoard: {},
    metrics: {
      totalRuns: 0,
      totalValidNoticesFound: 0,
      totalNewNoticesDetected: 0,
      totalTelegramDelivered: 0,
      totalFailedDeliveries: 0,
      totalUncertainDeliveries: 0,
      githubStateReadFailures: 0,
      githubStateWriteFailures: 0,
      githubShaConflictsResolved: 0,
      lockAcquisitionFailures: 0,
      lastOperationalAlertAt: null,
    },
  };
}

/**
 * Validates and migrates older state schemas and retired regional RRB notice URLs
 * onto https://rrb.indianrailways.gov.in/ without losing historical identities or causing duplicate alerts.
 */
export function validateAndMigrateState(raw: unknown): MonitorState {
  if (!raw || typeof raw !== 'object') {
    throw new Error('CORRUPT_STATE: State payload is not a valid JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion < 1) {
    throw new Error('CORRUPT_STATE: Missing or invalid schemaVersion.');
  }

  const base = createInitialMonitorState();
  const rawKnownNotices = (obj.knownNotices as Record<string, NormalizedNotice>) || {};
  const deliveredNoticeIdSet = new Set<string>(
    Array.isArray(obj.deliveredNoticeIds) ? (obj.deliveredNoticeIds as string[]) : []
  );
  const deliveredFingerprintSet = new Set<string>(
    Array.isArray(obj.deliveredFingerprints) ? (obj.deliveredFingerprints as string[]) : []
  );
  const deliveredContentHashSet = new Set<string>(
    Array.isArray(obj.deliveredContentHashes) ? (obj.deliveredContentHashes as string[]) : []
  );
  const deliveredCrossBoardKeySet = new Set<string>(
    Array.isArray(obj.deliveredCrossBoardKeys) ? (obj.deliveredCrossBoardKeys as string[]) : []
  );

  const migratedKnownNotices: Record<string, NormalizedNotice> = {};

  for (const [key, notice] of Object.entries(rawKnownNotices)) {
    if (!notice || typeof notice !== 'object') continue;
    const migratedOfficialUrl = canonicalizeOfficialUrl(
      migrateLegacyUrlToUnifiedPortal(notice.officialNoticeUrl || ''),
      'https://rrb.indianrailways.gov.in/'
    );
    const migratedCanonicalUrl = canonicalizeOfficialUrl(
      migrateLegacyUrlToUnifiedPortal(notice.canonicalUrl || notice.officialNoticeUrl || ''),
      'https://rrb.indianrailways.gov.in/'
    );
    const migratedAttachmentUrls = Array.isArray(notice.attachmentUrls)
      ? notice.attachmentUrls.map((u) =>
          canonicalizeOfficialUrl(
            migrateLegacyUrlToUnifiedPortal(u),
            'https://rrb.indianrailways.gov.in/'
          )
        )
      : [migratedCanonicalUrl];

    const urlChanged =
      migratedOfficialUrl !== notice.officialNoticeUrl ||
      migratedCanonicalUrl !== notice.canonicalUrl;

    const updatedNotice: NormalizedNotice = {
      ...notice,
      officialNoticeUrl: migratedOfficialUrl,
      canonicalUrl: migratedCanonicalUrl,
      attachmentUrls: migratedAttachmentUrls,
    };

    migratedKnownNotices[key] = updatedNotice;

    const wasBaselinedOrDelivered =
      notice.deliveryStatus === 'sent' ||
      notice.deliveryStatus === 'suppressed_baseline' ||
      notice.deliveryStatus === 'suppressed_duplicate' ||
      deliveredNoticeIdSet.has(notice.noticeId) ||
      deliveredFingerprintSet.has(notice.fingerprint);

    // Extract optional explicit notice code prefix (e.g. "CEN 03/2026-AII" from title or id)
    const codeMatch = (notice.title || '').match(
      /^(CEN\s*(?:No\.?)?\s*\d{2}\/\d{4}(?:-[A-Z0-9]+)?|RRC-\d{2}\/\d{4}|Notice[-/\s]\d+)/i
    );
    const codeVariants = [undefined, codeMatch ? codeMatch[1] : undefined];

    for (const explicitCode of codeVariants) {
      const recomputed = computeNoticeHashes({
        boardId: notice.boardId,
        title: notice.title,
        canonicalUrl: migratedCanonicalUrl,
        attachmentUrls: migratedAttachmentUrls,
        publicationDate: notice.publicationDate,
        explicitNoticeCode: explicitCode,
      });

      if (wasBaselinedOrDelivered) {
        deliveredNoticeIdSet.add(notice.noticeId);
        deliveredNoticeIdSet.add(recomputed.noticeId);
        deliveredFingerprintSet.add(notice.fingerprint);
        deliveredFingerprintSet.add(recomputed.fingerprint);
        if (notice.contentHash) deliveredContentHashSet.add(notice.contentHash);
        deliveredContentHashSet.add(recomputed.contentHash);
        deliveredCrossBoardKeySet.add(recomputed.crossBoardDocumentKey);
      }

      if (urlChanged && !migratedKnownNotices[recomputed.noticeId]) {
        migratedKnownNotices[recomputed.noticeId] = {
          ...updatedNotice,
          noticeId: recomputed.noticeId,
          fingerprint: recomputed.fingerprint,
          contentHash: recomputed.contentHash,
        };
      }
    }
  }

  const migrateQueueUrls = (
    queue: Record<string, DeliveryQueueItem> | undefined
  ): Record<string, DeliveryQueueItem> => {
    if (!queue || typeof queue !== 'object') return {};
    const out: Record<string, DeliveryQueueItem> = {};
    for (const [id, item] of Object.entries(queue)) {
      if (!item || typeof item !== 'object') continue;
      out[id] = {
        ...item,
        officialNoticeUrl: canonicalizeOfficialUrl(
          migrateLegacyUrlToUnifiedPortal(item.officialNoticeUrl || ''),
          'https://rrb.indianrailways.gov.in/'
        ),
        attachmentUrls: Array.isArray(item.attachmentUrls)
          ? item.attachmentUrls.map((u) =>
              canonicalizeOfficialUrl(
                migrateLegacyUrlToUnifiedPortal(u),
                'https://rrb.indianrailways.gov.in/'
              )
            )
          : [],
      };
    }
    return out;
  };

  // Migrate v1 -> v2 seamlessly while preserving all deduplication identities
  const migrated: MonitorState = {
    ...base,
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    initialized: Boolean(obj.initialized),
    baselineCompletedAt: typeof obj.baselineCompletedAt === 'string' ? obj.baselineCompletedAt : null,
    lastSuccessfulRunAt: typeof obj.lastSuccessfulRunAt === 'string' ? obj.lastSuccessfulRunAt : null,
    lastAttemptedRunAt: typeof obj.lastAttemptedRunAt === 'string' ? obj.lastAttemptedRunAt : null,
    lastRunStatus: (obj.lastRunStatus as MonitorState['lastRunStatus']) || 'IDLE',
    lastRunId: typeof obj.lastRunId === 'string' ? obj.lastRunId : null,
    activeLock: (obj.activeLock as DurableLock | null) || null,
    resumableScanQueue: (obj.resumableScanQueue as MonitorState['resumableScanQueue']) || null,
    boardStatuses: {
      ...base.boardStatuses,
      ...((obj.boardStatuses as Record<string, BoardRuntimeStatus>) || {}),
    },
    knownNotices: migratedKnownNotices,
    deliveredNoticeIds: Array.from(deliveredNoticeIdSet),
    deliveredFingerprints: Array.from(deliveredFingerprintSet),
    deliveredContentHashes: Array.from(deliveredContentHashSet),
    deliveredCrossBoardKeys: Array.from(deliveredCrossBoardKeySet),
    pendingDeliveries: migrateQueueUrls(obj.pendingDeliveries as Record<string, DeliveryQueueItem>),
    failedDeliveries: migrateQueueUrls(obj.failedDeliveries as Record<string, DeliveryQueueItem>),
    uncertainDeliveries: migrateQueueUrls(obj.uncertainDeliveries as Record<string, DeliveryQueueItem>),
    recentRunHistory: Array.isArray(obj.recentRunHistory)
      ? (obj.recentRunHistory as MonitorState['recentRunHistory']).slice(0, 50)
      : [],
    recentErrors: Array.isArray(obj.recentErrors)
      ? (obj.recentErrors as MonitorState['recentErrors']).slice(0, 100)
      : [],
    lastSuccessfulNoticeDatesByBoard:
      (obj.lastSuccessfulNoticeDatesByBoard as Record<string, string>) || {},
    metrics: {
      ...base.metrics,
      ...((obj.metrics as Partial<MonitorState['metrics']>) || {}),
    },
  };

  return migrated;
}

/**
 * Merges two concurrent MonitorState snapshots when resolving a GitHub HTTP 409 SHA conflict.
 * Preserves all discovered notices, delivered notice IDs, and delivery statuses so no notice is ever double-sent.
 */
export function mergeConflictingStates(remote: MonitorState, local: MonitorState): MonitorState {
  const mergedKnown = { ...remote.knownNotices };
  for (const [id, notice] of Object.entries(local.knownNotices)) {
    const existing = mergedKnown[id];
    if (!existing) {
      mergedKnown[id] = notice;
    } else {
      // Keep the most advanced delivery status ('sent' or 'uncertain' always wins over 'discovered' or 'pending')
      const priority: Record<string, number> = {
        sent: 6,
        uncertain: 5,
        sending: 4,
        pending: 3,
        failed: 2,
        suppressed_baseline: 2,
        suppressed_duplicate: 2,
        quarantined: 1,
        discovered: 0,
      };
      const winNotice =
        (priority[notice.deliveryStatus] ?? 0) >= (priority[existing.deliveryStatus] ?? 0)
          ? notice
          : existing;
      mergedKnown[id] = {
        ...existing,
        ...notice,
        deliveryStatus: winNotice.deliveryStatus,
        deliveredAt: existing.deliveredAt || notice.deliveredAt,
        firstSeenAt:
          existing.firstSeenAt < notice.firstSeenAt ? existing.firstSeenAt : notice.firstSeenAt,
      };
    }
  }

  const deliveredIds = Array.from(
    new Set([...remote.deliveredNoticeIds, ...local.deliveredNoticeIds])
  );
  const deliveredFps = Array.from(
    new Set([...remote.deliveredFingerprints, ...local.deliveredFingerprints])
  );
  const deliveredChs = Array.from(
    new Set([
      ...(remote.deliveredContentHashes || []),
      ...(local.deliveredContentHashes || []),
    ])
  );
  const deliveredCbKeys = Array.from(
    new Set([
      ...(remote.deliveredCrossBoardKeys || []),
      ...(local.deliveredCrossBoardKeys || []),
    ])
  );

  const pendingDeliveries: MonitorState['pendingDeliveries'] = { ...remote.pendingDeliveries };
  for (const [id, localItem] of Object.entries(local.pendingDeliveries)) {
    const remoteItem = pendingDeliveries[id];
    if (!remoteItem) {
      pendingDeliveries[id] = localItem;
    } else {
      // Preserve 'sending' claim over 'pending' so an in-flight delivery is never double-claimed
      const winItem =
        remoteItem.status === 'sending' && localItem.status !== 'sending'
          ? remoteItem
          : localItem.status === 'sending' && remoteItem.status !== 'sending'
            ? localItem
            : localItem.attemptCount >= remoteItem.attemptCount
              ? localItem
              : remoteItem;
      pendingDeliveries[id] = {
        ...remoteItem,
        ...localItem,
        status: winItem.status,
        claimedByRunId: winItem.claimedByRunId,
        claimedAt: winItem.claimedAt,
        attemptCount: Math.max(remoteItem.attemptCount, localItem.attemptCount),
      };
    }
  }

  const uncertainDeliveries = { ...remote.uncertainDeliveries, ...local.uncertainDeliveries };
  const failedDeliveries = { ...remote.failedDeliveries, ...local.failedDeliveries };

  // Remove any pending or failed item that is already sent or uncertain in remote or local
  for (const id of Object.keys(pendingDeliveries)) {
    const item = pendingDeliveries[id];
    if (
      deliveredIds.includes(item.noticeId) ||
      deliveredFps.includes(item.fingerprint) ||
      uncertainDeliveries[id]
    ) {
      delete pendingDeliveries[id];
    }
  }
  for (const id of Object.keys(failedDeliveries)) {
    const item = failedDeliveries[id];
    if (
      deliveredIds.includes(item.noticeId) ||
      deliveredFps.includes(item.fingerprint) ||
      uncertainDeliveries[id]
    ) {
      delete failedDeliveries[id];
    }
  }

  // Preserve active remote lock if it has not expired so a 409 conflict retry cannot steal an active lock
  const nowMs = Date.now();
  const remoteLockActive =
    remote.activeLock &&
    !Number.isNaN(Date.parse(remote.activeLock.expiresAt)) &&
    Date.parse(remote.activeLock.expiresAt) > nowMs;
  const resolvedActiveLock = remoteLockActive ? remote.activeLock : local.activeLock;

  const mergedWatermarks: Record<string, string> = {
    ...remote.lastSuccessfulNoticeDatesByBoard,
  };
  for (const [bId, dt] of Object.entries(local.lastSuccessfulNoticeDatesByBoard)) {
    if (!mergedWatermarks[bId] || dt > mergedWatermarks[bId]) {
      mergedWatermarks[bId] = dt;
    }
  }

  return {
    ...remote,
    ...local,
    initialized: remote.initialized || local.initialized,
    baselineCompletedAt: remote.baselineCompletedAt || local.baselineCompletedAt,
    activeLock: resolvedActiveLock,
    knownNotices: mergedKnown,
    deliveredNoticeIds: deliveredIds,
    deliveredFingerprints: deliveredFps,
    deliveredContentHashes: deliveredChs,
    deliveredCrossBoardKeys: deliveredCbKeys,
    pendingDeliveries,
    failedDeliveries,
    uncertainDeliveries,
    boardStatuses: { ...remote.boardStatuses, ...local.boardStatuses },
    lastSuccessfulNoticeDatesByBoard: mergedWatermarks,
    metrics: {
      ...local.metrics,
      githubShaConflictsResolved:
        Math.max(remote.metrics.githubShaConflictsResolved, local.metrics.githubShaConflictsResolved) + 1,
    },
  };
}

export interface StateStoreAdapter {
  readState(): Promise<StateEnvelope>;
  writeState(
    nextState: MonitorState,
    expectedSha: string | null,
    commitMessage: string
  ): Promise<StateEnvelope>;
}

/**
 * Persistent State Store that uses the official GitHub Contents API when configured,
 * and supports injectable fetch for deterministic unit testing of HTTP 409 SHA conflicts and API errors.
 */
export class PersistentStateStore implements StateStoreAdapter {
  private env: Record<string, string | undefined>;
  private fetchImpl: typeof fetch;
  private localMirrorPath: string;

  constructor(options?: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    localMirrorPath?: string;
  }) {
    this.env = options?.env || process.env;
    this.fetchImpl = options?.fetchImpl || fetch;
    this.localMirrorPath =
      options?.localMirrorPath ||
      this.env.LOCAL_FALLBACK_STATE_PATH ||
      path.join(process.cwd(), '.local-state', 'notices.json');
  }

  async readState(): Promise<StateEnvelope> {
    const gh = getGitHubConfigFromEnv(this.env);
    if (gh.configured) {
      const url = `https://api.github.com/repos/${encodeURIComponent(gh.config.owner)}/${encodeURIComponent(gh.config.repo)}/contents/${gh.config.statePath}?ref=${encodeURIComponent(gh.config.branch)}`;
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${gh.config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'RRB-Official-Notice-Monitor/2.1',
        },
      });

      if (res.status === 404) {
        const fresh = createInitialMonitorState();
        return {
          state: fresh,
          sha: null,
          storageBackend: 'github',
          repositoryInfo: { configured: true, ...gh.config },
        };
      }

      if (!res.ok) {
        throw new Error(
          `GITHUB_STATE_READ_ERROR: GitHub Contents API returned HTTP ${res.status}`
        );
      }

      const payload = (await res.json()) as { content?: string; encoding?: string; sha?: string };
      if (!payload.content || !payload.sha) {
        throw new Error('GITHUB_STATE_READ_ERROR: Missing content or SHA in GitHub response.');
      }

      const decoded = Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      const state = validateAndMigrateState(parsed);

      return {
        state,
        sha: payload.sha,
        storageBackend: 'github',
        repositoryInfo: { configured: true, ...gh.config },
      };
    }

    // Local durable JSON mirror when GitHub credentials are not configured in sandbox
    try {
      const content = await fs.readFile(this.localMirrorPath, 'utf8');
      const parsed = JSON.parse(content);
      const state = validateAndMigrateState(parsed.state ?? parsed);
      const sha = typeof parsed.sha === 'string' ? parsed.sha : 'local-sha-1';
      return {
        state,
        sha,
        storageBackend: 'local-mirror',
        repositoryInfo: { configured: false, ...gh.config },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const fresh = createInitialMonitorState();
        return {
          state: fresh,
          sha: null,
          storageBackend: 'local-mirror',
          repositoryInfo: { configured: false, ...gh.config },
        };
      }
      throw err;
    }
  }

  async writeState(
    nextState: MonitorState,
    expectedSha: string | null,
    commitMessage: string
  ): Promise<StateEnvelope> {
    const gh = getGitHubConfigFromEnv(this.env);
    if (gh.configured) {
      let currentSha = expectedSha;
      let stateToWrite = nextState;
      const maxConflictRetries = 3;

      for (let attempt = 0; attempt <= maxConflictRetries; attempt++) {
        const url = `https://api.github.com/repos/${encodeURIComponent(gh.config.owner)}/${encodeURIComponent(gh.config.repo)}/contents/${gh.config.statePath}`;
        const serialized = JSON.stringify(stateToWrite, null, 2);
        const body: Record<string, unknown> = {
          message: commitMessage,
          content: Buffer.from(serialized, 'utf8').toString('base64'),
          branch: gh.config.branch,
        };
        if (currentSha) {
          body.sha = currentSha;
        }

        const res = await this.fetchImpl(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${gh.config.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'RRB-Official-Notice-Monitor/2.1',
          },
          body: JSON.stringify(body),
        });

        if (res.status === 409 && attempt < maxConflictRetries) {
          // SHA conflict: re-read latest state from GitHub and deterministically merge
          const latestEnvelope = await this.readState();
          stateToWrite = mergeConflictingStates(latestEnvelope.state, stateToWrite);
          currentSha = latestEnvelope.sha;
          continue;
        }

        if (!res.ok) {
          throw new Error(
            `GITHUB_STATE_WRITE_ERROR: GitHub Contents API PUT returned HTTP ${res.status}`
          );
        }

        const result = (await res.json()) as { content?: { sha?: string } };
        const newSha = result.content?.sha || `sha-${Date.now()}`;
        return {
          state: stateToWrite,
          sha: newSha,
          storageBackend: 'github',
          repositoryInfo: { configured: true, ...gh.config },
        };
      }

      throw new Error('GITHUB_STATE_WRITE_ERROR: Exceeded maximum SHA conflict retries.');
    }

    // Write to local durable JSON file with SHA verification
    await fs.mkdir(path.dirname(this.localMirrorPath), { recursive: true });
    let stateToWrite = nextState;
    try {
      const existingRaw = await fs.readFile(this.localMirrorPath, 'utf8');
      const existingObj = JSON.parse(existingRaw);
      if (expectedSha && existingObj.sha && existingObj.sha !== expectedSha) {
        const existingState = validateAndMigrateState(existingObj.state ?? existingObj);
        stateToWrite = mergeConflictingStates(existingState, nextState);
      }
    } catch {
      // File doesn't exist yet
    }

    const newSha = `local-sha-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await fs.writeFile(
      this.localMirrorPath,
      JSON.stringify({ sha: newSha, state: stateToWrite }, null, 2),
      'utf8'
    );

    return {
      state: stateToWrite,
      sha: newSha,
      storageBackend: 'local-mirror',
      repositoryInfo: { configured: false, ...gh.config },
    };
  }
}

/**
 * Acquires a durable execution lock stored in persistent state so concurrent instances cannot overlap scans.
 */
export async function acquireDurableLock(
  store: StateStoreAdapter,
  runId: string,
  operation: DurableLock['operation'],
  ttlMs = 90_000,
  nowMs = Date.now()
): Promise<{ acquired: boolean; envelope: StateEnvelope; reason?: string }> {
  const envelope = await store.readState();
  const state = envelope.state;
  const existingLock = state.activeLock;

  if (existingLock && existingLock.ownerRunId !== runId) {
    const expiresAtMs = Date.parse(existingLock.expiresAt);
    if (!Number.isNaN(expiresAtMs) && expiresAtMs > nowMs) {
      state.metrics.lockAcquisitionFailures += 1;
      return {
        acquired: false,
        envelope,
        reason: `Lock currently held by run '${existingLock.ownerRunId}' (${existingLock.operation}) until ${existingLock.expiresAt}`,
      };
    }
  }

  const newLock: DurableLock = {
    lockId: `lock_${runId}`,
    ownerRunId: runId,
    operation,
    acquiredAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };

  state.activeLock = newLock;
  const updated = await store.writeState(
    state,
    envelope.sha,
    `chore(lock): acquire ${operation} lock for ${runId}`
  );

  // If a concurrent run won the lock during an HTTP 409 conflict merge, fail lock acquisition safely!
  if (updated.state.activeLock && updated.state.activeLock.ownerRunId !== runId) {
    return {
      acquired: false,
      envelope: updated,
      reason: `Concurrent lock race won by run '${updated.state.activeLock.ownerRunId}' (${updated.state.activeLock.operation}) until ${updated.state.activeLock.expiresAt}`,
    };
  }

  return { acquired: true, envelope: updated };
}

export async function releaseDurableLock(
  store: StateStoreAdapter,
  state: MonitorState,
  currentSha: string | null,
  runId: string,
  commitMessage: string
): Promise<StateEnvelope> {
  if (state.activeLock && state.activeLock.ownerRunId === runId) {
    state.activeLock = null;
  }
  return store.writeState(state, currentSha, commitMessage);
}
