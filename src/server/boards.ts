import type { BoardConfig } from './types.ts';

export const CURRENT_PARSER_VERSION = '2.2.0-unified-portal-only';

/**
 * Single official unified Railway Recruitment Board portal URL.
 * All 21 regional RRB websites were consolidated into this single official portal.
 */
export const UNIFIED_RRB_PORTAL_URL = 'https://rrb.indianrailways.gov.in/';

/**
 * Approved official hostnames for SSRF prevention and domain enforcement.
 * Strictly restricted to the unified RRB portal (https://rrb.indianrailways.gov.in/).
 * Retired regional RRB domains are explicitly excluded and blocked.
 */
export const APPROVED_OFFICIAL_DOMAINS: ReadonlySet<string> = new Set([
  'rrb.indianrailways.gov.in',
  'www.rrb.indianrailways.gov.in',
]);

/**
 * Detects whether a hostname belongs to a retired legacy regional RRB website
 * or old RRCB domain that must no longer be scraped or used as a fallback.
 */
export function isLegacyRegionalRrbHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim().replace(/^www\./, '');
  if (lower === 'rrb.indianrailways.gov.in') {
    return false;
  }
  return /^(?:rrb[a-z0-9-]+|rrcb)\.(?:gov|nic|org)\.in$/i.test(lower);
}

/**
 * Rewrites any historical notice or attachment URL from a retired regional RRB domain
 * onto the canonical unified portal (https://rrb.indianrailways.gov.in/) so stored
 * notice history and deduplication hashes remain intact without ever contacting old sites.
 */
export function migrateLegacyUrlToUnifiedPortal(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    if (isLegacyRegionalRrbHostname(parsed.hostname)) {
      const unified = new URL(UNIFIED_RRB_PORTAL_URL);
      unified.pathname = parsed.pathname;
      unified.search = parsed.search;
      return unified.toString();
    }
    return rawUrl.trim();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Validates that a target or redirect URL belongs strictly to the unified official
 * RRB portal (https://rrb.indianrailways.gov.in/) and blocks both private/internal IPs
 * (SSRF) and retired regional RRB websites.
 */
export function isApprovedOfficialUrl(rawUrl: string): {
  allowed: boolean;
  reason?: string;
  parsedUrl?: URL;
} {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { allowed: false, reason: `Unsupported protocol: ${parsed.protocol}` };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      hostname.endsWith('.internal')
    ) {
      return { allowed: false, reason: `Private or loopback host forbidden: ${hostname}` };
    }
    if (isLegacyRegionalRrbHostname(hostname)) {
      return {
        allowed: false,
        reason: `Retired regional RRB domain '${hostname}' is forbidden. Use only ${UNIFIED_RRB_PORTAL_URL}`,
      };
    }
    if (!APPROVED_OFFICIAL_DOMAINS.has(hostname)) {
      return {
        allowed: false,
        reason: `Domain '${hostname}' is not in the verified RRB unified portal allowlist (${UNIFIED_RRB_PORTAL_URL}).`,
      };
    }
    return { allowed: true, parsedUrl: parsed };
  } catch (err) {
    return { allowed: false, reason: `Malformed URL: ${(err as Error).message}` };
  }
}

/**
 * Verified configuration for the Unified RRB Portal (https://rrb.indianrailways.gov.in/)
 * across the Central RRCB feed and all 21 official regional Railway Recruitment Boards.
 * Every board uses ONLY https://rrb.indianrailways.gov.in/ with zero legacy regional URLs.
 */
export const VERIFIED_BOARD_CONFIGS: BoardConfig[] = [
  {
    boardId: 'RRB_CENTRAL',
    boardName: 'RRCB / Unified Central Portal (All-India CEN)',
    zoneCode: 'CEN-HQ',
    headquarters: 'New Delhi',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['rrcb', 'all rrb', 'all-india', 'centralized', 'cen-hq'],
    sourceType: 'UNIFIED_PORTAL_CENTRAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Primary unified RRB portal consolidating Centralized Employment Notifications (CEN), corrigenda, schedules, and multi-board announcements.',
  },
  {
    boardId: 'RRB_AHMEDABAD',
    boardName: 'RRB Ahmedabad',
    zoneCode: 'WR-ADI',
    headquarters: 'Ahmedabad, Gujarat',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['ahmedabad', 'wr-adi', '-adi', '/adi_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Western Railway zone recruitment notices, DV schedules, and replacement panels via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_AJMER',
    boardName: 'RRB Ajmer',
    zoneCode: 'NWR-AII',
    headquarters: 'Ajmer, Rajasthan',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['ajmer', 'nwr-aii', '-aii', '/aii_', 'north western railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'North Western Railway & West Central Railway regional recruitment notices and final results via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_ALLAHABAD',
    boardName: 'RRB Prayagraj (Allahabad)',
    zoneCode: 'NCR-ALD',
    headquarters: 'Prayagraj, Uttar Pradesh',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['prayagraj', 'allahabad', 'ncr-ald', '-ald', '/ald_', 'pryj', 'north central railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'North Central Railway & Northern Railway regional notices, cut-offs, and call letters via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_BANGALORE',
    boardName: 'RRB Bengaluru (Bangalore)',
    zoneCode: 'SWR-SBC',
    headquarters: 'Bengaluru, Karnataka',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['bengaluru', 'bangalore', 'swr-sbc', '-sbc', '/sbc_', 'south western railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'South Western Railway & Rail Wheel Factory notices, provisional panels, and e-call letters via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_BHOPAL',
    boardName: 'RRB Bhopal',
    zoneCode: 'WCR-BPL',
    headquarters: 'Bhopal, Madhya Pradesh',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['bhopal', 'wcr-bpl', '-bpl', '/bpl_', 'west central railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'West Central Railway & Western Railway regional candidate updates and CEN corrigenda via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_BHUBANESWAR',
    boardName: 'RRB Bhubaneswar',
    zoneCode: 'ECoR-BBS',
    headquarters: 'Bhubaneswar, Odisha',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['bhubaneswar', 'ecor-bbs', '-bbs', '/bbs_', 'east coast railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'East Coast Railway recruitment results, medical appeal notices, and DV lists via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_BILASPUR',
    boardName: 'RRB Bilaspur',
    zoneCode: 'SECR-BSP',
    headquarters: 'Bilaspur, Chhattisgarh',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['bilaspur', 'secr-bsp', '-bsp', '/bsp_', 'secr zone', 'south east central railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'South East Central Railway & Central Railway regional recruitment notifications via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_CHANDIGARH',
    boardName: 'RRB Chandigarh',
    zoneCode: 'NR-CDG',
    headquarters: 'Chandigarh',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['chandigarh', 'nr-cdg', '-cdg', '/cdg_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Northern Railway headquarters zone notices, CBT schedules, and answer keys via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_CHENNAI',
    boardName: 'RRB Chennai',
    zoneCode: 'SR-MAS',
    headquarters: 'Chennai, Tamil Nadu',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['chennai', 'sr-mas', '-mas', '/mas_', 'southern railway & icf'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Southern Railway & ICF Chennai official candidate notifications and scorecards via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_GORAKHPUR',
    boardName: 'RRB Gorakhpur',
    zoneCode: 'NER-GKP',
    headquarters: 'Gorakhpur, Uttar Pradesh',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['gorakhpur', 'ner-gkp', '-gkp', '/gkp_', 'north eastern railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'North Eastern Railway & RDSO recruitment notices and document verification updates via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_GUWAHATI',
    boardName: 'RRB Guwahati',
    zoneCode: 'NFR-GHY',
    headquarters: 'Guwahati, Assam',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['guwahati', 'dibrugarh', 'nfr-ghy', '-ghy', '/ghy_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Northeast Frontier Railway candidate alerts, exam city slips, and final panels via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_JAMMU',
    boardName: 'RRB Jammu-Srinagar',
    zoneCode: 'NR-JAT',
    headquarters: 'Jammu, J&K',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['jammu', 'srinagar', 'nr-jat', '-jat', '/jat_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Northern Railway (Firozpur Division), DMW Patiala & RCF Kapurthala recruitment notices via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_KOLKATA',
    boardName: 'RRB Kolkata',
    zoneCode: 'ER-KOAA',
    headquarters: 'Kolkata, West Bengal',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['kolkata', 'er-koaa', '-koaa', '/koaa_', 'metro railway', 'clw'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Eastern Railway, South Eastern Railway, Metro Railway Kolkata & CLW Chittaranjan notices via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_MALDA',
    boardName: 'RRB Malda',
    zoneCode: 'ER-MLDT',
    headquarters: 'Malda, West Bengal',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['malda', 'er-mldt', '-mldt', '/mldt_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Eastern Railway (Malda Division) & SER regional notices and empanelment lists via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_MUMBAI',
    boardName: 'RRB Mumbai',
    zoneCode: 'CR-CSTM',
    headquarters: 'Mumbai, Maharashtra',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['mumbai', 'cr-cstm', '-mmct', '/mmct_', 'central & western railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Central Railway, Western Railway & SCR regional notices, supplementary panels, and corrigenda via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_MUZAFFARPUR',
    boardName: 'RRB Muzaffarpur',
    zoneCode: 'ECR-MFP',
    headquarters: 'Muzaffarpur, Bihar',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['muzaffarpur', 'samastipur', 'ecr-mfp', '-mfp', '/mfp_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'East Central Railway (Samastipur & Sonpur Divisions) recruitment notices via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_PATNA',
    boardName: 'RRB Patna',
    zoneCode: 'ECR-PNBE',
    headquarters: 'Patna, Bihar',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['patna', 'ecr-pnbe', '-pnbe', '/pnbe_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'East Central Railway headquarters recruitment notifications, results, and DV schedules via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_RANCHI',
    boardName: 'RRB Ranchi',
    zoneCode: 'SER-RNC',
    headquarters: 'Ranchi, Jharkhand',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['ranchi', 'ser-rnc', '-rnc', '/rnc_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'South Eastern Railway & East Central Railway (Dhanbad Division) official notices via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_SECUNDERABAD',
    boardName: 'RRB Secunderabad',
    zoneCode: 'SCR-SC',
    headquarters: 'Secunderabad, Telangana',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['secunderabad', 'scr-sc', '-sc', '/sc_', 'south central railway'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'South Central Railway & East Coast Railway official candidate announcements and results via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_SILIGURI',
    boardName: 'RRB Siliguri',
    zoneCode: 'NFR-SGUJ',
    headquarters: 'Siliguri, West Bengal',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['siliguri', 'katihar', 'alipurduar', 'nfr-sguj', '-sguj', '/sguj_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Northeast Frontier Railway (Katihar & Alipurduar Divisions) candidate notices via https://rrb.indianrailways.gov.in/.',
  },
  {
    boardId: 'RRB_THIRUVANANTHAPURAM',
    boardName: 'RRB Thiruvananthapuram',
    zoneCode: 'SR-TVC',
    headquarters: 'Thiruvananthapuram, Kerala',
    sourceUrl: UNIFIED_RRB_PORTAL_URL,
    noticesUrl: UNIFIED_RRB_PORTAL_URL,
    regionalKeywords: ['thiruvananthapuram', 'trivandrum', 'sr-tvc', '-tvc', '/tvc_'],
    sourceType: 'UNIFIED_PORTAL_REGIONAL',
    enabled: true,
    lastSuccessfulFetch: null,
    parserVersion: CURRENT_PARSER_VERSION,
    notes: 'Southern Railway (Trivandrum & Palakkad Divisions) recruitment notices and panels via https://rrb.indianrailways.gov.in/.',
  },
];

export function getBoardById(boardId: string): BoardConfig | undefined {
  return VERIFIED_BOARD_CONFIGS.find(
    (b) => b.boardId.toUpperCase() === boardId.trim().toUpperCase()
  );
}
