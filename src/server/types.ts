export type SourceType =
  | 'UNIFIED_PORTAL_CENTRAL'
  | 'UNIFIED_PORTAL_REGIONAL'
  | 'REGIONAL_NIC_PORTAL'
  | 'STRUCTURED_JSON_FEED';

export type DateConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type NoticeCategory =
  | 'Employment Notification (CEN)'
  | 'Corrigendum & Amendment'
  | 'Result & Cut-Off Marks'
  | 'Answer Key & Objection Tracker'
  | 'Exam Schedule & City Intimation'
  | 'Admit Card & E-Call Letter'
  | 'Document Verification & Panel'
  | 'General Candidate Notice';

export type BaselineStatus =
  | 'BASELINED_INITIAL'
  | 'BASELINED_RECOVERY'
  | 'POST_BASELINE_NEW'
  | 'POST_BASELINE_REVISION'
  | 'QUARANTINED_OLD_DATE'
  | 'QUARANTINED_UNVERIFIED_DATE';

export type DeliveryStatus =
  | 'discovered'
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'uncertain'
  | 'suppressed_baseline'
  | 'suppressed_duplicate'
  | 'quarantined';

export type VerificationStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'REJECTED';

export type ZoneTestVerdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'SKIPPED' | 'BLOCKED';

export interface BoardConfig {
  boardId: string;
  boardName: string;
  zoneCode: string;
  headquarters: string;
  sourceUrl: string;
  noticesUrl: string;
  regionalKeywords?: string[];
  sourceType: SourceType;
  enabled: boolean;
  lastSuccessfulFetch: string | null;
  parserVersion: string;
  notes: string;
}

export interface NormalizedNotice {
  noticeId: string;
  fingerprint: string;
  boardId: string;
  boardName: string;
  title: string;
  officialNoticeUrl: string;
  canonicalUrl: string;
  attachmentUrls: string[];
  publicationDate: string | null; // ISO 8601 date YYYY-MM-DD or full UTC ISO
  publicationDateConfidence: DateConfidence;
  category: NoticeCategory;
  contentHash: string;
  firstSeenAt: string; // ISO 8601 UTC
  lastSeenAt: string; // ISO 8601 UTC
  lastObservedAt: string; // ISO 8601 UTC
  baselineStatus: BaselineStatus;
  deliveryStatus: DeliveryStatus;
  deliveredAt: string | null;
  sourceLastModified: string | null;
  parserVersion: string;
  verificationStatus: VerificationStatus;
  revisionNumber?: number;
  previousContentHash?: string | null;
  quarantineReason?: string | null;
}

export interface DeliveryQueueItem {
  deliveryId: string;
  noticeId: string;
  fingerprint: string;
  boardId: string;
  boardName: string;
  title: string;
  category: NoticeCategory;
  publicationDate: string | null;
  officialNoticeUrl: string;
  attachmentUrls: string[];
  status: 'discovered' | 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
  attemptCount: number;
  claimedByRunId: string | null;
  claimedAt: string | null;
  telegramMessageId: number | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
  reconciliationNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardRuntimeStatus {
  boardId: string;
  boardName: string;
  baselined: boolean;
  baselineCompletedAt: string | null;
  lastAttemptedFetchAt: string | null;
  lastSuccessfulFetchAt: string | null;
  lastHttpStatus: number | null;
  consecutiveFetchFailures: number;
  consecutiveParserFailures: number;
  lastDiscoveredCount: number;
  lastValidNoticeCount: number;
  lastNewestPublicationDate: string | null;
  lastErrorCategory: string | null;
  lastErrorMessage: string | null;
  parserVersion: string;
}

export interface DurableLock {
  lockId: string;
  ownerRunId: string;
  operation: 'cron_scan' | 'bootstrap' | 'delivery' | 'admin_reset';
  acquiredAt: string;
  expiresAt: string;
}

export interface ResumableScanProgress {
  active: boolean;
  cycleId: string;
  startedAt: string;
  pendingBoardIds: string[];
  completedBoardIds: string[];
  failedBoardIds: string[];
  mode: 'baseline' | 'production' | 'dry_run';
}

export interface RunHistoryEntry {
  runId: string;
  mode: 'cron' | 'bootstrap' | 'dry_run' | 'all_zones_test' | 'single_zone_test';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'SUCCESS' | 'PARTIAL_BATCH' | 'PARTIAL_FAILURE' | 'FAILED' | 'LOCKED';
  boardsScanned: number;
  boardsSucceeded: number;
  boardsFailed: number;
  noticesFound: number;
  newNoticesEligible: number;
  messagesDelivered: number;
  messagesFailed: number;
  messagesUncertain: number;
  summary: string;
}

export interface ErrorRecord {
  errorId: string;
  timestamp: string;
  runId: string;
  boardId: string | null;
  stage: 'FETCH' | 'PARSE' | 'STATE_READ' | 'STATE_WRITE' | 'TELEGRAM' | 'LOCK' | 'AUTH';
  category: string;
  message: string;
}

export interface MonitorState {
  schemaVersion: number;
  initialized: boolean;
  baselineCompletedAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastAttemptedRunAt: string | null;
  lastRunStatus: 'IDLE' | 'SUCCESS' | 'PARTIAL_BATCH' | 'PARTIAL_FAILURE' | 'FAILED';
  lastRunId: string | null;
  activeLock: DurableLock | null;
  resumableScanQueue: ResumableScanProgress | null;
  boardStatuses: Record<string, BoardRuntimeStatus>;
  knownNotices: Record<string, NormalizedNotice>;
  deliveredNoticeIds: string[];
  deliveredFingerprints: string[];
  deliveredContentHashes?: string[];
  deliveredCrossBoardKeys?: string[];
  pendingDeliveries: Record<string, DeliveryQueueItem>;
  failedDeliveries: Record<string, DeliveryQueueItem>;
  uncertainDeliveries: Record<string, DeliveryQueueItem>;
  recentRunHistory: RunHistoryEntry[];
  recentErrors: ErrorRecord[];
  lastSuccessfulNoticeDatesByBoard: Record<string, string>;
  metrics: {
    totalRuns: number;
    totalValidNoticesFound: number;
    totalNewNoticesDetected: number;
    totalTelegramDelivered: number;
    totalFailedDeliveries: number;
    totalUncertainDeliveries: number;
    githubStateReadFailures: number;
    githubStateWriteFailures: number;
    githubShaConflictsResolved: number;
    lockAcquisitionFailures: number;
    lastOperationalAlertAt: string | null;
  };
}

export interface ZoneTestReport {
  boardId: string;
  boardName: string;
  configuredSourceUrl: string;
  noticesUrl: string;
  verdict: ZoneTestVerdict;
  httpStatus: number | null;
  fetchResult: 'SUCCESS' | 'TIMEOUT' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'SSRF_BLOCKED';
  redirectDestination: string | null;
  responseContentType: string | null;
  responseSizeBytes: number;
  fetchDurationMs: number;
  parsingResult: 'VALID' | 'EMPTY_OR_SUSPICIOUS' | 'CHALLENGE_OR_BLOCK_PAGE' | 'UNEXPECTED_STRUCTURE' | 'PARSE_ERROR' | 'NOT_RUN';
  rawRowsDetected: number;
  validNormalizedNotices: number;
  duplicatesFound: number;
  newestValidPublicationDate: string | null;
  latestParsedNoticeTitle: string | null;
  officialDetailUrl: string | null;
  attachmentUrl: string | null;
  dateParsingConfidence: DateConfidence;
  paginationChecked: boolean;
  unexpectedPageStructure: boolean;
  errorCategory: string | null;
  diagnosticMessage: string;
  dataSourceMode: 'LIVE_NETWORK' | 'DETERMINISTIC_FIXTURE';
  testedAt: string;
  sampleNotices: Array<{
    noticeId: string;
    title: string;
    publicationDate: string | null;
    category: NoticeCategory;
    officialNoticeUrl: string;
    attachmentUrls: string[];
    fingerprint: string;
  }>;
}

export interface AllZonesTestSummary {
  runId: string;
  executedAt: string;
  executedAtIST: string;
  dataSourceMode: 'LIVE_NETWORK' | 'DETERMINISTIC_FIXTURE';
  durationMs: number;
  totalBoardsConfigured: number;
  totalTested: number;
  counts: {
    PASS: number;
    PARTIAL: number;
    FAIL: number;
    SKIPPED: number;
    BLOCKED: number;
  };
  telegramSummarySent: boolean;
  telegramMessageId: number | null;
  reports: ZoneTestReport[];
}
