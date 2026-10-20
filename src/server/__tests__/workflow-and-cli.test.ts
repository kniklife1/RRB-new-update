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
  executeAllZonesTest,
  executeBootstrapBaseline,
  executeMonitorRun,
  fetchBoardSource,
} from '../engine.ts';
import { buildCombinedUnifiedPortalHtmlFixture } from '../fixtures/htmlFixtures.ts';
import { computeNoticeHashes } from '../parser.ts';
import {
  createInitialMonitorState,
  getGitHubConfigFromEnv,
  validateAndMigrateState,
} from '../stateStore.ts';
import type { StateEnvelope, StateStoreAdapter } from '../stateStore.ts';
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


