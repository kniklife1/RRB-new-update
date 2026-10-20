import { computeNoticeHashes } from './parser.ts';
import type {
  DeliveryQueueItem,
  MonitorState,
  NormalizedNotice,
} from './types.ts';

export interface EligibilityDecision {
  eligibleForAlert: boolean;
  reasonCode:
    | 'ELIGIBLE_NEW_NOTICE'
    | 'ELIGIBLE_DOCUMENT_REVISION'
    | 'SUPPRESSED_BASELINE_NOT_COMPLETE'
    | 'SUPPRESSED_BOARD_RECOVERY_BASELINE'
    | 'SUPPRESSED_ALREADY_KNOWN_FINGERPRINT'
    | 'SUPPRESSED_ALREADY_IN_DELIVERY_QUEUE'
    | 'SUPPRESSED_CROSS_BOARD_DUPLICATE'
    | 'QUARANTINED_MISSING_PUBLICATION_DATE'
    | 'QUARANTINED_OLDER_PUBLICATION_DATE'
    | 'REJECTED_UNVERIFIED_SOURCE'
    | 'REJECTED_STATE_UNHEALTHY';
  explanation: string;
  updatedNotice: NormalizedNotice;
}

export interface EligibilityPolicyOptions {
  stateStoreHealthy: boolean;
  lockOwnedByCurrentRun: boolean;
  boardIsUnbaselined?: boolean;
  boardIsRecoveringOrUnbaselined: boolean;
  olderPublicationDatePolicy: 'quarantine' | 'allow_if_recent' | 'suppress';
  maxAcceptableAgeDays?: number;
  referenceTimeIso: string;
  seenCrossBoardKeysInCurrentRun: Set<string>;
}

/**
 * Evaluates a parsed notice against all production eligibility rules.
 * Guarantees that historical notices, duplicates, recovery scans, and unverified dates never trigger false alerts.
 */
export function evaluateNoticeEligibility(
  notice: NormalizedNotice,
  state: MonitorState,
  options: EligibilityPolicyOptions
): EligibilityDecision {
  // Rule 1: State store health and lock ownership check (fail-closed)
  if (!options.stateStoreHealthy || !options.lockOwnedByCurrentRun) {
    return {
      eligibleForAlert: false,
      reasonCode: 'REJECTED_STATE_UNHEALTHY',
      explanation: 'State store is unhealthy or current execution does not own the durable lock.',
      updatedNotice: {
        ...notice,
        deliveryStatus: 'discovered',
      },
    };
  }

  // Rule 2: Verified source and deterministic fingerprint check
  if (!notice.fingerprint || notice.fingerprint.length !== 64 || !notice.officialNoticeUrl) {
    return {
      eligibleForAlert: false,
      reasonCode: 'REJECTED_UNVERIFIED_SOURCE',
      explanation: 'Notice lacks a valid 64-char SHA-256 fingerprint or verified official URL.',
      updatedNotice: {
        ...notice,
        verificationStatus: 'REJECTED',
      },
    };
  }

  // Rule 3: Initial baseline must be complete before any production alert can fire
  if (!state.initialized || !state.baselineCompletedAt) {
    return {
      eligibleForAlert: false,
      reasonCode: 'SUPPRESSED_BASELINE_NOT_COMPLETE',
      explanation: 'System baseline is not yet completed; recording notice as baseline history.',
      updatedNotice: {
        ...notice,
        baselineStatus: 'BASELINED_INITIAL',
        deliveryStatus: 'suppressed_baseline',
      },
    };
  }

  // Rule 3B: If this specific board has never been baselined before (e.g. newly enabled board),
  // its first scan must record all existing notices as baseline without alerting.
  if (options.boardIsUnbaselined) {
    return {
      eligibleForAlert: false,
      reasonCode: 'SUPPRESSED_BOARD_RECOVERY_BASELINE',
      explanation: 'Board has not completed its initial baseline; recording existing notice as baseline history.',
      updatedNotice: {
        ...notice,
        baselineStatus: 'BASELINED_RECOVERY',
        deliveryStatus: 'suppressed_baseline',
      },
    };
  }

  // Rule 4: Already known fingerprint, already delivered fingerprint, or already delivered contentHash
  const existingById = state.knownNotices[notice.noticeId];
  const existingByFingerprint = Object.values(state.knownNotices).find(
    (n) => n.fingerprint === notice.fingerprint
  );
  const alreadyDeliveredContentHash = Boolean(
    state.deliveredContentHashes?.includes(notice.contentHash) ||
      (existingById &&
        (existingById.contentHash === notice.contentHash ||
          existingById.previousContentHash === notice.contentHash))
  );

  if (
    existingByFingerprint ||
    state.deliveredFingerprints.includes(notice.fingerprint) ||
    alreadyDeliveredContentHash
  ) {
    const prior = existingByFingerprint || existingById || notice;
    return {
      eligibleForAlert: false,
      reasonCode: 'SUPPRESSED_ALREADY_KNOWN_FINGERPRINT',
      explanation: 'Notice fingerprint or content hash already exists in persistent history.',
      updatedNotice: {
        ...prior,
        lastSeenAt: options.referenceTimeIso,
        lastObservedAt: options.referenceTimeIso,
      },
    };
  }

  // Rule 5: Check if already pending, sending, delivered, or uncertain in global delivery queues
  const queueItems = [
    ...Object.values(state.pendingDeliveries),
    ...Object.values(state.uncertainDeliveries),
  ];
  const alreadyQueued = queueItems.find(
    (q) => q.noticeId === notice.noticeId || q.fingerprint === notice.fingerprint
  );
  if (alreadyQueued) {
    return {
      eligibleForAlert: false,
      reasonCode: 'SUPPRESSED_ALREADY_IN_DELIVERY_QUEUE',
      explanation: `Notice is already in delivery queue with status '${alreadyQueued.status}'.`,
      updatedNotice: {
        ...notice,
        deliveryStatus: alreadyQueued.status,
      },
    };
  }

  // Rule 6: Publication date validation & conservative policy for missing, low-confidence, future, or old publication dates.
  // Evaluated BEFORE allowing either a new notice OR a document revision so historical notices never leak through.
  if (
    !notice.publicationDate ||
    notice.publicationDateConfidence === 'NONE' ||
    notice.publicationDateConfidence === 'LOW'
  ) {
    return {
      eligibleForAlert: false,
      reasonCode: 'QUARANTINED_MISSING_PUBLICATION_DATE',
      explanation:
        'Publication date is missing or low-confidence; quarantined under conservative novelty policy.',
      updatedNotice: {
        ...notice,
        baselineStatus: 'QUARANTINED_UNVERIFIED_DATE',
        deliveryStatus: 'quarantined',
        verificationStatus: 'NEEDS_REVIEW',
        quarantineReason: 'Missing or low-confidence official publication date',
      },
    };
  }

  const maxAgeDays = options.maxAcceptableAgeDays ?? 14;
  const refDayMs = Date.parse(options.referenceTimeIso.slice(0, 10) + 'T00:00:00Z');
  const pubDayMs = Date.parse(notice.publicationDate + 'T00:00:00Z');
  const ageDays = Math.floor((refDayMs - pubDayMs) / (1000 * 60 * 60 * 24));

  // Reject impossible future publication dates (> 2 days ahead of current UTC date)
  if (ageDays < -2) {
    return {
      eligibleForAlert: false,
      reasonCode: 'QUARANTINED_OLDER_PUBLICATION_DATE',
      explanation: `Notice publication date (${notice.publicationDate}) is more than 2 days in the future; quarantined for review.`,
      updatedNotice: {
        ...notice,
        baselineStatus: 'QUARANTINED_UNVERIFIED_DATE',
        deliveryStatus: 'quarantined',
        verificationStatus: 'NEEDS_REVIEW',
        quarantineReason: `Future publication date ${notice.publicationDate}`,
      },
    };
  }

  // Rule 7: Recovery protection — if this specific board is recovering from fetch/parser outage,
  // do not flood Telegram with historical items discovered on recovery unless publicationDate is strictly >= baselineCompletedAt day
  // and >= the board's watermark and within recent 3 days.
  const baselineDateDay = state.baselineCompletedAt.slice(0, 10);
  const boardLatestDate = state.lastSuccessfulNoticeDatesByBoard[notice.boardId];
  if (options.boardIsRecoveringOrUnbaselined) {
    const isStrictlyRecentPostWatermark =
      notice.publicationDateConfidence === 'HIGH' &&
      notice.publicationDate >= baselineDateDay &&
      (!boardLatestDate || notice.publicationDate >= boardLatestDate) &&
      ageDays <= 3;

    if (!isStrictlyRecentPostWatermark) {
      return {
        eligibleForAlert: false,
        reasonCode: 'SUPPRESSED_BOARD_RECOVERY_BASELINE',
        explanation:
          'Board is recovering from outage; historical or pre-watermark notice recorded without alerting.',
        updatedNotice: {
          ...notice,
          baselineStatus: 'BASELINED_RECOVERY',
          deliveryStatus: 'suppressed_baseline',
        },
      };
    }
  }

  // Rule 8: Check if this is a revised version of an existing noticeId (title or attachment updated)
  if (existingById && existingById.contentHash !== notice.contentHash) {
    // Prevent historical pre-baseline notices or previously quarantined old notices from leaking through as revisions
    const isAncientOrPreBaselineRevision =
      ageDays > maxAgeDays ||
      (notice.publicationDate < baselineDateDay && existingById.baselineStatus === 'QUARANTINED_OLD_DATE');

    if (isAncientOrPreBaselineRevision && options.olderPublicationDatePolicy !== 'allow_if_recent') {
      return {
        eligibleForAlert: false,
        reasonCode: 'QUARANTINED_OLDER_PUBLICATION_DATE',
        explanation: `Revision on historical notice (${notice.publicationDate}) exceeds ${maxAgeDays}-day threshold; quarantined.`,
        updatedNotice: {
          ...notice,
          baselineStatus: 'QUARANTINED_OLD_DATE',
          deliveryStatus: 'quarantined',
          verificationStatus: 'NEEDS_REVIEW',
          quarantineReason: `Revision on older notice dated ${notice.publicationDate}`,
        },
      };
    }

    const revNum = (existingById.revisionNumber || 1) + 1;
    const revisedNotice: NormalizedNotice = {
      ...notice,
      firstSeenAt: existingById.firstSeenAt,
      lastSeenAt: options.referenceTimeIso,
      lastObservedAt: options.referenceTimeIso,
      baselineStatus: 'POST_BASELINE_REVISION',
      deliveryStatus: 'pending',
      revisionNumber: revNum,
      previousContentHash: existingById.contentHash,
    };
    return {
      eligibleForAlert: true,
      reasonCode: 'ELIGIBLE_DOCUMENT_REVISION',
      explanation: `Official notice '${notice.noticeId}' has an updated content hash (Revision #${revNum}).`,
      updatedNotice: revisedNotice,
    };
  }

  // Rule 9: Cross-board duplicate suppression (identical centralized notice listed on multiple regional boards)
  const { crossBoardDocumentKey } = computeNoticeHashes({
    boardId: notice.boardId,
    title: notice.title,
    canonicalUrl: notice.canonicalUrl,
    attachmentUrls: notice.attachmentUrls,
    publicationDate: notice.publicationDate,
  });

  const existingCrossBoard =
    state.deliveredCrossBoardKeys?.includes(crossBoardDocumentKey) ||
    Object.values(state.knownNotices).some((known) => {
      const knownKey = computeNoticeHashes({
        boardId: known.boardId,
        title: known.title,
        canonicalUrl: known.canonicalUrl,
        attachmentUrls: known.attachmentUrls,
        publicationDate: known.publicationDate,
      }).crossBoardDocumentKey;
      return (
        knownKey === crossBoardDocumentKey &&
        (known.deliveryStatus === 'sent' ||
          known.deliveryStatus === 'pending' ||
          known.deliveryStatus === 'sending' ||
          known.deliveryStatus === 'uncertain' ||
          known.baselineStatus === 'BASELINED_INITIAL' ||
          known.baselineStatus === 'BASELINED_RECOVERY')
      );
    });

  if (existingCrossBoard || options.seenCrossBoardKeysInCurrentRun.has(crossBoardDocumentKey)) {
    return {
      eligibleForAlert: false,
      reasonCode: 'SUPPRESSED_CROSS_BOARD_DUPLICATE',
      explanation: `Centralized notice already accounted for across boards.`,
      updatedNotice: {
        ...notice,
        baselineStatus: 'POST_BASELINE_NEW',
        deliveryStatus: 'suppressed_duplicate',
      },
    };
  }

  // Rule 10: Enforce Board Watermark & Baseline Date Floor for newly discovered notices
  const isOlderThanBoardFloor =
    Boolean(boardLatestDate && notice.publicationDate < boardLatestDate) ||
    notice.publicationDate < baselineDateDay ||
    ageDays > maxAgeDays;

  if (isOlderThanBoardFloor && options.olderPublicationDatePolicy !== 'allow_if_recent') {
    return {
      eligibleForAlert: false,
      reasonCode: 'QUARANTINED_OLDER_PUBLICATION_DATE',
      explanation: `Notice publication date (${notice.publicationDate}) predates board watermark (${boardLatestDate || 'N/A'}), baseline date (${baselineDateDay}), or ${maxAgeDays}-day threshold.`,
      updatedNotice: {
        ...notice,
        baselineStatus: 'QUARANTINED_OLD_DATE',
        deliveryStatus: 'quarantined',
        verificationStatus: 'NEEDS_REVIEW',
        quarantineReason: `Publication date ${notice.publicationDate} predates watermark/baseline floor`,
      },
    };
  }

  // Passed all eligibility checks!
  options.seenCrossBoardKeysInCurrentRun.add(crossBoardDocumentKey);

  return {
    eligibleForAlert: true,
    reasonCode: 'ELIGIBLE_NEW_NOTICE',
    explanation: 'Verified newly published official RRB notice eligible for Telegram alert.',
    updatedNotice: {
      ...notice,
      baselineStatus: 'POST_BASELINE_NEW',
      deliveryStatus: 'pending',
      verificationStatus: 'VERIFIED',
    },
  };
}

export function createDeliveryQueueItem(
  notice: NormalizedNotice,
  nowIso: string
): DeliveryQueueItem {
  return {
    deliveryId: `dlv_${notice.noticeId}_${notice.contentHash.slice(0, 8)}`,
    noticeId: notice.noticeId,
    fingerprint: notice.fingerprint,
    boardId: notice.boardId,
    boardName: notice.boardName,
    title: notice.title,
    category: notice.category,
    publicationDate: notice.publicationDate,
    officialNoticeUrl: notice.officialNoticeUrl,
    attachmentUrls: notice.attachmentUrls,
    status: 'pending',
    attemptCount: 0,
    claimedByRunId: null,
    claimedAt: null,
    telegramMessageId: null,
    lastAttemptAt: null,
    deliveredAt: null,
    lastError: null,
    reconciliationNotes: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
