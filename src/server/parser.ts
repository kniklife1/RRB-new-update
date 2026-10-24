import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type {
  BoardConfig,
  DateConfidence,
  NormalizedNotice,
  NoticeCategory,
} from './types.ts';
import {
  CURRENT_PARSER_VERSION,
  VERIFIED_BOARD_CONFIGS,
  isApprovedOfficialUrl,
} from './boards.ts';

/**
 * Tracking query parameters that must be stripped when canonicalizing official URLs.
 * Document-identifying query parameters (such as id, doc, cen, file, notice_no, code) are preserved.
 */
const IRRELEVANT_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  '_ga',
  '_gl',
  'sessionid',
  'jsessionid',
  'phpsessid',
  'timestamp',
  '_t',
  'rand',
  'nocache',
]);

/**
 * Normalizes whitespace, HTML entities, and Unicode to NFC form consistently.
 */
export function normalizeText(raw: string): string {
  if (!raw) return '';
  return raw
    .normalize('NFC')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves and canonicalizes a URL against a base URL, removing tracking parameters
 * while preserving parameters that identify the actual official document.
 */
export function canonicalizeOfficialUrl(rawUrl: string, baseUrl: string): string {
  try {
    const cleanedRaw = rawUrl.trim().replace(/\\/g, '/');
    const resolved = new URL(cleanedRaw, baseUrl);
    resolved.hash = '';
    // Normalize hostname to lowercase and strip leading www. for canonical equivalence
    resolved.hostname = resolved.hostname.toLowerCase().replace(/^www\./, '');
    // Normalize protocol to https for official railway domains
    if (resolved.protocol === 'http:') {
      resolved.protocol = 'https:';
    }
    // Strip irrelevant tracking parameters and sort remaining query parameters deterministically
    const keptParams: Array<[string, string]> = [];
    resolved.searchParams.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!IRRELEVANT_QUERY_PARAMS.has(lowerKey)) {
        keptParams.push([key, value.trim()]);
      }
    });
    keptParams.sort((a, b) => a[0].localeCompare(b[0]));
    resolved.search = '';
    for (const [k, v] of keptParams) {
      resolved.searchParams.append(k, v);
    }
    // Collapse multiple slashes in pathname
    resolved.pathname = resolved.pathname.replace(/\/{2,}/g, '/');
    if (resolved.pathname.length > 1 && resolved.pathname.endsWith('/')) {
      resolved.pathname = resolved.pathname.slice(0, -1);
    }
    return resolved.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Extracts and validates a publication date from official text or date columns.
 * Never substitutes current scrape time for missing publication dates.
 */
export function parseOfficialPublicationDate(rawDateText: string): {
  publicationDate: string | null;
  confidence: DateConfidence;
} {
  const text = normalizeText(rawDateText);
  if (!text) {
    return { publicationDate: null, confidence: 'NONE' };
  }

  // Pattern 1: ISO YYYY-MM-DD (e.g. 2026-10-18 or 2026/10/18)
  const isoMatch = text.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    if (isValidCalendarDate(Number(year), Number(month), Number(day))) {
      return { publicationDate: `${year}-${month}-${day}`, confidence: 'HIGH' };
    }
  }

  // Pattern 2: Indian standard DD-MM-YYYY or DD.MM.YYYY or DD/MM/YYYY
  const dmyMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    if (isValidCalendarDate(Number(year), Number(month), Number(day))) {
      return { publicationDate: `${year}-${month}-${day}`, confidence: 'HIGH' };
    }
  }

  // Pattern 3: DD Month YYYY or Month DD, YYYY (e.g., 19 Oct 2026, October 19, 2026)
  const monthNames: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };

  const wordDmy = text.match(
    /\b(0?[1-9]|[12]\d|3[01])(?:\s*(?:st|nd|rd|th))?\s+([A-Za-z]{3,9})[,.\s]+(20\d{2})\b/i
  );
  if (wordDmy) {
    const day = wordDmy[1].padStart(2, '0');
    const monthKey = wordDmy[2].toLowerCase();
    const year = wordDmy[3];
    const month = monthNames[monthKey];
    if (month && isValidCalendarDate(Number(year), Number(month), Number(day))) {
      return {
        publicationDate: `${year}-${month}-${day}`,
        confidence: text.length <= 40 ? 'HIGH' : 'MEDIUM',
      };
    }
  }

  // Pattern 3B: Month DD, YYYY (e.g., October 19, 2026 or Oct 19, 2026)
  const wordMdy = text.match(
    /\b([A-Za-z]{3,9})\.?\s+(0?[1-9]|[12]\d|3[01])(?:\s*(?:st|nd|rd|th))?[,.\s]+(20\d{2})\b/i
  );
  if (wordMdy) {
    const monthKey = wordMdy[1].toLowerCase();
    const day = wordMdy[2].padStart(2, '0');
    const year = wordMdy[3];
    const month = monthNames[monthKey];
    if (month && isValidCalendarDate(Number(year), Number(month), Number(day))) {
      return {
        publicationDate: `${year}-${month}-${day}`,
        confidence: text.length <= 40 ? 'HIGH' : 'MEDIUM',
      };
    }
  }

  // Pattern 4: Short DD-MM-YY (lower confidence)
  const shortDmy = text.match(/\b(0[1-9]|[12]\d|3[01])[-/.](0[1-9]|1[0-2])[-/.](\d{2})\b/);
  if (shortDmy) {
    const day = shortDmy[1];
    const month = shortDmy[2];
    const year = `20${shortDmy[3]}`;
    if (isValidCalendarDate(Number(year), Number(month), Number(day))) {
      return { publicationDate: `${year}-${month}-${day}`, confidence: 'LOW' };
    }
  }

  return { publicationDate: null, confidence: 'NONE' };
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 2015 || year > 2035) return false;
  if (month < 1 || month > 12) return false;
  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= maxDays;
}

/**
 * Classifies an official RRB notice into one of the standard candidate categories.
 */
export function classifyNoticeCategory(title: string, rawCategory?: string): NoticeCategory {
  const combined = `${rawCategory || ''} ${title}`.toLowerCase();

  if (/\b(corrigendum|amendment|addendum|errata|modification)\b/.test(combined)) {
    return 'Corrigendum & Amendment';
  }
  if (/\b(answer\s*key|question\s*paper|objection\s*tracker|response\s*sheet)\b/.test(combined)) {
    return 'Answer Key & Objection Tracker';
  }
  if (/\b(admit\s*card|e-?call\s*letter|call\s*letter|hall\s*ticket)\b/.test(combined)) {
    return 'Admit Card & E-Call Letter';
  }
  if (/\b(document\s*verification|\bdv\b|medical\s*examination|empanelment|provisional\s*panel|replacement\s*panel|additional\s*panel)\b/.test(combined)) {
    return 'Document Verification & Panel';
  }
  if (/\b(result|shortlisted|cut[\s-]*off|merit\s*list|score\s*card|marks)\b/.test(combined)) {
    return 'Result & Cut-Off Marks';
  }
  if (/\b(exam\s*schedule|cbt\s*schedule|city\s*intimation|exam\s*date|tentative\s*schedule|phase[\s-]*[i123v]+)\b/.test(combined)) {
    return 'Exam Schedule & City Intimation';
  }
  if (/\b(detailed\s*cen|centralised\s*employment\s*notice|centralized\s*employment|recruitment\s*notification|vacancy\s*notification|indicative\s*notice)\b/.test(combined)) {
    return 'Employment Notification (CEN)';
  }
  return 'General Candidate Notice';
}

/**
 * Computes deterministic SHA-256 notice identity and content hashes.
 * Never includes current scrape time, list index, or volatile query parameters.
 */
export function computeNoticeHashes(params: {
  boardId: string;
  title: string;
  canonicalUrl: string;
  attachmentUrls: string[];
  publicationDate: string | null;
  explicitNoticeCode?: string | null;
}): {
  noticeId: string;
  fingerprint: string;
  contentHash: string;
  crossBoardDocumentKey: string;
} {
  const normalizedTitle = normalizeText(params.title).toLowerCase();
  const primaryDocUrl =
    params.attachmentUrls.length > 0
      ? params.attachmentUrls[0]
      : params.canonicalUrl;

  // Stable identity prefers official document URL or explicit notice code + board
  const identitySeed = [
    params.boardId.toUpperCase(),
    params.explicitNoticeCode ? normalizeText(params.explicitNoticeCode).toUpperCase() : '',
    primaryDocUrl,
    params.publicationDate || 'NO_DATE',
  ].join('||');

  const noticeIdHash = crypto.createHash('sha256').update(identitySeed).digest('hex').slice(0, 24);
  const noticeId = `${params.boardId.toUpperCase()}_${noticeIdHash}`;

  // Deterministic SHA-256 fingerprint across normalized board, title, pubDate, and canonical URL
  const fingerprintSeed = [
    params.boardId.toUpperCase(),
    normalizedTitle,
    params.publicationDate || 'NO_DATE',
    primaryDocUrl,
  ].join('||');
  const fingerprint = crypto.createHash('sha256').update(fingerprintSeed).digest('hex');

  // Content hash captures title + all attachments + publication date to detect document revisions
  const sortedAttachments = [...params.attachmentUrls].sort().join('|');
  const contentSeed = [
    normalizedTitle,
    params.canonicalUrl,
    sortedAttachments,
    params.publicationDate || 'NO_DATE',
  ].join('||');
  const contentHash = crypto.createHash('sha256').update(contentSeed).digest('hex');

  // Cross-board key identifies identical centralized notices posted simultaneously across multiple boards
  // Strips regional board attribution suffixes and zone codes (including longer codes like CENTRAL, ALLAHABAD, or WR-ADI)
  const crossBoardNormalizedTitle = normalizedTitle
    .replace(/\b(cen\s*(?:no\.?)?\s*\d{2}\/\d{4})-(?:[a-z0-9]{2,15})(?:-[a-z0-9]{2,10})?\b/gi, '$1')
    .replace(/\(\s*rrb\s+[a-z\s&-]+\)/gi, '')
    .replace(/\bfor\s+rrb\s+[a-z\s&-]+$/gi, '')
    .replace(/[-–—]\s*rrb\s+[a-z\s&-]+$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const crossBoardSeed = [
    crossBoardNormalizedTitle,
    params.publicationDate || 'NO_DATE',
  ].join('||');
  const crossBoardDocumentKey = crypto.createHash('sha256').update(crossBoardSeed).digest('hex');

  return { noticeId, fingerprint, contentHash, crossBoardDocumentKey };
}

export interface ParsedPageDiagnostics {
  parsingResult:
    | 'VALID'
    | 'EMPTY_OR_SUSPICIOUS'
    | 'CHALLENGE_OR_BLOCK_PAGE'
    | 'UNEXPECTED_STRUCTURE'
    | 'PARSE_ERROR';
  rawRowsDetected: number;
  validNotices: NormalizedNotice[];
  duplicatesFound: number;
  paginationChecked: boolean;
  paginationLinks: string[];
  unexpectedPageStructure: boolean;
  errorCategory: string | null;
  diagnosticMessage: string;
}

const BOARD_NAME_TO_ID_MAP: Array<{ pattern: RegExp; boardId: string }> = [
  { pattern: /^(?:rrb\s+)?ahmedabad(?:\s*\([^)]*\))?$/i, boardId: 'RRB_AHMEDABAD' },
  { pattern: /^(?:rrb\s+)?ajmer(?:\s*\([^)]*\))?$/i, boardId: 'RRB_AJMER' },
  { pattern: /^(?:rrb\s+)?(?:prayagraj|allahabad|prayagraj\s*\(allahabad\)|allahabad\s*\(prayagraj\))$/i, boardId: 'RRB_ALLAHABAD' },
  { pattern: /^(?:rrb\s+)?(?:bengaluru|bangalore|bengaluru\s*\(bangalore\)|bangalore\s*\(bengaluru\))$/i, boardId: 'RRB_BANGALORE' },
  { pattern: /^(?:rrb\s+)?bhopal(?:\s*\([^)]*\))?$/i, boardId: 'RRB_BHOPAL' },
  { pattern: /^(?:rrb\s+)?bhubaneswar(?:\s*\([^)]*\))?$/i, boardId: 'RRB_BHUBANESWAR' },
  { pattern: /^(?:rrb\s+)?bilaspur(?:\s*\([^)]*\))?$/i, boardId: 'RRB_BILASPUR' },
  { pattern: /^(?:rrb\s+)?chandigarh(?:\s*\([^)]*\))?$/i, boardId: 'RRB_CHANDIGARH' },
  { pattern: /^(?:rrb\s+)?chennai(?:\s*\([^)]*\))?$/i, boardId: 'RRB_CHENNAI' },
  { pattern: /^(?:rrb\s+)?gorakhpur(?:\s*\([^)]*\))?$/i, boardId: 'RRB_GORAKHPUR' },
  { pattern: /^(?:rrb\s+)?guwahati(?:\s*\([^)]*\))?$/i, boardId: 'RRB_GUWAHATI' },
  { pattern: /^(?:rrb\s+)?(?:jammu(?:[-\s/]*srinagar)?|srinagar)(?:\s*\([^)]*\))?$/i, boardId: 'RRB_JAMMU' },
  { pattern: /^(?:rrb\s+)?kolkata(?:\s*\([^)]*\))?$/i, boardId: 'RRB_KOLKATA' },
  { pattern: /^(?:rrb\s+)?malda(?:\s*\([^)]*\))?$/i, boardId: 'RRB_MALDA' },
  { pattern: /^(?:rrb\s+)?mumbai(?:\s*\([^)]*\))?$/i, boardId: 'RRB_MUMBAI' },
  { pattern: /^(?:rrb\s+)?muzaffarpur(?:\s*\([^)]*\))?$/i, boardId: 'RRB_MUZAFFARPUR' },
  { pattern: /^(?:rrb\s+)?patna(?:\s*\([^)]*\))?$/i, boardId: 'RRB_PATNA' },
  { pattern: /^(?:rrb\s+)?ranchi(?:\s*\([^)]*\))?$/i, boardId: 'RRB_RANCHI' },
  { pattern: /^(?:rrb\s+)?secunderabad(?:\s*\([^)]*\))?$/i, boardId: 'RRB_SECUNDERABAD' },
  { pattern: /^(?:rrb\s+)?siliguri(?:\s*\([^)]*\))?$/i, boardId: 'RRB_SILIGURI' },
  { pattern: /^(?:rrb\s+)?(?:thiruvananthapuram|trivandrum|thiruvananthapuram\s*\(trivandrum\))$/i, boardId: 'RRB_THIRUVANANTHAPURAM' },
  { pattern: /^(?:rrcb|all\s*rrbs?|central|unified\s*central\s*portal|all[-\s]*india(?:\s*cen)?)$/i, boardId: 'RRB_CENTRAL' },
];

export function matchBoardCellToBoardId(rawCellText: string): string | null {
  const cleaned = normalizeText(rawCellText);
  if (!cleaned || cleaned.length > 45) return null;
  for (const entry of BOARD_NAME_TO_ID_MAP) {
    if (entry.pattern.test(cleaned)) {
      return entry.boardId;
    }
  }
  return null;
}

export function normalizeNoticeCodeCell(rawCellText: string): string | null {
  const cleaned = normalizeText(rawCellText);
  if (!cleaned || cleaned.length > 40) return null;

  // Bare CEN number in a dedicated CEN column, e.g. "04/2026" or "04/2026-GHY"
  if (/^\d{2}\/20\d{2}(?:-[A-Z0-9-]+)?$/i.test(cleaned)) {
    return `CEN ${cleaned}`;
  }

  // Explicit CEN / RRC / Notice / Admin prefix
  if (
    /^(?:CEN\s*(?:No\.?)?\s*[-:]?\s*\d{2}\/20\d{2}(?:-[A-Z0-9-]+)?|CEN-[A-Z0-9-]+|RRC\s*(?:No\.?)?\s*[-:]?\s*\d{2}\/20\d{2}(?:-[A-Z0-9-]+)?|Notice[-/\s#.]*\d+[A-Za-z0-9/-]*|ADMIN-\d{4}-\d+)$/i.test(
      cleaned
    )
  ) {
    return cleaned.replace(/^cen\s+/i, 'CEN ');
  }

  return null;
}

function isSerialNumberCell(rawCellText: string): boolean {
  const cleaned = normalizeText(rawCellText);
  return /^(?:#|s\.?\s*no\.?|sr\.?\s*no\.?|\d{1,4}[.)]?)$/i.test(cleaned);
}

function isActionOrDownloadCell(rawCellText: string, hasAnchor: boolean): boolean {
  if (!hasAnchor) return false;
  const cleaned = normalizeText(rawCellText);
  return /^(?:pdf|download(?:\s+(?:pdf|link|notice|e-?call\s*letter|admit\s*card|file))?|click\s*here(?:\s+to\s+[\w\s-]+)?|view(?:\s+(?:pdf|notice|link|details))?|link|open|action|english|hindi|english\s*\/\s*hindi)(?:\s*\([^)]*\))?$/i.test(
    cleaned
  );
}

/**
 * Validates and parses HTML or embedded JSON from an official RRB page into NormalizedNotice items.
 * Rejects HTTP 200 error pages, WAF challenges, login gates, and empty shells.
 */
export function parseBoardPageContent(
  rawBody: string,
  contentType: string | null,
  board: BoardConfig,
  observedAtIso: string
): ParsedPageDiagnostics {
  const trimmed = (rawBody || '').trim();
  if (!trimmed || trimmed.length < 40) {
    return {
      parsingResult: 'EMPTY_OR_SUSPICIOUS',
      rawRowsDetected: 0,
      validNotices: [],
      duplicatesFound: 0,
      paginationChecked: false,
      paginationLinks: [],
      unexpectedPageStructure: true,
      errorCategory: 'EMPTY_BODY',
      diagnosticMessage: 'Response body is empty or suspiciously short (< 40 bytes).',
    };
  }

  // Detect WAF / Challenge / Captcha / HTTP-200 Soft Error / Login Gate pages
  const lowerBody = trimmed.toLowerCase();
  if (
    lowerBody.includes('attention required! | cloudflare') ||
    lowerBody.includes('cf-browser-verification') ||
    lowerBody.includes('checking your browser before accessing') ||
    lowerBody.includes('access denied - national informatics centre') ||
    lowerBody.includes('service unavailable - zero size object') ||
    lowerBody.includes('404 - file or directory not found') ||
    lowerBody.includes('runtime error in application') ||
    (lowerBody.includes('<form') &&
      lowerBody.includes('type="password"') &&
      !lowerBody.includes('notice') &&
      !lowerBody.includes('cen'))
  ) {
    return {
      parsingResult: 'CHALLENGE_OR_BLOCK_PAGE',
      rawRowsDetected: 0,
      validNotices: [],
      duplicatesFound: 0,
      paginationChecked: false,
      paginationLinks: [],
      unexpectedPageStructure: true,
      errorCategory: 'CHALLENGE_OR_SOFT_ERROR_PAGE',
      diagnosticMessage:
        'Rejected HTTP 200 page because it matches a WAF challenge, login gate, or server error template.',
    };
  }

  // Strategy 1: Direct JSON feed if content-type is JSON or body starts with JSON object
  if (
    (contentType && contentType.toLowerCase().includes('application/json')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      const parsedJson = JSON.parse(trimmed);
      return parseStructuredJsonPayload(parsedJson, board, observedAtIso);
    } catch (err) {
      return {
        parsingResult: 'PARSE_ERROR',
        rawRowsDetected: 0,
        validNotices: [],
        duplicatesFound: 0,
        paginationChecked: false,
        paginationLinks: [],
        unexpectedPageStructure: true,
        errorCategory: 'JSON_PARSE_ERROR',
        diagnosticMessage: `Invalid JSON payload: ${(err as Error).message}`,
      };
    }
  }

  // Strategy 2: HTML Parsing via Cheerio
  const $ = cheerio.load(trimmed);

  // Check if there is an embedded JSON script tag (#__RRB_NOTICES_DATA__ or application/ld+json)
  const embeddedJsonScript = $('script#__RRB_NOTICES_DATA__, script[data-rrb-notices]').first().html();
  if (embeddedJsonScript) {
    try {
      const data = JSON.parse(embeddedJsonScript);
      const jsonResult = parseStructuredJsonPayload(data, board, observedAtIso);
      if (jsonResult.validNotices.length > 0) {
        return jsonResult;
      }
    } catch {
      // Fall through to HTML DOM extraction
    }
  }

  // Detect pagination controls
  const paginationLinks: string[] = [];
  $('ul.pagination a, .pager a, nav[aria-label*="pagination"] a, a.page-link').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('javascript:') && href !== '#') {
      const canon = canonicalizeOfficialUrl(href, board.sourceUrl);
      if (isApprovedOfficialUrl(canon).allowed && !paginationLinks.includes(canon)) {
        paginationLinks.push(canon);
      }
    }
  });
  const paginationChecked = true;

  interface RawCandidate {
    noticeCode?: string;
    title: string;
    contentText?: string;
    dateText: string;
    categoryText?: string;
    detailUrl: string;
    attachmentUrls: string[];
  }

  const rawCandidates: RawCandidate[] = [];

  // Sub-strategy 2A: Table rows (`table.rrb-notices-table tr`, `table tr`)
  $('table tr').each((_, row) => {
    const $row = $(row);
    if ($row.find('th').length > 0 && $row.find('td').length === 0) {
      return; // Skip header row
    }
    const cells = $row.find('td');
    if (cells.length === 0) return;

    const rowText = normalizeText($row.text());
    if (!rowText || rowText.length < 10) return;

    // Board attribution check: explicit data-board attribute on row or parent container
    const explicitRowBoardAttr = (
      $row.attr('data-board') ||
      $row.closest('[data-board]').attr('data-board') ||
      ''
    ).trim();
    if (
      explicitRowBoardAttr &&
      explicitRowBoardAttr.toUpperCase() !== board.boardId.toUpperCase()
    ) {
      return;
    }

    // Extract date, noticeCode, board cell, title cell, description cell, and action links
    let dateText = ($row.attr('data-pub-date') || '').trim();
    let categoryText = ($row.attr('data-category') || '').trim();
    const rawAttrNoticeCode = ($row.attr('data-notice-id') || '').trim();
    let noticeCode =
      (rawAttrNoticeCode ? normalizeNoticeCodeCell(rawAttrNoticeCode) || rawAttrNoticeCode : '') || '';
    const extraDescription = normalizeText(
      $row.attr('data-content') ||
        $row.find('.notice-description, .notice-summary, .notice-body, .description').text() ||
        ''
    );

    let detectedBoardCellId = '';
    const textCells: string[] = [];

    cells.each((__, cell) => {
      const $cell = $(cell);
      const cellStr = normalizeText($cell.text());
      if (!cellStr) return;

      if (isSerialNumberCell(cellStr)) {
        return;
      }

      const cellBoardId = matchBoardCellToBoardId(cellStr);
      if (cellBoardId) {
        if (!detectedBoardCellId) {
          detectedBoardCellId = cellBoardId;
        }
        return;
      }

      const parsedDate = parseOfficialPublicationDate(cellStr);
      if (parsedDate.publicationDate && cellStr.length <= 32) {
        if (!dateText) {
          dateText = cellStr;
        }
        return;
      }

      const normalizedCode = normalizeNoticeCodeCell(cellStr);
      if (normalizedCode) {
        if (!noticeCode) {
          noticeCode = normalizedCode;
        }
        return;
      }

      const hasAnchor = $cell.find('a[href]').length > 0;
      if (
        isActionOrDownloadCell(cellStr, hasAnchor) ||
        $cell.hasClass('col-download') ||
        $cell.hasClass('col-action')
      ) {
        return;
      }

      if (/^no\s+date(?:\s+provided)?$|^n\/?a$|^nil$|^-+$/i.test(cellStr)) {
        return;
      }

      textCells.push(cellStr);
    });

    // If the row had an explicit RRB / Board column cell (e.g. "Guwahati"), filter by target board
    if (
      !explicitRowBoardAttr &&
      detectedBoardCellId &&
      detectedBoardCellId.toUpperCase() !== board.boardId.toUpperCase()
    ) {
      return;
    }

    // Collect all valid links inside the row
    const links: Array<{ href: string; text: string }> = [];
    $row.find('a[href]').each((__, a) => {
      const rawHref = ($(a).attr('href') || '').trim();
      if (!rawHref || rawHref === '#' || rawHref.toLowerCase().startsWith('javascript:')) return;
      const canonHref = canonicalizeOfficialUrl(rawHref, board.sourceUrl);
      if (!isApprovedOfficialUrl(canonHref).allowed) return;
      links.push({ href: canonHref, text: normalizeText($(a).text()) });
    });

    // If a genuine portal table row has a valid publication date and CEN number, but its action link
    // was '#' or an external assessment login link, synthesize a deterministic canonical link on board.sourceUrl
    if (links.length === 0) {
      if (noticeCode && dateText && parseOfficialPublicationDate(dateText).publicationDate && textCells.length > 0) {
        const slug = `${board.boardId}_${noticeCode}_${textCells[0]}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const fallbackHref = canonicalizeOfficialUrl(`/notices/${slug}`, board.sourceUrl);
        if (isApprovedOfficialUrl(fallbackHref).allowed) {
          links.push({ href: fallbackHref, text: textCells[0] });
        }
      }
      if (links.length === 0) return;
    }

    let titleCandidate = '';
    let contentTextCandidate = extraDescription;

    if (textCells.length === 1) {
      titleCandidate = textCells[0];
    } else if (textCells.length >= 2) {
      const primaryTitle = textCells[0];
      const descriptionFromColumns = textCells.slice(1).join(' — ');
      contentTextCandidate = [descriptionFromColumns, extraDescription]
        .filter(Boolean)
        .join(' — ');
      if (
        descriptionFromColumns &&
        !primaryTitle.toLowerCase().includes(descriptionFromColumns.toLowerCase())
      ) {
        titleCandidate = `${primaryTitle} — ${descriptionFromColumns}`;
      } else {
        titleCandidate = primaryTitle;
      }
    }

    if (!titleCandidate) {
      titleCandidate = links[0].text || rowText;
    }
    if (noticeCode && !titleCandidate.toLowerCase().includes(noticeCode.toLowerCase())) {
      titleCandidate = `${noticeCode}: ${titleCandidate}`;
    }

    const pdfLinks = links
      .map((l) => l.href)
      .filter((h) => /\.pdf($|\?)/i.test(h));
    const detailUrl = links[0].href;
    const attachmentUrls = Array.from(new Set(pdfLinks.length > 0 ? pdfLinks : [detailUrl]));

    rawCandidates.push({
      noticeCode: noticeCode || undefined,
      title: titleCandidate,
      contentText: contentTextCandidate || undefined,
      dateText: dateText || rowText,
      categoryText: categoryText || undefined,
      detailUrl,
      attachmentUrls,
    });
  });

  // Sub-strategy 2B: Modern Unified Portal Notice Cards (`.notice-card`, `.rrb-notice-item`, `article.notice`, `li.notice-item`)
  $(
    '.notice-card, .rrb-notice-item, article.notice, li.notice-item, [data-notice-card]'
  ).each((_, card) => {
    const $card = $(card);

    const explicitCardBoardAttr = (
      $card.attr('data-board') ||
      $card.closest('[data-board]').attr('data-board') ||
      ''
    ).trim();
    if (
      explicitCardBoardAttr &&
      explicitCardBoardAttr.toUpperCase() !== board.boardId.toUpperCase()
    ) {
      return;
    }

    const cardBoardNameText = normalizeText($card.find('.notice-board-name, .board-name').first().text());
    const detectedCardBoardId = cardBoardNameText ? matchBoardCellToBoardId(cardBoardNameText) : null;
    if (
      !explicitCardBoardAttr &&
      detectedCardBoardId &&
      detectedCardBoardId.toUpperCase() !== board.boardId.toUpperCase()
    ) {
      return;
    }

    const links: Array<{ href: string; text: string }> = [];
    $card.find('a[href]').each((__, a) => {
      const rawHref = ($(a).attr('href') || '').trim();
      if (!rawHref || rawHref === '#' || rawHref.toLowerCase().startsWith('javascript:')) return;
      const canonHref = canonicalizeOfficialUrl(rawHref, board.sourceUrl);
      if (!isApprovedOfficialUrl(canonHref).allowed) return;
      links.push({ href: canonHref, text: normalizeText($(a).text()) });
    });

    if (links.length === 0) return;

    const titleEl = $card.find('.notice-title, h3, h4, .title, a').first();
    const title = normalizeText(titleEl.text() || $card.text());
    if (!title || title.length < 4) return;

    const contentEl = $card.find('.notice-description, .notice-summary, .notice-body, .description, p');
    const contentText = normalizeText(
      $card.attr('data-content') || contentEl.text() || ''
    );

    const dateEl = $card.find('.notice-date, time, .date, [data-date]').first();
    const dateText =
      $card.attr('data-pub-date') ||
      dateEl.attr('datetime') ||
      normalizeText(dateEl.text()) ||
      normalizeText($card.text());

    const categoryText =
      $card.attr('data-category') ||
      normalizeText($card.find('.notice-category, .category').first().text());

    const rawCardNoticeCode =
      $card.attr('data-notice-id') ||
      normalizeText($card.find('.notice-code, .cen-number').first().text()) ||
      undefined;
    const noticeCode = rawCardNoticeCode
      ? normalizeNoticeCodeCell(rawCardNoticeCode) || rawCardNoticeCode
      : undefined;
    const pdfLinks = links.map((l) => l.href).filter((h) => /\.pdf($|\?)/i.test(h));
    const detailUrl = links[0].href;
    const attachmentUrls = Array.from(new Set(pdfLinks.length > 0 ? pdfLinks : [detailUrl]));

    rawCandidates.push({
      noticeCode,
      title,
      contentText: contentText || undefined,
      dateText,
      categoryText,
      detailUrl,
      attachmentUrls,
    });
  });

  if (rawCandidates.length === 0) {
    return {
      parsingResult: 'UNEXPECTED_STRUCTURE',
      rawRowsDetected: 0,
      validNotices: [],
      duplicatesFound: 0,
      paginationChecked,
      paginationLinks,
      unexpectedPageStructure: true,
      errorCategory: 'NO_NOTICE_ELEMENTS_FOUND',
      diagnosticMessage:
        'HTML response returned 200 OK but contained zero recognizable notice tables or notice cards.',
    };
  }

  return normalizeAndDeduplicateCandidates(
    rawCandidates,
    board,
    observedAtIso,
    paginationChecked,
    paginationLinks
  );
}

function parseStructuredJsonPayload(
  payload: unknown,
  board: BoardConfig,
  observedAtIso: string
): ParsedPageDiagnostics {
  const items: Array<Record<string, unknown>> = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).notices)
      ? ((payload as Record<string, unknown>).notices as Array<Record<string, unknown>>)
      : [];

  if (items.length === 0) {
    return {
      parsingResult: 'EMPTY_OR_SUSPICIOUS',
      rawRowsDetected: 0,
      validNotices: [],
      duplicatesFound: 0,
      paginationChecked: true,
      paginationLinks: [],
      unexpectedPageStructure: true,
      errorCategory: 'EMPTY_JSON_NOTICES',
      diagnosticMessage: 'JSON response contained zero notice records.',
    };
  }

  const rawCandidates = items
    .map((item) => {
      const title = normalizeText(String(item.title || item.subject || ''));
      const contentText = normalizeText(
        String(item.content || item.description || item.summary || item.body || '')
      );
      const rawUrl = String(item.url || item.officialNoticeUrl || item.pdfUrl || '');
      if (!title || !rawUrl) return null;
      const detailUrl = canonicalizeOfficialUrl(rawUrl, board.sourceUrl);
      if (!isApprovedOfficialUrl(detailUrl).allowed) return null;
      const attachmentsRaw = Array.isArray(item.attachments) ? item.attachments : [detailUrl];
      const attachmentUrls = attachmentsRaw
        .map((u) => canonicalizeOfficialUrl(String(u), board.sourceUrl))
        .filter((u) => isApprovedOfficialUrl(u).allowed);

      return {
        noticeCode: item.noticeId ? String(item.noticeId) : undefined,
        title,
        contentText: contentText || undefined,
        dateText: String(item.publicationDate || item.date || ''),
        categoryText: item.category ? String(item.category) : undefined,
        detailUrl,
        attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : [detailUrl],
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return normalizeAndDeduplicateCandidates(rawCandidates, board, observedAtIso, true, []);
}

function normalizeAndDeduplicateCandidates(
  rawCandidates: Array<{
    noticeCode?: string;
    title: string;
    contentText?: string;
    dateText: string;
    categoryText?: string;
    detailUrl: string;
    attachmentUrls: string[];
  }>,
  board: BoardConfig,
  observedAtIso: string,
  paginationChecked: boolean,
  paginationLinks: string[]
): ParsedPageDiagnostics {
  const seenFingerprints = new Set<string>();
  const validNotices: NormalizedNotice[] = [];
  let duplicatesFound = 0;

  for (const cand of rawCandidates) {
    const cleanTitle = normalizeText(cand.title);
    if (cleanTitle.length < 6) continue;

    const canonicalUrl = canonicalizeOfficialUrl(cand.detailUrl, board.sourceUrl);
    if (!isApprovedOfficialUrl(canonicalUrl).allowed) continue;

    const attachmentUrls = Array.from(
      new Set(
        cand.attachmentUrls
          .map((u) => canonicalizeOfficialUrl(u, board.sourceUrl))
          .filter((u) => isApprovedOfficialUrl(u).allowed)
      )
    );

    const { publicationDate, confidence } = parseOfficialPublicationDate(cand.dateText);
    const category = classifyNoticeCategory(cleanTitle, cand.categoryText);

    const { noticeId, fingerprint, contentHash } = computeNoticeHashes({
      boardId: board.boardId,
      title: cleanTitle,
      canonicalUrl,
      attachmentUrls,
      publicationDate,
      explicitNoticeCode: cand.noticeCode,
    });

    if (seenFingerprints.has(fingerprint)) {
      duplicatesFound += 1;
      continue;
    }
    seenFingerprints.add(fingerprint);

    validNotices.push({
      noticeId,
      fingerprint,
      boardId: board.boardId,
      boardName: board.boardName,
      title: cleanTitle,
      ...(cand.contentText ? { contentText: cand.contentText } : {}),
      officialNoticeUrl: canonicalUrl,
      canonicalUrl,
      attachmentUrls,
      publicationDate,
      publicationDateConfidence: confidence,
      category,
      contentHash,
      firstSeenAt: observedAtIso,
      lastSeenAt: observedAtIso,
      lastObservedAt: observedAtIso,
      baselineStatus: 'BASELINED_INITIAL',
      deliveryStatus: 'discovered',
      deliveredAt: null,
      sourceLastModified: null,
      parserVersion: CURRENT_PARSER_VERSION,
      verificationStatus: confidence === 'NONE' ? 'NEEDS_REVIEW' : 'VERIFIED',
    });
  }

  if (validNotices.length === 0) {
    return {
      parsingResult: 'UNEXPECTED_STRUCTURE',
      rawRowsDetected: rawCandidates.length,
      validNotices: [],
      duplicatesFound,
      paginationChecked,
      paginationLinks,
      unexpectedPageStructure: true,
      errorCategory: 'ZERO_VALID_NOTICES',
      diagnosticMessage: `Detected ${rawCandidates.length} candidate elements, but none passed official URL and title validation.`,
    };
  }

  return {
    parsingResult: 'VALID',
    rawRowsDetected: rawCandidates.length,
    validNotices,
    duplicatesFound,
    paginationChecked,
    paginationLinks,
    unexpectedPageStructure: false,
    errorCategory: null,
    diagnosticMessage: `Successfully parsed ${validNotices.length} official notices (${duplicatesFound} inline duplicates suppressed).`,
  };
}
