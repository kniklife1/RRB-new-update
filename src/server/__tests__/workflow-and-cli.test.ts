import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  APPROVED_OFFICIAL_DOMAINS,
  UNIFIED_RRB_PORTAL_URL,
  VERIFIED_BOARD_CONFIGS,
  isApprovedOfficialUrl,
} from '../boards.ts';
import {
  DEFAULT_NOTICE_FILTER_KEYWORDS,
  matchesNoticeKeywords,
} from '../eligibility.ts';
import {
  executeAllZonesTest,
  executeBootstrapBaseline,
  executeMonitorRun,
  fetchBoardSource,
} from '../engine.ts';
import {
  buildCombinedUnifiedPortalHtmlFixture,
  buildOfficialBoardHtmlFixture,
} from '../fixtures/htmlFixtures.ts';
import { computeNoticeHashes } from '../parser.ts';
import {
  createInitialMonitorState,
  getGitHubConfigFromEnv,
  validateAndMigrateState,
} from '../stateStore.ts';
import type { StateEnvelope, StateStoreAdapter } from '../stateStore.ts';
import { formatProductionNoticeTelegramMessage } from '../telegram.ts';
import type { MonitorState } from '../types.ts';
import { parseCliArgs, runCliMonitor } from '../../../scripts/run-monitor.ts';

class CliMemoryStateStore implements StateStoreAdapter {
  public state: MonitorState = createInitialMonitorState();
  public sha = 'cli-sha-1';

  async readState(): Promise<StateEnvelope> {
    return {
      state: structuredClone(this.state),
      sha: this.sha,
      storageBackend: 'github',
      repositoryInfo: {
        configured: true,
        owner: 'test-org',
        repo: 'rrb-notice-monitor',
        branch: 'main',
        statePath: 'state/notices.json',
      },
    };
  }

  async writeState(
    nextState: MonitorState,
    _expectedSha: string | null,
    _commitMessage: string
  ): Promise<StateEnvelope> {
    this.state = structuredClone(nextState);
    this.sha = `cli-sha-${Date.now()}`;
    return {
      state: structuredClone(this.state),
      sha: this.sha,
      storageBackend: 'github',
      repositoryInfo: {
        configured: true,
        owner: 'test-org',
        repo: 'rrb-notice-monitor',
        branch: 'main',
        statePath: 'state/notices.json',
      },
    };
  }
}

// 33. GitHub Actions workflow (.github/workflows/monitor.yml) exists and has valid triggers, permissions, and secrets.
test('33. GitHub Actions workflow .github/workflows/monitor.yml has valid schedule, dispatch inputs, permissions, and concurrency', async () => {
  const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'monitor.yml');
  const content = await fs.readFile(workflowPath, 'utf8');

  // Verify schedule & workflow_dispatch triggers
  assert.ok(content.includes('schedule:'), 'Workflow must define schedule trigger');
  assert.ok(content.includes("cron: '*/10 * * * *'"), 'Workflow must run every 10 minutes');
  assert.ok(content.includes('workflow_dispatch:'), 'Workflow must support manual workflow_dispatch');

  // Verify least-privilege contents: write permission and safe concurrency group
  assert.ok(content.includes('permissions:'), 'Workflow must declare explicit permissions');
  assert.ok(content.includes('contents: write'), 'Workflow must grant contents: write for state persistence');
  assert.ok(content.includes('concurrency:'), 'Workflow must configure concurrency protection');
  assert.ok(
    content.includes('cancel-in-progress: false'),
    'Workflow must not cancel in-progress Telegram delivery checkpoints'
  );

  // Verify CLI runner and verified server endpoints (no invented endpoints)
  assert.ok(content.includes('scripts/run-monitor.ts'), 'Workflow must invoke scripts/run-monitor.ts');
  assert.ok(content.includes('/api/cron/run'), 'Workflow remote mode must target /api/cron/run');
  assert.ok(content.includes('/api/admin/bootstrap'), 'Workflow remote mode must target /api/admin/bootstrap');
  assert.ok(content.includes('/api/admin/dry-run'), 'Workflow remote mode must target /api/admin/dry-run');
  assert.ok(content.includes('/api/test/all-zones'), 'Workflow remote mode must target /api/test/all-zones');
  assert.ok(content.includes('/api/test/telegram'), 'Workflow remote mode must target /api/test/telegram');

  // Verify use_fixtures input defaults to 'false' (live portal fetching) while supporting 'true' for fixture runs
  assert.ok(
    content.includes("USE_FIXTURES: ${{ github.event_name == 'workflow_dispatch' && inputs.use_fixtures || vars.USE_FIXTURES || 'false' }}"),
    'Workflow must default USE_FIXTURES to false for live fetching unless overridden'
  );
  const useFixturesSection = content.split('use_fixtures:')[1]?.split('run_unit_tests:')[0] || '';
  assert.ok(useFixturesSection.includes("default: 'false'"), 'use_fixtures must default to false');
  assert.ok(useFixturesSection.includes("- 'false'"), 'use_fixtures must include false option');
  assert.ok(useFixturesSection.includes("- 'true'"), 'use_fixtures must include true option');
});

// 34. getGitHubConfigFromEnv resolves GitHub Actions automatic environment variables (GITHUB_REPOSITORY, GITHUB_REF_NAME, GH_STATE_TOKEN).
test('34. getGitHubConfigFromEnv resolves GITHUB_REPOSITORY, GITHUB_REF_NAME, and GH_STATE_TOKEN in GitHub Actions', () => {
  const ghActionsEnv = {
    GH_STATE_TOKEN: 'ghs_actions_runtime_token_123456',
    GITHUB_REPOSITORY: 'railway-org/rrb-notice-monitor',
    GITHUB_REF_NAME: 'main',
  };

  const resolved = getGitHubConfigFromEnv(ghActionsEnv);
  assert.equal(resolved.configured, true);
  assert.equal(resolved.config.token, 'ghs_actions_runtime_token_123456');
  assert.equal(resolved.config.owner, 'railway-org');
  assert.equal(resolved.config.repo, 'rrb-notice-monitor');
  assert.equal(resolved.config.branch, 'main');
  assert.equal(resolved.config.statePath, 'state/notices.json');
});

// 35. Repository state file (state/notices.json), state lifecycle transitions, and board config (config/boards.json) are valid and synchronized.
test('35. state/notices.json lifecycle (pre- and post-bootstrap) and config/boards.json match all 22 verified RRB boards', async () => {
  // 1. Fresh state factory must always start uninitialized
  const freshState = createInitialMonitorState();
  assert.equal(freshState.schemaVersion, 2);
  assert.equal(freshState.initialized, false);
  assert.equal(freshState.baselineCompletedAt, null);
  assert.equal(Object.keys(freshState.boardStatuses).length, 22);
  for (const board of VERIFIED_BOARD_CONFIGS) {
    assert.ok(freshState.boardStatuses[board.boardId], `Missing boardStatus for ${board.boardId}`);
    assert.equal(freshState.boardStatuses[board.boardId].baselined, false);
  }

  // 2. Repository state/notices.json must satisfy strict lifecycle invariants whether pre-bootstrap or post-bootstrap
  const stateRaw = await fs.readFile(path.join(process.cwd(), 'state', 'notices.json'), 'utf8');
  const parsedState = validateAndMigrateState(JSON.parse(stateRaw));
  assert.equal(parsedState.schemaVersion, 2);
  assert.equal(typeof parsedState.initialized, 'boolean');
  assert.equal(Object.keys(parsedState.boardStatuses).length, 22);

  if (!parsedState.initialized) {
    assert.equal(
      parsedState.baselineCompletedAt,
      null,
      'Uninitialized state must have baselineCompletedAt === null'
    );
  } else {
    assert.equal(
      typeof parsedState.baselineCompletedAt,
      'string',
      'Initialized state must record a valid ISO baselineCompletedAt timestamp'
    );
    assert.ok(
      !Number.isNaN(Date.parse(parsedState.baselineCompletedAt!)),
      'baselineCompletedAt must be a valid ISO-8601 date'
    );
    for (const notice of Object.values(parsedState.knownNotices)) {
      assert.ok(
        notice.officialNoticeUrl.startsWith(UNIFIED_RRB_PORTAL_URL),
        `Known notice ${notice.noticeId} must use unified portal URL`
      );
    }
  }

  // 3. Verify full lifecycle transition: uninitialized (false) -> bootstrap -> initialized (true) -> re-validate
  const lifecycleStore = new CliMemoryStateStore();
  assert.equal(lifecycleStore.state.initialized, false);
  const bootRes = await executeBootstrapBaseline(lifecycleStore, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });
  assert.equal(bootRes.status, 'SUCCESS');
  assert.equal(lifecycleStore.state.initialized, true);
  const revalidated = validateAndMigrateState(JSON.parse(JSON.stringify(lifecycleStore.state)));
  assert.equal(revalidated.initialized, true);
  assert.equal(revalidated.baselineCompletedAt, '2026-10-19T10:00:00.000Z');

  // 4. Verify config/boards.json synchronization
  const configRaw = await fs.readFile(path.join(process.cwd(), 'config', 'boards.json'), 'utf8');
  const parsedConfig = JSON.parse(configRaw) as {
    totalBoards: number;
    primaryUnifiedPortal: string;
    approvedOfficialDomains: string[];
    boards: Array<{ boardId: string; sourceUrl: string; noticesUrl: string; legacyDomain?: string }>;
  };
  assert.equal(parsedConfig.totalBoards, 22);
  assert.equal(parsedConfig.primaryUnifiedPortal, UNIFIED_RRB_PORTAL_URL);
  assert.equal(parsedConfig.boards.length, VERIFIED_BOARD_CONFIGS.length);
  for (const cfgBoard of parsedConfig.boards) {
    assert.equal(cfgBoard.sourceUrl, UNIFIED_RRB_PORTAL_URL);
    assert.equal(cfgBoard.noticesUrl, UNIFIED_RRB_PORTAL_URL);
    assert.equal(cfgBoard.legacyDomain, undefined);
  }
});

// 36. CLI argument parser (parseCliArgs) handles flags and environment variables accurately.
test('36. CLI argument parser (parseCliArgs) parses modes, fixture flags, and batch sizes', () => {
  const parsed1 = parseCliArgs(['--mode=bootstrap', '--fixtures=true'], {});
  assert.equal(parsed1.mode, 'bootstrap');
  assert.equal(parsed1.useFixtures, true);

  const parsed2 = parseCliArgs(['--dry-run', '--fixtures', '--batch-size=10'], {});
  assert.equal(parsed2.mode, 'dry_run');
  assert.equal(parsed2.useFixtures, true);
  assert.equal(parsed2.maxBoardsPerBatch, 10);

  const parsed3 = parseCliArgs([], {
    MONITOR_MODE: 'all_zones',
    USE_FIXTURES: 'true',
    SEND_TELEGRAM_TEST_SUMMARY: 'false',
  });
  assert.equal(parsed3.mode, 'all_zones');
  assert.equal(parsed3.useFixtures, true);
});

// 37. Standalone CLI runner (runCliMonitor) executes bootstrap, dry_run, production, and all_zones end-to-end.
test('37. Standalone CLI runner executes bootstrap, dry_run, production, and all_zones modes with proper exit codes', async () => {
  const store = new CliMemoryStateStore();

  // 1. Production run BEFORE bootstrap must fail with exitCode 1 (BASELINE_REQUIRED)
  const preBootRun = await runCliMonitor({
    mode: 'production',
    useFixtures: true,
    store,
  });
  assert.equal(preBootRun.exitCode, 1);
  assert.equal(preBootRun.status, 'BASELINE_REQUIRED');

  // 2. Bootstrap baseline via CLI must succeed with exitCode 0 and 0 alerts sent
  const bootOut = await runCliMonitor({
    mode: 'bootstrap',
    useFixtures: true,
    store,
  });
  assert.equal(bootOut.exitCode, 0);
  assert.equal(bootOut.status, 'SUCCESS');

  // 3. Dry run via CLI must succeed with exitCode 0
  const dryOut = await runCliMonitor({
    mode: 'dry_run',
    useFixtures: true,
    store,
  });
  assert.equal(dryOut.exitCode, 0);
  assert.equal(dryOut.status, 'SUCCESS');

  // 4. Production run via CLI after baseline must succeed with exitCode 0 and 0 duplicate alerts
  const prodOut = await runCliMonitor({
    mode: 'production',
    useFixtures: true,
    store,
  });
  assert.equal(prodOut.exitCode, 0);
  assert.equal(prodOut.status, 'SUCCESS');

  // 5. All-zones verification via CLI must pass all 22 boards in fixture mode
  const zonesOut = await runCliMonitor({
    mode: 'all_zones',
    useFixtures: true,
    store,
  });
  assert.equal(zonesOut.exitCode, 0);
  assert.equal(zonesOut.status, 'PASS');
});

// 38. GitHub Actions setup-node lockfile resilience, package-lock.json sync, and .npmrc peer-dependency protection.
test('38. GitHub Actions setup-node does not fail on missing lockfile, and package-lock.json + .npmrc are valid and synchronized', async () => {
  const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'monitor.yml');
  const workflowContent = await fs.readFile(workflowPath, 'utf8');

  // Ensure actions/setup-node@v4 does not use unguarded cache: 'npm' that throws when lockfile is absent
  assert.equal(
    workflowContent.includes("cache: 'npm'"),
    false,
    "actions/setup-node@v4 must not use unguarded cache: 'npm'"
  );
  assert.ok(
    workflowContent.includes("hashFiles('package-lock.json') != ''"),
    'Workflow must guard npm caching with hashFiles(package-lock.json) check'
  );
  assert.ok(
    workflowContent.includes('npm ci --legacy-peer-deps --no-audit --no-fund'),
    'Workflow must run deterministic npm ci --legacy-peer-deps when package-lock.json exists'
  );
  assert.ok(
    workflowContent.includes('npm install --legacy-peer-deps --no-audit --no-fund'),
    'Workflow must fallback to npm install --legacy-peer-deps when package-lock.json is absent'
  );

  // Verify package-lock.json exists and matches package.json
  const pkgRaw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const lockRaw = await fs.readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw) as { name: string; version: string; dependencies: Record<string, string> };
  const lock = JSON.parse(lockRaw) as {
    name: string;
    version: string;
    lockfileVersion: number;
    packages: Record<string, { dependencies?: Record<string, string> }>;
  };

  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages['']?.dependencies, pkg.dependencies);

  // Verify .npmrc exists and enables legacy-peer-deps=true
  const npmrcRaw = await fs.readFile(path.join(process.cwd(), '.npmrc'), 'utf8');
  assert.ok(npmrcRaw.includes('legacy-peer-deps=true'), '.npmrc must set legacy-peer-deps=true');
});

// 39. All 22 boards strictly use https://rrb.indianrailways.gov.in/ and retired regional RRB websites are rejected.
test('39. All 22 boards use only https://rrb.indianrailways.gov.in/ and all retired regional RRB domains are blocked', async () => {
  assert.equal(VERIFIED_BOARD_CONFIGS.length, 22);
  assert.deepEqual(Array.from(APPROVED_OFFICIAL_DOMAINS), [
    'rrb.indianrailways.gov.in',
    'www.rrb.indianrailways.gov.in',
  ]);

  for (const board of VERIFIED_BOARD_CONFIGS) {
    assert.equal(
      board.sourceUrl,
      'https://rrb.indianrailways.gov.in/',
      `Board ${board.boardId} sourceUrl must be https://rrb.indianrailways.gov.in/`
    );
    assert.equal(
      board.noticesUrl,
      'https://rrb.indianrailways.gov.in/',
      `Board ${board.boardId} noticesUrl must be https://rrb.indianrailways.gov.in/`
    );
    assert.equal(
      'legacyDomain' in board,
      false,
      `Board ${board.boardId} must not contain legacyDomain`
    );
  }

  // Construct retired regional RRB domain names dynamically and verify every single one is blocked
  const retiredSubdomains = [
    'rrbahmedabad',
    'rrbajmer',
    'rrbald',
    'rrbbnc',
    'rrbbbs',
    'rrbbilaspur',
    'rrbcdg',
    'rrbchennai',
    'rrbgkp',
    'rrbguwahati',
    'rrbkolkata',
    'rrbmalda',
    'rrbmumbai',
    'rrbmuzaffarpur',
    'rrbpatna',
    'rrbranchi',
    'rrbsecunderabad',
    'rrbsiliguri',
    'rrbthiruvananthapuram',
    'rrcb',
  ];
  for (const sub of retiredSubdomains) {
    const legacyUrl = `https://${sub}.gov.in/`;
    const check = isApprovedOfficialUrl(legacyUrl);
    assert.equal(check.allowed, false, `Legacy domain ${legacyUrl} must be rejected`);
    const fetchAttempt = await fetchBoardSource({
      ...VERIFIED_BOARD_CONFIGS[1],
      sourceUrl: legacyUrl,
      noticesUrl: legacyUrl,
    });
    assert.equal(fetchAttempt.fetchResult, 'SSRF_BLOCKED');
  }

  for (const nicSub of ['rrbbpl', 'rrbjammu']) {
    const legacyNicUrl = `https://${nicSub}.nic.in/`;
    const check = isApprovedOfficialUrl(legacyNicUrl);
    assert.equal(check.allowed, false, `Legacy NIC domain ${legacyNicUrl} must be rejected`);
  }
});

// 40. Live-mode scan across all 22 boards requests ONLY https://rrb.indianrailways.gov.in/ and never contacts any old regional site.
test('40. Live-mode scan across all 22 boards requests only https://rrb.indianrailways.gov.in/ and extracts regional notices accurately', async () => {
  const requestedUrls: string[] = [];
  const combinedPortalHtml = buildCombinedUnifiedPortalHtmlFixture();

  const spyLiveFetch: typeof fetch = async (input) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(urlStr);
    assert.equal(
      urlStr,
      'https://rrb.indianrailways.gov.in/',
      `Unexpected outbound request to ${urlStr}; only https://rrb.indianrailways.gov.in/ is permitted`
    );
    return new Response(combinedPortalHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  const summary = await executeAllZonesTest({
    useFixtures: false,
    fetchImpl: spyLiveFetch,
  });

  assert.equal(summary.totalTested, 22);
  assert.equal(summary.counts.PASS, 22);
  assert.equal(summary.counts.FAIL, 0);
  // Shared live fetch cache ensures the single unified portal URL is fetched once per cycle
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], 'https://rrb.indianrailways.gov.in/');

  for (const report of summary.reports) {
    assert.equal(report.configuredSourceUrl, 'https://rrb.indianrailways.gov.in/');
    assert.equal(report.noticesUrl, 'https://rrb.indianrailways.gov.in/');
    assert.ok(report.officialDetailUrl?.startsWith('https://rrb.indianrailways.gov.in/'));
  }
});

// 41. Historical state baselined under retired regional URLs is migrated to https://rrb.indianrailways.gov.in/ with zero duplicate alerts.
test('41. Historical notices from retired regional URLs are migrated cleanly without causing duplicate or old Telegram alerts', async () => {
  const store = new CliMemoryStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Simulate a pre-migration state snapshot where an RRB_AJMER notice was stored with a retired regional URL
  const ajmerNotice = Object.values(store.state.knownNotices).find((n) => n.boardId === 'RRB_AJMER');
  assert.ok(ajmerNotice, 'Expected baselined RRB_AJMER notice');
  const legacyUrl = ['https://', 'rrbajmer', '.gov.in', '/notices/2026/AII_CEN_03_2026_AdmitCard_Notice.pdf'].join('');
  const legacyHashes = computeNoticeHashes({
    boardId: 'RRB_AJMER',
    title: ajmerNotice.title,
    canonicalUrl: legacyUrl,
    attachmentUrls: [legacyUrl],
    publicationDate: ajmerNotice.publicationDate,
    explicitNoticeCode: 'CEN 03/2026-AII',
  });

  const legacyRawState = structuredClone(store.state);
  delete legacyRawState.knownNotices[ajmerNotice.noticeId];
  legacyRawState.knownNotices[legacyHashes.noticeId] = {
    ...ajmerNotice,
    noticeId: legacyHashes.noticeId,
    fingerprint: legacyHashes.fingerprint,
    contentHash: legacyHashes.contentHash,
    officialNoticeUrl: legacyUrl,
    canonicalUrl: legacyUrl,
    attachmentUrls: [legacyUrl],
  };

  const migratedState = validateAndMigrateState(legacyRawState);
  store.state = migratedState;

  // Verify the migrated notice URL now points to https://rrb.indianrailways.gov.in/
  for (const n of Object.values(store.state.knownNotices)) {
    assert.ok(
      n.officialNoticeUrl.startsWith('https://rrb.indianrailways.gov.in/'),
      `Notice URL ${n.officialNoticeUrl} was not migrated to https://rrb.indianrailways.gov.in/`
    );
  }

  // Run a production scan against https://rrb.indianrailways.gov.in/ and confirm 0 duplicate or old alerts are triggered
  const prodRun = await executeMonitorRun(store, {
    mode: 'production',
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
  });
  assert.equal(prodRun.status, 'SUCCESS');
  assert.equal(prodRun.newNoticesEligible, 0);
  assert.equal(prodRun.deliveriesSent, 0);
});

// 42. Keyword filtering matches all 5 required categories case-insensitively with spacing variations and suppresses non-matching notices.
test('42. Keyword filtering matches Recruitment, Examination, Results, Answer Keys, and Next Stages with spacing variations and rejects unrelated notices', async () => {
  assert.ok(DEFAULT_NOTICE_FILTER_KEYWORDS.length >= 30);

  // Verify case-insensitivity and spacing/hyphen variations
  assert.equal(matchesNoticeKeywords({ title: 'CEN 01/2026: CUT-OFF Marks Declared' }).matched, true);
  assert.equal(matchesNoticeKeywords({ title: 'CEN 01/2026: Cut   Off List' }).matched, true);
  assert.equal(matchesNoticeKeywords({ title: 'CEN 01/2026: Cutoff Marks' }).matched, true);
  assert.equal(matchesNoticeKeywords({ title: 'CEN 03/2026: Provisional Answer-Key & Response Sheet' }).matched, true);
  assert.equal(matchesNoticeKeywords({ title: 'CEN 03/2026: AnswerKey Link' }).matched, true);
  assert.equal(matchesNoticeKeywords({ title: 'CEN 04/2026: Normalized Score Card Download' }).matched, true);
  assert.equal(matchesNoticeKeywords({ title: 'CEN 02/2026: Shortlisted for DV and Medical Examination' }).matched, true);
  assert.equal(matchesNoticeKeywords({ title: 'CEN 05/2026: Schedule for PET / PST & Skill Test' }).matched, true);
  assert.equal(
    matchesNoticeKeywords({
      title: 'CEN 06/2026: Important Candidate Update',
      contentText: 'Candidates may download their Hall Ticket and City Intimation slip online.',
    }).matched,
    true
  );

  // Verify word-boundary protection for short acronyms (DV, PET, PST) and unrelated notices
  assert.equal(
    matchesNoticeKeywords({ title: 'Routine Administrative Circular for Office Canteen & Advance Leave' }).matched,
    false
  );
  assert.equal(
    matchesNoticeKeywords({ title: 'Corrigendum to Tender for Competitive Printing & Upstream Network Maintenance' }).matched,
    false
  );

  // Verify end-to-end suppression in executeMonitorRun for non-matching notices vs delivery for matching notices
  const store = new CliMemoryStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const nonMatchingNotice = {
    noticeCode: 'ADMIN-2026-01',
    title: 'Annual Maintenance Contract for Office Air Conditioners at RRB Patna',
    publicationDate: '2026-10-20',
    category: 'General Candidate Notice',
    pdfPath: '/notices/2026/Admin_AMC_Tender.pdf',
  };
  const matchingNotice = {
    noticeCode: 'CEN-2026-PATNA-DV',
    title: 'CEN 02/2026: Schedule for Document Verification (DV) & Medical Examination at RRB Patna',
    publicationDate: '2026-10-20',
    category: 'Document Verification & Panel',
    pdfPath: '/notices/2026/Patna_DV_Medical_Schedule.pdf',
  };

  let sentMessages: string[] = [];
  const runRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_PATNA: {
        body: buildOfficialBoardHtmlFixture('RRB_PATNA', [nonMatchingNotice, matchingNotice]),
      },
    },
    env: {
      TELEGRAM_BOT_TOKEN: '123456789:AAH_TEST_TOKEN_VALID_FORMAT',
      TELEGRAM_CHAT_ID: '-100987654321',
    },
    telegramFetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      sentMessages.push(body.text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 701 } }), { status: 200 });
    },
  });

  assert.equal(runRes.status, 'SUCCESS');
  assert.equal(runRes.newNoticesEligible, 1);
  assert.equal(runRes.deliveriesSent, 1);
  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].includes('Document Verification'));
  assert.equal(sentMessages[0].includes('Air Conditioners'), false);
});

// 43. Configurable filterKeywords and configurable age cutoff (maxNoticeAgeDays / MAX_NOTICE_AGE_DAYS) are enforced.
test('43. Configurable keywords and configurable publication date age cutoff reject notices older than cutoff', async () => {
  const store = new CliMemoryStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-10T10:00:00.000Z',
  });

  // Advance RRB_PATNA watermark to 2026-10-10 so we can test age cutoff specifically on a 5-day-old notice
  store.state.lastSuccessfulNoticeDatesByBoard.RRB_PATNA = '2026-10-10';

  const fiveDaysOldNotice = {
    noticeCode: 'CEN 04/2026-AGE5',
    title: 'CEN 04/2026: Provisional Answer Key & Objection Tracker Link',
    publicationDate: '2026-10-15',
    category: 'Answer Key & Objection Tracker',
    pdfPath: '/notices/2026/Age5_AnswerKey.pdf',
  };
  const freshNotice = {
    noticeCode: 'CEN 04/2026-FRESH',
    title: 'CEN 04/2026: Final Result & Merit List Published',
    publicationDate: '2026-10-20',
    category: 'Result & Cut-Off Marks',
    pdfPath: '/notices/2026/Fresh_Result.pdf',
  };

  // Configure strict 3-day age cutoff and custom keyword list ['merit list']
  const runRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    maxNoticeAgeDays: 3,
    filterKeywords: ['merit list'],
    fixtureOverrides: {
      RRB_PATNA: {
        body: buildOfficialBoardHtmlFixture('RRB_PATNA', [fiveDaysOldNotice, freshNotice]),
      },
    },
    env: {
      TELEGRAM_BOT_TOKEN: '123456789:AAH_TEST_TOKEN_VALID_FORMAT',
      TELEGRAM_CHAT_ID: '-100987654321',
    },
    telegramFetchImpl: async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 702 } }), { status: 200 }),
  });

  // fiveDaysOldNotice is 5 days old (> 3-day cutoff) -> quarantined; freshNotice matches 'merit list' and is 0 days old -> delivered
  assert.equal(runRes.quarantinedNotices, 1);
  assert.equal(runRes.newNoticesEligible, 1);
  assert.equal(runRes.deliveriesSent, 1);
});

// 44. Maximum of 10 notifications per run is strictly enforced and zero duplicates are sent on subsequent runs.
test('44. Maximum of 10 notifications per run is enforced when >10 eligible notices arrive, with zero duplicates on next run', async () => {
  const store = new CliMemoryStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Generate 14 distinct new matching notices for RRB_MUMBAI
  const burstNotices = Array.from({ length: 14 }, (_, idx) => ({
    noticeCode: `CEN-BURST-2026-${idx + 1}`,
    title: `CEN 0${(idx % 5) + 1}/2026: Recruitment Notification & Exam Schedule Batch Item #${idx + 1}`,
    publicationDate: '2026-10-20',
    category: 'Employment Notification (CEN)',
    pdfPath: `/notices/2026/MMCT_Burst_Notice_${idx + 1}.pdf`,
  }));

  let tgMessagesSentRun1 = 0;
  const run1 = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_MUMBAI: {
        body: buildOfficialBoardHtmlFixture('RRB_MUMBAI', burstNotices),
      },
    },
    env: {
      TELEGRAM_BOT_TOKEN: '123456789:AAH_TEST_TOKEN_VALID_FORMAT',
      TELEGRAM_CHAT_ID: '-100987654321',
    },
    telegramFetchImpl: async () => {
      tgMessagesSentRun1 += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 800 + tgMessagesSentRun1 } }), {
        status: 200,
      });
    },
  });

  assert.equal(run1.status, 'SUCCESS');
  assert.equal(run1.newNoticesEligible, 14);
  assert.equal(run1.deliveriesSent, 10);
  assert.equal(tgMessagesSentRun1, 10);

  // Subsequent workflow run with the exact same 14 notices must send 0 duplicate notifications
  let tgMessagesSentRun2 = 0;
  const run2 = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:10:00.000Z',
    fixtureOverrides: {
      RRB_MUMBAI: {
        body: buildOfficialBoardHtmlFixture('RRB_MUMBAI', burstNotices),
      },
    },
    env: {
      TELEGRAM_BOT_TOKEN: '123456789:AAH_TEST_TOKEN_VALID_FORMAT',
      TELEGRAM_CHAT_ID: '-100987654321',
    },
    telegramFetchImpl: async () => {
      tgMessagesSentRun2 += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }), { status: 200 });
    },
  });

  assert.equal(run2.status, 'SUCCESS');
  assert.equal(run2.newNoticesEligible, 0);
  assert.equal(run2.deliveriesSent, 0);
  assert.equal(tgMessagesSentRun2, 0);
});

// 45. Every Telegram alert includes notice title, official website/platform name, publication date, and direct notice link.
test('45. Telegram alert formatting includes notice title, official website/platform name, publication date, and direct notice link', () => {
  const chunks = formatProductionNoticeTelegramMessage(
    {
      deliveryId: 'dlv_test_format_1',
      noticeId: 'RRB_AJMER_123456',
      fingerprint: 'f'.repeat(64),
      boardId: 'RRB_AJMER',
      boardName: 'RRB Ajmer',
      title: 'CEN 03/2026 (JE): Admit Card & City Intimation Link for CBT-1',
      category: 'Admit Card & E-Call Letter',
      publicationDate: '2026-10-20',
      officialNoticeUrl: 'https://rrb.indianrailways.gov.in/notices/2026/AII_JE_AdmitCard.pdf',
      attachmentUrls: ['https://rrb.indianrailways.gov.in/notices/2026/AII_JE_AdmitCard.pdf'],
      status: 'sending',
      attemptCount: 1,
      claimedByRunId: 'run_1',
      claimedAt: '2026-10-20T09:00:00.000Z',
      telegramMessageId: null,
      lastAttemptAt: '2026-10-20T09:00:00.000Z',
      deliveredAt: null,
      lastError: null,
      reconciliationNotes: null,
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
    },
    '2026-10-20T09:00:00.000Z'
  );

  const message = chunks.join('\n\n');
  assert.ok(message.includes('RRB Unified Official Portal (https://rrb.indianrailways.gov.in/)'));
  assert.ok(message.includes('RRB Ajmer'));
  assert.ok(message.includes('CEN 03/2026 (JE): Admit Card &amp; City Intimation Link for CBT-1'));
  assert.ok(message.includes('2026-10-20'));
  assert.ok(message.includes('https://rrb.indianrailways.gov.in/notices/2026/AII_JE_AdmitCard.pdf'));
});

// 46. Regression Test: RRB Guwahati CEN 04/2026 E-Call Letter (23-10-2026) in multi-column portal table is detected, attributed to RRB Guwahati, matches Examination keywords, and is delivered to Telegram.
test('46. Regression: RRB Guwahati CEN 04/2026 E-Call Letter (23-10-2026) in unified portal table is detected and delivered to Telegram', async () => {
  const store = new CliMemoryStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-20T16:35:00.000Z',
  });

  // Build unified portal HTML containing the existing baselined notices PLUS the exact missed RRB Guwahati row
  // in the multi-column official portal table format (RRB | CEN | Title | Description | Publication Date | Action)
  const baseCombinedHtml = buildCombinedUnifiedPortalHtmlFixture();
  const guwahatiPortalRow = `
        <tr>
          <td>Guwahati</td>
          <td>04/2026</td>
          <td>E-Call Letter</td>
          <td>Download link for the first-stage CBT e-call letter for JE/DMS/CMA posts</td>
          <td>23-10-2026</td>
          <td><a href="https://rrb.indianrailways.gov.in/cen-04-2026/GHY_JE_DMS_CMA_CBT1_ECall_Letter.pdf">Download</a></td>
        </tr>`;
  const liveUnifiedPortalHtml = baseCombinedHtml.replace(
    '<tbody>',
    `<tbody>\n${guwahatiPortalRow}`
  );

  // 1. Verify keyword matcher directly matches E-Call Letter under Examination category
  const kwMatch = matchesNoticeKeywords({
    title: 'E-Call Letter',
    contentText: 'Download link for the first-stage CBT e-call letter for JE/DMS/CMA posts',
  });
  assert.equal(kwMatch.matched, true);
  assert.equal(kwMatch.matchedKeyword, 'e-call letter');

  // 2. Run production monitor in LIVE mode (useFixtures: false) with the unified portal HTML response
  const sentTelegramPayloads: string[] = [];
  const liveFetchMock: typeof fetch = async (input) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(urlStr, 'https://rrb.indianrailways.gov.in/');
    return new Response(liveUnifiedPortalHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  const run1 = await executeMonitorRun(store, {
    mode: 'production',
    useFixtures: false,
    nowIso: '2026-10-23T10:00:00.000Z',
    fetchImpl: liveFetchMock,
    env: {
      TELEGRAM_BOT_TOKEN: '123456789:AAH_TEST_TOKEN_VALID_FORMAT',
      TELEGRAM_CHAT_ID: '-100987654321',
    },
    telegramFetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      sentTelegramPayloads.push(body.text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 963 } }), {
        status: 200,
      });
    },
  });

  assert.equal(run1.status, 'SUCCESS');
  assert.equal(run1.boardsScanned, 22);
  assert.equal(run1.boardsSucceeded, 22);
  assert.equal(run1.newNoticesEligible, 1);
  assert.equal(run1.deliveriesSent, 1);
  assert.equal(sentTelegramPayloads.length, 1);

  const alertHtml = sentTelegramPayloads[0];
  assert.ok(alertHtml.includes('RRB Guwahati'), 'Telegram alert must identify RRB Guwahati');
  assert.ok(alertHtml.includes('CEN 04/2026'), 'Telegram alert must include CEN 04/2026');
  assert.ok(alertHtml.includes('E-Call Letter'), 'Telegram alert must include E-Call Letter title');
  assert.ok(
    alertHtml.includes('Download link for the first-stage CBT e-call letter for JE/DMS/CMA posts'),
    'Telegram alert must include the notice description'
  );
  assert.ok(alertHtml.includes('2026-10-23'), 'Telegram alert must include normalized publication date 2026-10-23');
  assert.ok(
    alertHtml.includes('https://rrb.indianrailways.gov.in/cen-04-2026/GHY_JE_DMS_CMA_CBT1_ECall_Letter.pdf'),
    'Telegram alert must include the direct notice link'
  );

  // 3. Verify subsequent run does not re-send duplicate alert
  const run2 = await executeMonitorRun(store, {
    mode: 'production',
    useFixtures: false,
    nowIso: '2026-10-23T10:10:00.000Z',
    fetchImpl: liveFetchMock,
    env: {
      TELEGRAM_BOT_TOKEN: '123456789:AAH_TEST_TOKEN_VALID_FORMAT',
      TELEGRAM_CHAT_ID: '-100987654321',
    },
    telegramFetchImpl: async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 964 } }), { status: 200 }),
  });

  assert.equal(run2.status, 'SUCCESS');
  assert.equal(run2.newNoticesEligible, 0);
  assert.equal(run2.deliveriesSent, 0);
});




