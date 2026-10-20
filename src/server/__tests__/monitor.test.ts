import test from 'node:test';
import assert from 'node:assert/strict';
import { VERIFIED_BOARD_CONFIGS } from '../boards.ts';
import {
  canonicalizeOfficialUrl,
  computeNoticeHashes,
  parseBoardPageContent,
} from '../parser.ts';
import {
  CHALLENGE_PAGE_HTML_FIXTURE,
  SOFT_ERROR_200_HTML_FIXTURE,
  UNEXPECTED_DOM_REGRESSION_FIXTURE,
  buildOfficialBoardHtmlFixture,
} from '../fixtures/htmlFixtures.ts';
import type {
  MonitorState,
} from '../types.ts';
import {
  PersistentStateStore,
  createInitialMonitorState,
} from '../stateStore.ts';
import type {
  StateEnvelope,
  StateStoreAdapter,
} from '../stateStore.ts';
import {
  executeAllZonesTest,
  executeBootstrapBaseline,
  executeMonitorRun,
} from '../engine.ts';
import { verifyEndpointAuth } from '../auth.ts';

/**
 * In-memory deterministic StateStoreAdapter for unit and integration tests.
 */
class InMemoryTestStateStore implements StateStoreAdapter {
  public state: MonitorState = createInitialMonitorState();
  public sha = 'sha-initial-1';
  public failReads = false;
  public failWrites = false;

  async readState(): Promise<StateEnvelope> {
    if (this.failReads) {
      throw new Error('SIMULATED_GITHUB_READ_ERROR');
    }
    return {
      state: structuredClone(this.state),
      sha: this.sha,
      storageBackend: 'github',
      repositoryInfo: {
        configured: true,
        owner: 'test-org',
        repo: 'rrb-state',
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
    if (this.failWrites) {
      throw new Error('SIMULATED_GITHUB_WRITE_ERROR');
    }
    this.state = structuredClone(nextState);
    this.sha = `sha-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return {
      state: structuredClone(this.state),
      sha: this.sha,
      storageBackend: 'github',
      repositoryInfo: {
        configured: true,
        owner: 'test-org',
        repo: 'rrb-state',
        branch: 'main',
        statePath: 'state/notices.json',
      },
    };
  }
}

const mockSuccessTelegramFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ ok: true, result: { message_id: 9001 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const testTelegramEnv = {
  TELEGRAM_BOT_TOKEN: '123456789:AAH_TEST_TOKEN_VALID_FORMAT',
  TELEGRAM_CHAT_ID: '-100987654321',
};

// 1. Initial baseline produces zero individual notice alerts.
test('1. Initial baseline produces zero individual notice alerts', async () => {
  const store = new InMemoryTestStateStore();
  let telegramCalls = 0;
  const result = await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.initialized, true);
  assert.equal(result.individualTelegramAlertsSent, 0);
  assert.equal(telegramCalls, 0);
  assert.ok(result.totalBaselineNoticesRecorded >= 22);
  assert.equal(Object.keys(result.state.pendingDeliveries).length, 0);
});

// 2. Existing notices never become new alerts just because the scraper restarts.
test('2. Existing notices never become new alerts just because the scraper restarts', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Simulate scraper restart and subsequent cron run with same persistent store
  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:10:00.000Z',
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.status, 'SUCCESS');
  assert.equal(cronRes.newNoticesEligible, 0);
  assert.equal(cronRes.deliveriesSent, 0);
});

// 3. Repeated identical notices are deduplicated.
test('3. Repeated identical notices on the same page are deduplicated', () => {
  const board = VERIFIED_BOARD_CONFIGS[0];
  const dupNotice = {
    noticeCode: 'CEN 09/2026',
    title: 'CEN 09/2026: Detailed Notification for Railway Recruitment',
    publicationDate: '2026-10-19',
    category: 'Employment Notification (CEN)',
    pdfPath: '/docs/CEN_09_2026.pdf',
  };
  const html = buildOfficialBoardHtmlFixture(board.boardId, [dupNotice, dupNotice]);
  const parsed = parseBoardPageContent(html, 'text/html', board, '2026-10-19T10:00:00.000Z');

  assert.equal(parsed.parsingResult, 'VALID');
  assert.ok(parsed.duplicatesFound >= 1);
  const matching = parsed.validNotices.filter((n) => n.title.includes('CEN 09/2026'));
  assert.equal(matching.length, 1);
});

// 4. Equivalent canonical URLs map to the same notice identity.
test('4. Equivalent canonical URLs with tracking parameters map to the same notice identity', () => {
  const urlA = canonicalizeOfficialUrl(
    'http://www.rrb.indianrailways.gov.in//cen-2026/Notice1.pdf?utm_source=twitter&id=101&fbclid=xyz#top',
    'https://rrb.indianrailways.gov.in/'
  );
  const urlB = canonicalizeOfficialUrl(
    'https://rrb.indianrailways.gov.in/cen-2026/Notice1.pdf?id=101&_t=9999999',
    'https://rrb.indianrailways.gov.in/'
  );
  assert.equal(urlA, urlB);

  const hashA = computeNoticeHashes({
    boardId: 'RRB_CENTRAL',
    title: 'Official Notice 101',
    canonicalUrl: urlA,
    attachmentUrls: [urlA],
    publicationDate: '2026-10-19',
  });
  const hashB = computeNoticeHashes({
    boardId: 'RRB_CENTRAL',
    title: '  Official   Notice 101 &nbsp; ',
    canonicalUrl: urlB,
    attachmentUrls: [urlB],
    publicationDate: '2026-10-19',
  });

  assert.equal(hashA.noticeId, hashB.noticeId);
  assert.equal(hashA.fingerprint, hashB.fingerprint);
});

// 5. A duplicate notice on two boards does not cause duplicate delivery.
test('5. A duplicate centralized notice across two boards does not cause duplicate delivery', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const sharedCenNotice = {
    noticeCode: 'CEN 08/2026',
    title: 'CEN 08/2026: Common All-India Railway Exam Schedule Notice',
    publicationDate: '2026-10-20',
    category: 'Exam Schedule & City Intimation',
    pdfPath: '/common/CEN_08_2026_Schedule.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T08:00:00.000Z',
    fixtureOverrides: {
      RRB_CENTRAL: {
        body: buildOfficialBoardHtmlFixture('RRB_CENTRAL', [sharedCenNotice]),
      },
      RRB_CHENNAI: {
        body: buildOfficialBoardHtmlFixture('RRB_CHENNAI', [sharedCenNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.status, 'SUCCESS');
  assert.equal(cronRes.newNoticesEligible, 1);
  assert.equal(cronRes.deliveriesSent, 1);
  assert.ok(cronRes.duplicateNoticesSuppressed >= 1);
});

// 6. A genuinely new notice is queued and delivered.
test('6. A genuinely new notice is queued and delivered to Telegram', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  let sentBodies: string[] = [];
  const customTgFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    sentBodies.push(body.text);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 555 } }), {
      status: 200,
    });
  };

  const newMumbaiNotice = {
    noticeCode: 'CEN 03/2026-MMCT-NEW',
    title: 'CEN 03/2026 (JE): Fresh Final Result & Cut-Off Marks for RRB Mumbai',
    publicationDate: '2026-10-20',
    category: 'Result & Cut-Off Marks',
    pdfPath: '/notices/2026/MMCT_JE_Fresh_Final_Result_Oct20.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_MUMBAI: {
        body: buildOfficialBoardHtmlFixture('RRB_MUMBAI', [newMumbaiNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: customTgFetch,
  });

  assert.equal(cronRes.status, 'SUCCESS');
  assert.equal(cronRes.newNoticesEligible, 1);
  assert.equal(cronRes.deliveriesSent, 1);
  assert.equal(sentBodies.length, 1);
  assert.ok(sentBodies[0].includes('NEW RRB OFFICIAL NOTICE'));
  assert.ok(sentBodies[0].includes('RRB Mumbai'));
  assert.ok(sentBodies[0].includes('Fresh Final Result'));
});

// 7. A changed document is detected and classified correctly.
test('7. A changed document (corrigendum/title update on existing noticeId) is detected as a revision', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Modify title of existing RRB_BILASPUR notice while keeping same noticeCode, date, and PDF path
  const revisedBilaspur = {
    noticeCode: 'CEN 02/2026-BSP',
    title: 'CEN 02/2026 (Technicians): REVISED Cut-Off Marks & Updated Roll Numbers Shortlisted for DV (Corrigendum-1)',
    publicationDate: '2026-10-18',
    category: 'Corrigendum & Amendment',
    pdfPath: '/cen2026/BSP_Tech_DV_Shortlist_Cutoff.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_BILASPUR: {
        body: buildOfficialBoardHtmlFixture('RRB_BILASPUR', [revisedBilaspur]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.revisedNoticesEligible, 1);
  assert.equal(cronRes.deliveriesSent, 1);
});

// 8. An old publication date is handled by the conservative policy.
test('8. An old publication date discovered post-baseline is quarantined and not sent as a new alert', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const oldNotice = {
    noticeCode: 'CEN 01/2024-OLD',
    title: 'CEN 01/2024: Archived Historical Panel Notice Exposed via Pagination',
    publicationDate: '2024-05-10',
    category: 'Document Verification & Panel',
    pdfPath: '/archive/2024/Old_Panel_2024.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_PATNA: {
        body: buildOfficialBoardHtmlFixture('RRB_PATNA', [oldNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.newNoticesEligible, 0);
  assert.equal(cronRes.deliveriesSent, 0);
  assert.equal(cronRes.quarantinedNotices, 1);
});

// 9. A missing publication date is not falsely interpreted as proof of novelty.
test('9. A missing publication date is quarantined rather than falsely sent as a new notice', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const datelessHtml = `<!DOCTYPE html><html><body>
    <table class="rrb-notices-table">
      <tr>
        <td>No Date Provided</td>
        <td><a href="https://rrb.indianrailways.gov.in/notices/Undated_Notice_2026.pdf">Important Notice Regarding General Instructions</a></td>
      </tr>
    </table>
  </body></html>`;

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_PATNA: { body: datelessHtml },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.newNoticesEligible, 0);
  assert.equal(cronRes.deliveriesSent, 0);
  assert.equal(cronRes.quarantinedNotices, 1);
});

// 10. A fetch timeout preserves previous state.
test('10. A fetch timeout preserves previous state and marks only that board run as failed', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });
  const countBefore = Object.keys(store.state.knownNotices).length;

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_CHENNAI: { throwTimeout: true },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.boardsFailed, 1);
  assert.equal(Object.keys(store.state.knownNotices).length, countBefore);
  assert.equal(store.state.boardStatuses.RRB_CHENNAI.consecutiveFetchFailures, 1);
});

// 11. An HTTP 500 does not produce a successful empty scan.
test('11. An HTTP 500 error does not produce a successful empty scan', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_KOLKATA: { status: 500, body: 'Internal Server Error' },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.notEqual(cronRes.status, 'SUCCESS');
  assert.equal(cronRes.boardsFailed, 1);
  assert.equal(store.state.boardStatuses.RRB_KOLKATA.lastHttpStatus, 500);
});

// 12. An HTTP 200 error page is rejected by the parser.
test('12. An HTTP 200 challenge or error page is rejected by the parser', () => {
  const board = VERIFIED_BOARD_CONFIGS[0];
  const challengeRes = parseBoardPageContent(
    CHALLENGE_PAGE_HTML_FIXTURE,
    'text/html',
    board,
    '2026-10-20T00:00:00.000Z'
  );
  assert.equal(challengeRes.parsingResult, 'CHALLENGE_OR_BLOCK_PAGE');
  assert.equal(challengeRes.validNotices.length, 0);

  const soft404Res = parseBoardPageContent(
    SOFT_ERROR_200_HTML_FIXTURE,
    'text/html',
    board,
    '2026-10-20T00:00:00.000Z'
  );
  assert.equal(soft404Res.parsingResult, 'CHALLENGE_OR_BLOCK_PAGE');
  assert.equal(soft404Res.validNotices.length, 0);
});

// 13. A parser regression is detected.
test('13. A parser regression (unexpected DOM structure with 0 notices) is detected and reported', () => {
  const board = VERIFIED_BOARD_CONFIGS[0];
  const regRes = parseBoardPageContent(
    UNEXPECTED_DOM_REGRESSION_FIXTURE,
    'text/html',
    board,
    '2026-10-20T00:00:00.000Z'
  );
  assert.equal(regRes.parsingResult, 'UNEXPECTED_STRUCTURE');
  assert.equal(regRes.unexpectedPageStructure, true);
  assert.equal(regRes.validNotices.length, 0);
});

// 14. GitHub API failures stop unsafe notification delivery.
test('14. GitHub API state failures stop unsafe notification delivery (fail-closed)', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  let telegramSent = 0;
  store.failReads = true;

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    env: testTelegramEnv,
    telegramFetchImpl: async () => {
      telegramSent += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    },
  });

  assert.equal(cronRes.status, 'FAILED');
  assert.equal(telegramSent, 0);
});

// 15. GitHub file-SHA conflicts are handled safely.
test('15. GitHub HTTP 409 file-SHA conflicts are resolved safely via state re-read and merge', async () => {
  let putAttempts = 0;
  const baseState = createInitialMonitorState();
  baseState.initialized = true;
  baseState.baselineCompletedAt = '2026-10-19T10:00:00.000Z';

  const mockGitHubFetch: typeof fetch = async (_url, init) => {
    if (!init?.method || init.method === 'GET') {
      const remoteState = structuredClone(baseState);
      remoteState.deliveredNoticeIds = ['REMOTE_DELIVERED_NOTICE_1'];
      const b64 = Buffer.from(JSON.stringify(remoteState), 'utf8').toString('base64');
      return new Response(JSON.stringify({ sha: 'remote-sha-2', content: b64 }), {
        status: 200,
      });
    }
    if (init.method === 'PUT') {
      putAttempts += 1;
      if (putAttempts === 1) {
        return new Response(JSON.stringify({ message: '409 Conflict' }), { status: 409 });
      }
      return new Response(JSON.stringify({ content: { sha: 'merged-sha-3' } }), { status: 200 });
    }
    return new Response(null, { status: 500 });
  };

  const ghStore = new PersistentStateStore({
    env: {
      GITHUB_TOKEN: 'ghp_valid_fine_grained_token_12345',
      GITHUB_OWNER: 'railway-monitor',
      GITHUB_REPO: 'rrb-state',
      GITHUB_BRANCH: 'main',
      GITHUB_STATE_PATH: 'state/notices.json',
    },
    fetchImpl: mockGitHubFetch,
  });

  const localDraft = structuredClone(baseState);
  localDraft.deliveredNoticeIds = ['LOCAL_DELIVERED_NOTICE_2'];

  const written = await ghStore.writeState(localDraft, 'stale-sha-1', 'test conflict merge');
  assert.equal(putAttempts, 2);
  assert.equal(written.sha, 'merged-sha-3');
  assert.ok(written.state.deliveredNoticeIds.includes('REMOTE_DELIVERED_NOTICE_1'));
  assert.ok(written.state.deliveredNoticeIds.includes('LOCAL_DELIVERED_NOTICE_2'));
  assert.equal(written.state.metrics.githubShaConflictsResolved, 1);
});

// 16. Two concurrent scans do not corrupt state or double-claim a notice.
test('16. Two concurrent scans do not corrupt state or double-claim a notice', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Pre-acquire a live lock for run A
  store.state.activeLock = {
    lockId: 'lock_run_A',
    ownerRunId: 'run_A',
    operation: 'cron_scan',
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  // Run B attempts to execute concurrently
  const runB = await executeMonitorRun(store, {
    useFixtures: true,
    runId: 'run_B',
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(runB.status, 'LOCKED');
  assert.equal(runB.httpStatusCode, 409);
  assert.equal(runB.deliveriesSent, 0);
});

// 17. Telegram errors create appropriate delivery statuses.
test('17. Telegram API 4xx/429 errors record failed delivery status and error diagnostics', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const newAjmerNotice = {
    noticeCode: 'CEN 03/2026-AII-NEW',
    title: 'CEN 03/2026 (JE): New Examination Schedule for RRB Ajmer',
    publicationDate: '2026-10-20',
    category: 'Exam Schedule & City Intimation',
    pdfPath: '/notices/2026/AII_New_Schedule.pdf',
  };

  const failingTgFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }),
      { status: 400 }
    );

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_AJMER: {
        body: buildOfficialBoardHtmlFixture('RRB_AJMER', [newAjmerNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: failingTgFetch,
  });

  assert.equal(cronRes.deliveriesFailed, 1);
  assert.equal(Object.keys(store.state.failedDeliveries).length, 1);
});

// 18. Uncertain Telegram delivery is not blindly retried without reconciliation.
test('18. Uncertain Telegram delivery (timeout after dispatch) is quarantined and not blindly retried', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const newRanchiNotice = {
    noticeCode: 'CEN 01/2026-RNC-NEW',
    title: 'CEN 01/2026 (ALP): Final Empanelment List for RRB Ranchi',
    publicationDate: '2026-10-20',
    category: 'Result & Cut-Off Marks',
    pdfPath: '/notices/2026/RNC_ALP_Final_Empanelment_Oct20.pdf',
  };

  let tgCallCount = 0;
  const timeoutTgFetch: typeof fetch = async () => {
    tgCallCount += 1;
    throw new Error('AbortError: network timeout after request sent');
  };

  // First run: times out during Telegram send -> placed into uncertainDeliveries
  const run1 = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_RANCHI: {
        body: buildOfficialBoardHtmlFixture('RRB_RANCHI', [newRanchiNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: timeoutTgFetch,
  });

  assert.equal(run1.deliveriesUncertain, 1);
  assert.equal(tgCallCount, 1);
  assert.equal(Object.keys(store.state.uncertainDeliveries).length, 1);

  // Second run 10 minutes later: must NOT blindly retry the uncertain delivery!
  const run2 = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:10:00.000Z',
    fixtureOverrides: {
      RRB_RANCHI: {
        body: buildOfficialBoardHtmlFixture('RRB_RANCHI', [newRanchiNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(run2.deliveriesSent, 0);
  assert.equal(tgCallCount, 1);
});

// 19. A test run does not change production delivery status.
test('19. An all-zones test run or dry run does not modify production delivery status', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });
  const deliveredBefore = [...store.state.deliveredNoticeIds];

  const newChennaiNotice = {
    noticeCode: 'CEN 03/2026-MAS-DRY',
    title: 'CEN 03/2026 (JE): Dry Run Test Notice for RRB Chennai',
    publicationDate: '2026-10-20',
    category: 'General Candidate Notice',
    pdfPath: '/notices/2026/MAS_DryRun_Test.pdf',
  };

  const dryRes = await executeMonitorRun(store, {
    mode: 'dry_run',
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_CHENNAI: {
        body: buildOfficialBoardHtmlFixture('RRB_CHENNAI', [newChennaiNotice]),
      },
    },
  });

  assert.equal(dryRes.newNoticesEligible, 1);
  assert.equal(dryRes.deliveriesSent, 0);
  assert.deepEqual(store.state.deliveredNoticeIds, deliveredBefore);
  assert.equal(Object.keys(store.state.pendingDeliveries).length, 0);
});

// 20. An unauthorized cron request is rejected.
test('20. An unauthorized cron or admin request is rejected', () => {
  const env = {
    CRON_AUTH_TOKEN: 'super_secret_production_cron_token_999999',
    ADMIN_AUTH_TOKEN: 'super_secret_production_admin_token_888888',
  };

  const missingHeader = verifyEndpointAuth(undefined, 'cron', env);
  assert.equal(missingHeader.authorized, false);

  const wrongToken = verifyEndpointAuth('Bearer invalid_attacker_token_12345', 'cron', env);
  assert.equal(wrongToken.authorized, false);

  const cronTokenOnAdminEndpoint = verifyEndpointAuth(
    'Bearer super_secret_production_cron_token_999999',
    'admin',
    env
  );
  assert.equal(cronTokenOnAdminEndpoint.authorized, false);

  const validCron = verifyEndpointAuth(
    'Bearer super_secret_production_cron_token_999999',
    'cron',
    env
  );
  assert.equal(validCron.authorized, true);
});

// 21. An incomplete baseline cannot activate production alerts.
test('21. An incomplete baseline cannot activate production alerts', async () => {
  const store = new InMemoryTestStateStore();
  // Fail RRB_MALDA during initial bootstrap
  const bootRes = await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
    fixtureOverrides: {
      RRB_MALDA: { status: 503, body: 'Service Unavailable' },
    },
  });

  assert.equal(bootRes.status, 'PARTIAL_INCOMPLETE');
  assert.equal(bootRes.initialized, false);
  assert.equal(bootRes.baselineCompletedAt, null);

  // Subsequent cron run must refuse to send production alerts until baseline completes
  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:10:00.000Z',
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.status, 'BASELINE_REQUIRED');
  assert.equal(cronRes.httpStatusCode, 412);
  assert.equal(cronRes.deliveriesSent, 0);
});

// 22. An unavailable board is correctly reported.
test('22. An unavailable board is explicitly reported as FAIL in the all-zones test', async () => {
  const summary = await executeAllZonesTest({
    useFixtures: true,
    fixtureOverrides: {
      RRB_GORAKHPUR: { status: 502, body: 'Bad Gateway' },
    },
  });

  const gkp = summary.reports.find((r) => r.boardId === 'RRB_GORAKHPUR');
  assert.ok(gkp);
  assert.equal(gkp.verdict, 'FAIL');
  assert.equal(gkp.httpStatus, 502);
  assert.equal(summary.counts.FAIL, 1);
  assert.equal(summary.counts.PASS, VERIFIED_BOARD_CONFIGS.length - 1);
});

// 23. A recovery scan does not flood Telegram with historical notices.
test('23. A board recovery scan baselines historical items instead of flooding Telegram', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Simulate that RRB_GUWAHATI had consecutive fetch failures and discovered an older historical notice on recovery
  store.state.boardStatuses.RRB_GUWAHATI.consecutiveFetchFailures = 3;

  const historicalGuwahatiNotice = {
    noticeCode: 'CEN 02/2026-GHY-HIST',
    title: 'CEN 02/2026 (Technicians): Historical Notice from Early October',
    publicationDate: '2026-10-05',
    category: 'General Candidate Notice',
    pdfPath: '/notices/2026/GHY_Hist_Oct05.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_GUWAHATI: {
        body: buildOfficialBoardHtmlFixture('RRB_GUWAHATI', [historicalGuwahatiNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.newNoticesEligible, 0);
  assert.equal(cronRes.deliveriesSent, 0);
});

// 24. A successful run updates durable operational history.
test('24. A successful run updates durable operational history and timestamps', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.status, 'SUCCESS');
  assert.ok(store.state.lastSuccessfulRunAt);
  assert.ok(store.state.recentRunHistory.length >= 2);
  assert.equal(store.state.recentRunHistory[0].mode, 'cron');
  assert.equal(store.state.recentRunHistory[0].status, 'SUCCESS');
});

// 25. Every enabled board has an explicit test result.
test('25. Every enabled board (all 22 configured boards) has an explicit test result with latest notice metadata', async () => {
  const summary = await executeAllZonesTest({
    useFixtures: true,
  });

  const enabledBoards = VERIFIED_BOARD_CONFIGS.filter((b) => b.enabled);
  assert.equal(summary.totalBoardsConfigured, 22);
  assert.equal(summary.reports.length, enabledBoards.length);
  assert.equal(summary.counts.PASS, 22);

  for (const report of summary.reports) {
    assert.equal(report.verdict, 'PASS');
    assert.ok(report.latestParsedNoticeTitle && report.latestParsedNoticeTitle.length > 10);
    assert.ok(report.officialDetailUrl && report.officialDetailUrl.startsWith('https://'));
    assert.ok(report.newestValidPublicationDate);
  }
});

// 26. Future typo publication date (>2 days ahead) is quarantined and never poisons the board watermark.
test('26. Future typo publication date is quarantined and does not poison the board watermark', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const futureTypoNotice = {
    noticeCode: 'CEN 99/2027-TYPO',
    title: 'CEN 99/2027: Notice With Typo Future Date 2027',
    publicationDate: '2027-05-01',
    category: 'General Candidate Notice',
    pdfPath: '/notices/2026/Typo_2027.pdf',
  };
  const validTodayNotice = {
    noticeCode: 'CEN 04/2026-VALID',
    title: 'CEN 04/2026: Valid Today Notice After Typo Row',
    publicationDate: '2026-10-20',
    category: 'Result & Cut-Off Marks',
    pdfPath: '/notices/2026/Valid_Oct20.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_AHMEDABAD: {
        body: buildOfficialBoardHtmlFixture('RRB_AHMEDABAD', [futureTypoNotice, validTodayNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.quarantinedNotices, 1);
  assert.equal(cronRes.newNoticesEligible, 1);
  assert.equal(cronRes.deliveriesSent, 1);
  assert.equal(store.state.lastSuccessfulNoticeDatesByBoard.RRB_AHMEDABAD, '2026-10-20');
});

// 27. Pre-delivery GitHub state checkpoint failure halts before calling Telegram API.
test('27. Pre-delivery state checkpoint write failure halts before Telegram dispatch (zero duplicate alerts)', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Allow lock acquisition write (write #1), but fail the pre-delivery claim checkpoint (write #2)
  let writeCount = 0;
  const origWrite = store.writeState.bind(store);
  store.writeState = async (nextState, sha, msg) => {
    writeCount += 1;
    if (writeCount === 2) {
      throw new Error('SIMULATED_PRE_DELIVERY_CHECKPOINT_FAILURE');
    }
    return origWrite(nextState, sha, msg);
  };

  let tgCalls = 0;
  const newNotice = {
    noticeCode: 'CEN 05/2026-BPL-CHK',
    title: 'CEN 05/2026: Bhopal Notice Testing Pre-Delivery Checkpoint',
    publicationDate: '2026-10-20',
    category: 'Result & Cut-Off Marks',
    pdfPath: '/notices/2026/BPL_Checkpoint.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_BHOPAL: {
        body: buildOfficialBoardHtmlFixture('RRB_BHOPAL', [newNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: async () => {
      tgCalls += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    },
  });

  assert.equal(cronRes.status, 'FAILED');
  assert.equal(cronRes.httpStatusCode, 503);
  assert.equal(tgCalls, 0);
  assert.equal(cronRes.deliveriesSent, 0);
});

// 28. Interrupted mid-flight 'sending' item from a crashed run is quarantined into uncertainDeliveries.
test('28. Interrupted mid-flight sending item from a prior crashed run is quarantined as uncertain', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Simulate an item left in 'sending' state by crashed run 'crashed_run_99'
  store.state.pendingDeliveries['dlv_crashed_1'] = {
    deliveryId: 'dlv_crashed_1',
    noticeId: 'RRB_CENTRAL_crashed1',
    fingerprint: 'a'.repeat(64),
    boardId: 'RRB_CENTRAL',
    boardName: 'RRCB / Unified Central Portal (All-India CEN)',
    title: 'CEN 01/2026: Notice Claimed By Crashed Worker',
    category: 'General Candidate Notice',
    publicationDate: '2026-10-20',
    officialNoticeUrl: 'https://rrb.indianrailways.gov.in/notices/crashed.pdf',
    attachmentUrls: ['https://rrb.indianrailways.gov.in/notices/crashed.pdf'],
    status: 'sending',
    attemptCount: 1,
    claimedByRunId: 'crashed_run_99',
    claimedAt: '2026-10-20T08:50:00.000Z',
    telegramMessageId: null,
    lastAttemptAt: '2026-10-20T08:50:00.000Z',
    deliveredAt: null,
    lastError: null,
    reconciliationNotes: null,
    createdAt: '2026-10-20T08:50:00.000Z',
    updatedAt: '2026-10-20T08:50:00.000Z',
  };

  let tgCalls = 0;
  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    env: testTelegramEnv,
    telegramFetchImpl: async () => {
      tgCalls += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    },
  });

  assert.equal(tgCalls, 0);
  assert.equal(cronRes.deliveriesUncertain, 1);
  assert.ok(store.state.uncertainDeliveries['dlv_crashed_1']);
  assert.equal(store.state.pendingDeliveries['dlv_crashed_1'], undefined);
});

// 29. Concurrent lock acquisition race during HTTP 409 SHA conflict preserves remote lock winner.
test('29. Concurrent lock acquisition race during HTTP 409 conflict rejects the losing run', async () => {
  const baseState = createInitialMonitorState();
  baseState.initialized = true;
  baseState.baselineCompletedAt = '2026-10-19T10:00:00.000Z';

  let putCalls = 0;
  const mockRaceFetch: typeof fetch = async (_url, init) => {
    if (!init?.method || init.method === 'GET') {
      const remoteState = structuredClone(baseState);
      if (putCalls >= 1) {
        // After first PUT (409), remote already has an active lock owned by 'winner_run_A'
        remoteState.activeLock = {
          lockId: 'lock_winner_run_A',
          ownerRunId: 'winner_run_A',
          operation: 'cron_scan',
          acquiredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      }
      const b64 = Buffer.from(JSON.stringify(remoteState), 'utf8').toString('base64');
      return new Response(JSON.stringify({ sha: `sha-${putCalls}`, content: b64 }), {
        status: 200,
      });
    }
    if (init.method === 'PUT') {
      putCalls += 1;
      if (putCalls === 1) {
        return new Response(JSON.stringify({ message: '409 Conflict' }), { status: 409 });
      }
      return new Response(JSON.stringify({ content: { sha: 'sha-after-merge' } }), { status: 200 });
    }
    return new Response(null, { status: 500 });
  };

  const ghStore = new PersistentStateStore({
    env: {
      GITHUB_TOKEN: 'ghp_valid_fine_grained_token_12345',
      GITHUB_OWNER: 'railway-monitor',
      GITHUB_REPO: 'rrb-state',
      GITHUB_BRANCH: 'main',
      GITHUB_STATE_PATH: 'state/notices.json',
    },
    fetchImpl: mockRaceFetch,
  });

  const loserRun = await executeMonitorRun(ghStore, {
    useFixtures: true,
    runId: 'loser_run_B',
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(loserRun.status, 'LOCKED');
  assert.equal(loserRun.httpStatusCode, 409);
  assert.equal(loserRun.deliveriesSent, 0);
});

// 30. Reconciling an uncertain delivery ('mark_sent' vs 'requeue_retry') prevents duplicates or re-sends once.
test('30. Reconciling an uncertain delivery updates deduplication hashes or requeues safely', async () => {
  const { reconcileUncertainDelivery } = await import('../engine.ts');
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const notice = {
    noticeCode: 'CEN 07/2026-SC-UNC',
    title: 'CEN 07/2026: Secunderabad Uncertain Notice Test',
    publicationDate: '2026-10-20',
    category: 'Result & Cut-Off Marks',
    pdfPath: '/notices/2026/SC_Uncertain.pdf',
  };

  // Run 1: Timeout -> uncertain
  await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_SECUNDERABAD: {
        body: buildOfficialBoardHtmlFixture('RRB_SECUNDERABAD', [notice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: async () => {
      throw new Error('AbortError: timeout');
    },
  });

  const uncertainIds = Object.keys(store.state.uncertainDeliveries);
  assert.equal(uncertainIds.length, 1);

  // Reconcile as 'mark_sent'
  const reconciledState = await reconcileUncertainDelivery(
    store,
    uncertainIds[0],
    'mark_sent',
    'Confirmed visible in Telegram channel'
  );
  assert.equal(Object.keys(reconciledState.uncertainDeliveries).length, 0);
  assert.equal(reconciledState.metrics.totalTelegramDelivered, 1);

  // Run 2: Same notice still on board -> must be suppressed as already known/delivered!
  const run2 = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:10:00.000Z',
    fixtureOverrides: {
      RRB_SECUNDERABAD: {
        body: buildOfficialBoardHtmlFixture('RRB_SECUNDERABAD', [notice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });
  assert.equal(run2.deliveriesSent, 0);
});

// 31. Unbaselined individual board baselines all notices on first scan without alerting.
test('31. Unbaselined individual board baselines all notices on first scan without alerting', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  // Simulate RRB_SILIGURI being newly added/unbaselined with a brand new notice dated today
  store.state.boardStatuses.RRB_SILIGURI.baselined = false;
  const freshSiliguriNotice = {
    noticeCode: 'CEN 09/2026-SGUJ-INIT',
    title: 'CEN 09/2026: Siliguri Notice Present When Board First Enabled',
    publicationDate: '2026-10-20',
    category: 'General Candidate Notice',
    pdfPath: '/notices/2026/SGUJ_Init.pdf',
  };

  const cronRes = await executeMonitorRun(store, {
    useFixtures: true,
    nowIso: '2026-10-20T09:00:00.000Z',
    fixtureOverrides: {
      RRB_SILIGURI: {
        body: buildOfficialBoardHtmlFixture('RRB_SILIGURI', [freshSiliguriNotice]),
      },
    },
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(cronRes.newNoticesEligible, 0);
  assert.equal(cronRes.deliveriesSent, 0);
  assert.equal(store.state.boardStatuses.RRB_SILIGURI.baselined, true);
});

// 32. Bounded batch size returns HTTP 206 PARTIAL_BATCH and resumes remaining boards on next run.
test('32. Bounded batch size returns HTTP 206 PARTIAL_BATCH and completes remaining boards on next run', async () => {
  const store = new InMemoryTestStateStore();
  await executeBootstrapBaseline(store, {
    useFixtures: true,
    nowIso: '2026-10-19T10:00:00.000Z',
  });

  const batch1 = await executeMonitorRun(store, {
    useFixtures: true,
    maxBoardsPerBatch: 12,
    nowIso: '2026-10-20T09:00:00.000Z',
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(batch1.status, 'PARTIAL_BATCH');
  assert.equal(batch1.httpStatusCode, 206);
  assert.equal(batch1.boardsScanned, 12);
  assert.equal(batch1.remainingBoardsInQueue, 10);

  const batch2 = await executeMonitorRun(store, {
    useFixtures: true,
    maxBoardsPerBatch: 12,
    nowIso: '2026-10-20T09:10:00.000Z',
    env: testTelegramEnv,
    telegramFetchImpl: mockSuccessTelegramFetch,
  });

  assert.equal(batch2.status, 'SUCCESS');
  assert.equal(batch2.httpStatusCode, 200);
  assert.equal(batch2.boardsScanned, 10);
  assert.equal(batch2.remainingBoardsInQueue, 0);
});

