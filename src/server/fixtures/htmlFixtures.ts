import { VERIFIED_BOARD_CONFIGS } from '../boards.ts';

export interface BoardSeedNotice {
  noticeCode: string;
  title: string;
  publicationDate: string;
  category: string;
  pdfPath: string;
}

/**
 * Authentic, realistic seed notice data for the Unified Central Portal and all 21 Regional RRBs.
 * Used for deterministic unit/integration tests and fixture verification mode when NIC servers are geo-fenced.
 */
export const BOARD_SEED_NOTICES: Record<string, BoardSeedNotice[]> = {
  RRB_CENTRAL: [
    {
      noticeCode: 'CEN 04/2026',
      title: 'CEN 04/2026 (NTPC Graduate & Undergraduate): Notice on Tentative 1st Stage CBT Schedule & City Intimation Link',
      publicationDate: '2026-10-19',
      category: 'Exam Schedule & City Intimation',
      pdfPath: '/cen-2026/CEN_04_2026_CBT1_Schedule_Notice.pdf',
    },
    {
      noticeCode: 'CEN 01/2026',
      title: 'CEN 01/2026 (Assistant Loco Pilot): Corrigendum-2 Regarding Zone-Wise Revised Vacancy Table',
      publicationDate: '2026-10-16',
      category: 'Corrigendum & Amendment',
      pdfPath: '/cen-2026/CEN_01_2026_ALP_Corrigendum_2.pdf',
    },
    {
      noticeCode: 'CEN 03/2026',
      title: 'CEN 03/2026 (Junior Engineer, DMS & CMA): Provisional Answer Key, Response Sheet & Objection Tracker Link',
      publicationDate: '2026-10-14',
      category: 'Answer Key & Objection Tracker',
      pdfPath: '/cen-2026/CEN_03_2026_JE_Objection_Tracker_Notice.pdf',
    },
  ],
  RRB_AHMEDABAD: [
    {
      noticeCode: 'CEN 01/2026-ADI',
      title: 'CEN 01/2026 (ALP): List of Candidates Shortlisted for 2nd Stage CBT (CBT-2) & Cut-Off Marks for RRB Ahmedabad',
      publicationDate: '2026-10-18',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/uploads/notices/2026/ADI_CEN01_2026_CBT1_Results.pdf',
    },
    {
      noticeCode: 'CEN 02/2025-ADI',
      title: 'CEN 02/2025 (Technicians): Replacement Panel-3 for Cat. No. 14 & 18 (Western Railway)',
      publicationDate: '2026-10-11',
      category: 'Document Verification & Panel',
      pdfPath: '/uploads/notices/2026/ADI_Tech_Replacement_Panel3.pdf',
    },
  ],
  RRB_AJMER: [
    {
      noticeCode: 'CEN 03/2026-AII',
      title: 'CEN 03/2026 (JE/DMS/CMA): E-Call Letter Download Schedule for CBT-1 Examination (RRB Ajmer)',
      publicationDate: '2026-10-18',
      category: 'Admit Card & E-Call Letter',
      pdfPath: '/notices/2026/AII_CEN_03_2026_AdmitCard_Notice.pdf',
    },
    {
      noticeCode: 'CEN 01/2025-AII',
      title: 'CEN 01/2025 (ALP): Final Provisional Panel Part-II for North Western Railway Zone',
      publicationDate: '2026-10-09',
      category: 'Document Verification & Panel',
      pdfPath: '/notices/2026/AII_ALP_Final_Panel_Part2.pdf',
    },
  ],
  RRB_ALLAHABAD: [
    {
      noticeCode: 'CEN 04/2026-ALD',
      title: 'CEN 04/2026 (NTPC): Application Status & Scrutiny Link for Graduate Level Posts (RRB Prayagraj)',
      publicationDate: '2026-10-19',
      category: 'General Candidate Notice',
      pdfPath: '/docs/2026/ALD_CEN04_2026_Application_Status.pdf',
    },
    {
      noticeCode: 'CEN 02/2026-ALD',
      title: 'CEN 02/2026 (Technicians Grade-I & III): Schedule for Document Verification & Medical Examination (Round-1)',
      publicationDate: '2026-10-15',
      category: 'Document Verification & Panel',
      pdfPath: '/docs/2026/ALD_CEN02_2026_DV_Schedule_R1.pdf',
    },
  ],
  RRB_BANGALORE: [
    {
      noticeCode: 'CEN 03/2026-SBC',
      title: 'CEN 03/2026 (JE): Declaration of CBT-1 Normalized Score Cards & Shortlist for CBT-2 (RRB Bengaluru)',
      publicationDate: '2026-10-17',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/notifications/2026/SBC_JE_2026_ScoreCard_Notice.pdf',
    },
    {
      noticeCode: 'CEN 01/2026-SBC',
      title: 'CEN 01/2026 (ALP): CBAT (Aptitude Test) Vision Certificate Format & Guidelines for Shortlisted Candidates',
      publicationDate: '2026-10-12',
      category: 'Admit Card & E-Call Letter',
      pdfPath: '/notifications/2026/SBC_ALP_CBAT_Vision_Cert.pdf',
    },
  ],
  RRB_BHOPAL: [
    {
      noticeCode: 'CEN 02/2026-BPL',
      title: 'CEN 02/2026 (Technicians): Corrigendum to Provisional Panel-1 for West Central Railway',
      publicationDate: '2026-10-18',
      category: 'Corrigendum & Amendment',
      pdfPath: '/pdf/2026/BPL_Tech_Panel1_Corrigendum.pdf',
    },
    {
      noticeCode: 'CEN 05/2026-BPL',
      title: 'CEN 05/2026 (Paramedical Categories): Detailed Centralized Employment Notification for Staff Nurse & Pharmacist',
      publicationDate: '2026-10-10',
      category: 'Employment Notification (CEN)',
      pdfPath: '/pdf/2026/BPL_CEN_05_2026_Paramedical.pdf',
    },
  ],
  RRB_BHUBANESWAR: [
    {
      noticeCode: 'CEN 01/2026-BBS',
      title: 'CEN 01/2026 (ALP): Notice for Absentee Document Verification on 28.10.2026 at RRB Bhubaneswar',
      publicationDate: '2026-10-17',
      category: 'Document Verification & Panel',
      pdfPath: '/noticeboard/2026/BBS_ALP_Absentee_DV_Notice.pdf',
    },
    {
      noticeCode: 'CEN 03/2026-BBS',
      title: 'CEN 03/2026 (JE): Final Answer Key After Resolution of Candidate Representations',
      publicationDate: '2026-10-13',
      category: 'Answer Key & Objection Tracker',
      pdfPath: '/noticeboard/2026/BBS_JE_Final_Answer_Key.pdf',
    },
  ],
  RRB_BILASPUR: [
    {
      noticeCode: 'CEN 02/2026-BSP',
      title: 'CEN 02/2026 (Technicians): Cut-Off Marks & Roll Numbers Shortlisted for DV (SECR Zone)',
      publicationDate: '2026-10-18',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/cen2026/BSP_Tech_DV_Shortlist_Cutoff.pdf',
    },
  ],
  RRB_CHANDIGARH: [
    {
      noticeCode: 'CEN 04/2026-CDG',
      title: 'CEN 04/2026 (NTPC): E-Call Letter & Free Travel Authority (SC/ST) Download Notice for Phase-I CBT',
      publicationDate: '2026-10-19',
      category: 'Admit Card & E-Call Letter',
      pdfPath: '/uploads/2026/CDG_NTPC_Phase1_AdmitCard.pdf',
    },
    {
      noticeCode: 'CEN 01/2026-CDG',
      title: 'CEN 01/2026 (ALP): Result of Computer Based Aptitude Test (CBAT) & Document Verification Schedule',
      publicationDate: '2026-10-14',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/uploads/2026/CDG_ALP_CBAT_Result_DV.pdf',
    },
  ],
  RRB_CHENNAI: [
    {
      noticeCode: 'CEN 03/2026-MAS',
      title: 'CEN 03/2026 (JE/DMS/CMA): CBT-2 Exam Date & Mock Test Link Activation for Southern Railway & ICF',
      publicationDate: '2026-10-19',
      category: 'Exam Schedule & City Intimation',
      pdfPath: '/notices/2026/MAS_CEN03_2026_CBT2_Schedule.pdf',
    },
    {
      noticeCode: 'CEN 02/2026-MAS',
      title: 'CEN 02/2026 (Technicians): Provisional Part Panel-1 for Technician Gr-I Signal & Gr-III Electrical',
      publicationDate: '2026-10-15',
      category: 'Document Verification & Panel',
      pdfPath: '/notices/2026/MAS_Tech_Part_Panel_1.pdf',
    },
  ],
  RRB_GORAKHPUR: [
    {
      noticeCode: 'CEN 01/2026-GKP',
      title: 'CEN 01/2026 (ALP): Appellate Medical Examination Notice for Candidates Unfit in A-1 Medical Standard',
      publicationDate: '2026-10-16',
      category: 'Document Verification & Panel',
      pdfPath: '/notices/2026/GKP_ALP_Medical_Appeal_Notice.pdf',
    },
  ],
  RRB_GUWAHATI: [
    {
      noticeCode: 'CEN 04/2026-GHY',
      title: 'CEN 04/2026 (NTPC): Notice on Examination Centre Change in Guwahati & Dibrugarh Cities',
      publicationDate: '2026-10-18',
      category: 'Exam Schedule & City Intimation',
      pdfPath: '/notices/2026/GHY_NTPC_Centre_Change_Notice.pdf',
    },
  ],
  RRB_JAMMU: [
    {
      noticeCode: 'CEN 02/2026-JAT',
      title: 'CEN 02/2026 (Technicians): Biometric & Document Verification Schedule at RRB Jammu-Srinagar',
      publicationDate: '2026-10-17',
      category: 'Document Verification & Panel',
      pdfPath: '/notices/2026/JAT_Tech_DV_Biometric_Schedule.pdf',
    },
  ],
  RRB_KOLKATA: [
    {
      noticeCode: 'CEN 04/2026-KOAA',
      title: 'CEN 04/2026 (NTPC): City Intimation Slip & Helpdesk Portal for Eastern Railway, SER & Metro Railway',
      publicationDate: '2026-10-19',
      category: 'Exam Schedule & City Intimation',
      pdfPath: '/notices/2026/KOAA_NTPC_City_Slip_Notice.pdf',
    },
    {
      noticeCode: 'CEN 01/2026-KOAA',
      title: 'CEN 01/2026 (ALP): Provisional Empanelment List Part-I for Eastern Railway & CLW',
      publicationDate: '2026-10-13',
      category: 'Document Verification & Panel',
      pdfPath: '/notices/2026/KOAA_ALP_Empanelment_Part1.pdf',
    },
  ],
  RRB_MALDA: [
    {
      noticeCode: 'CEN 01/2026-MLDT',
      title: 'CEN 01/2026 (ALP): Cut-Off Marks After Document Verification for Malda Division (ER & SER)',
      publicationDate: '2026-10-16',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/notices/2026/MLDT_ALP_DV_Cutoff_Marks.pdf',
    },
  ],
  RRB_MUMBAI: [
    {
      noticeCode: 'CEN 03/2026-MMCT',
      title: 'CEN 03/2026 (JE/CMA): Shortlisted Roll Numbers for Document Verification (Central & Western Railway)',
      publicationDate: '2026-10-19',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/notices/2026/MMCT_JE_DV_Shortlist_2026.pdf',
    },
    {
      noticeCode: 'CEN 02/2026-MMCT',
      title: 'CEN 02/2026 (Technicians): Corrigendum Regarding Re-allocation of Division for Cat. No. 05',
      publicationDate: '2026-10-14',
      category: 'Corrigendum & Amendment',
      pdfPath: '/notices/2026/MMCT_Tech_Corrigendum_Cat05.pdf',
    },
  ],
  RRB_MUZAFFARPUR: [
    {
      noticeCode: 'CEN 02/2026-MFP',
      title: 'CEN 02/2026 (Technicians): Provisional Panel & Medical Memo Instructions for ECR Samastipur',
      publicationDate: '2026-10-15',
      category: 'Document Verification & Panel',
      pdfPath: '/notices/2026/MFP_Tech_Provisional_Panel.pdf',
    },
  ],
  RRB_PATNA: [
    {
      noticeCode: 'CEN 04/2026-PNBE',
      title: 'CEN 04/2026 (NTPC): Important Notice Regarding Scribe Declaration & PwBD Guidelines (RRB Patna)',
      publicationDate: '2026-10-18',
      category: 'General Candidate Notice',
      pdfPath: '/notices/2026/PNBE_NTPC_PwBD_Scribe_Notice.pdf',
    },
  ],
  RRB_RANCHI: [
    {
      noticeCode: 'CEN 01/2026-RNC',
      title: 'CEN 01/2026 (ALP): Supplementary Result & Cut-Off for 2nd Round Document Verification (SER & ECR)',
      publicationDate: '2026-10-17',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/notices/2026/RNC_ALP_Round2_DV_List.pdf',
    },
  ],
  RRB_SECUNDERABAD: [
    {
      noticeCode: 'CEN 05/2026-SC',
      title: 'CEN 05/2026 (Ministerial & Isolated Categories): Centralized Employment Notification & Online Registration Schedule',
      publicationDate: '2026-10-19',
      category: 'Employment Notification (CEN)',
      pdfPath: '/notices/2026/SC_CEN_05_2026_Detailed_Notification.pdf',
    },
    {
      noticeCode: 'CEN 03/2026-SC',
      title: 'CEN 03/2026 (JE): Question Paper, Responses & Final Keys for South Central Railway',
      publicationDate: '2026-10-15',
      category: 'Answer Key & Objection Tracker',
      pdfPath: '/notices/2026/SC_JE_Final_Keys_2026.pdf',
    },
  ],
  RRB_SILIGURI: [
    {
      noticeCode: 'CEN 02/2026-SGUJ',
      title: 'CEN 02/2026 (Technicians): Final Empanelment Result for NFR Katihar & Alipurduar Divisions',
      publicationDate: '2026-10-16',
      category: 'Result & Cut-Off Marks',
      pdfPath: '/notices/2026/SGUJ_Tech_Final_Empanelment.pdf',
    },
  ],
  RRB_THIRUVANANTHAPURAM: [
    {
      noticeCode: 'CEN 01/2026-TVC',
      title: 'CEN 01/2026 (ALP): Final Part Panel-II & Medical Re-Examination Status for Trivandrum Division',
      publicationDate: '2026-10-18',
      category: 'Document Verification & Panel',
      pdfPath: '/notices/2026/TVC_ALP_Part_Panel_2.pdf',
    },
  ],
};

/**
 * Generates realistic, representative official HTML for any configured RRB board,
 * plus optional injected newly published notices for testing incremental detection.
 */
export function buildOfficialBoardHtmlFixture(
  boardId: string,
  extraNotices: BoardSeedNotice[] = []
): string {
  const board = VERIFIED_BOARD_CONFIGS.find((b) => b.boardId === boardId);
  const baseDomain = 'https://rrb.indianrailways.gov.in';
  const seeds = [...extraNotices, ...(BOARD_SEED_NOTICES[boardId] || BOARD_SEED_NOTICES.RRB_CENTRAL)];

  // Alternate between the Unified Portal Modern Card layout and Unified Portal Table layout
  const useCardLayout = boardId === 'RRB_CENTRAL' || boardId === 'RRB_CHENNAI' || boardId === 'RRB_SECUNDERABAD';

  if (useCardLayout) {
    const cardsHtml = seeds
      .map(
        (item) => `
      <article class="rrb-notice-item notice-card" data-board="${boardId}" data-notice-id="${item.noticeCode}" data-pub-date="${item.publicationDate}" data-category="${item.category}">
        <div class="notice-meta">
          <span class="notice-board-name">${board?.boardName || 'RRCB'}</span>
          <span class="notice-code">${item.noticeCode}</span>
          <time class="notice-date" datetime="${item.publicationDate}">${item.publicationDate}</time>
          <span class="notice-category">${item.category}</span>
        </div>
        <h3 class="notice-title">
          <a href="${baseDomain}${item.pdfPath}">${item.title}</a>
        </h3>
        <div class="notice-links">
          <a href="${baseDomain}${item.pdfPath}" class="pdf-download">Download Official PDF (English/Hindi)</a>
        </div>
      </article>`
      )
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${board?.boardName || 'Railway Recruitment Board'} - Unified Official Portal (rrb.indianrailways.gov.in)</title>
</head>
<body>
  <header>
    <h1>Government of India - Ministry of Railways</h1>
    <h2>${board?.boardName || 'Railway Recruitment Control Board'} — Unified RRB Portal</h2>
  </header>
  <main id="notices-container">
    <section class="notice-board" data-board="${boardId}">
      ${cardsHtml}
    </section>
    <nav aria-label="Notices pagination">
      <ul class="pagination">
        <li><a class="page-link" href="${baseDomain}/?page=1">1</a></li>
        <li><a class="page-link" href="${baseDomain}/?page=2">2</a></li>
      </ul>
    </nav>
  </main>
</body>
</html>`;
  }

  const rowsHtml = seeds
    .map(
      (item) => `
        <tr data-board="${boardId}" data-notice-id="${item.noticeCode}">
          <td class="col-date">${item.publicationDate.split('-').reverse().join('.')}</td>
          <td class="col-code">${item.noticeCode}</td>
          <td class="col-title">
            <a href="${baseDomain}${item.pdfPath}">${item.title}</a>
          </td>
          <td class="col-download">
            <a href="${baseDomain}${item.pdfPath}">PDF</a>
          </td>
        </tr>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${board?.boardName || 'Railway Recruitment Board'} — Unified Official Portal (rrb.indianrailways.gov.in)</title>
</head>
<body>
  <div class="nic-wrapper" data-board="${boardId}">
    <h1>${board?.boardName || 'Railway Recruitment Board'} — Unified RRB Portal</h1>
    <table class="rrb-notices-table">
      <thead>
        <tr>
          <th>Date of Publication</th>
          <th>CEN / Notice No.</th>
          <th>Subject / Official Description</th>
          <th>Document Link</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <ul class="pagination">
      <li><a href="${baseDomain}/notices?page=1">Page 1</a></li>
      <li><a href="${baseDomain}/notices?page=2">Page 2</a></li>
    </ul>
  </div>
</body>
</html>`;
}

/**
 * Generates a single combined HTML document representing https://rrb.indianrailways.gov.in/
 * containing notices for RRB_CENTRAL and all 21 regional RRBs in one unified portal page.
 */
export function buildCombinedUnifiedPortalHtmlFixture(): string {
  const baseDomain = 'https://rrb.indianrailways.gov.in';
  const rows: string[] = [];
  const cards: string[] = [];

  for (const board of VERIFIED_BOARD_CONFIGS) {
    const seeds = BOARD_SEED_NOTICES[board.boardId] || [];
    const useCardLayout =
      board.boardId === 'RRB_CENTRAL' ||
      board.boardId === 'RRB_CHENNAI' ||
      board.boardId === 'RRB_SECUNDERABAD';

    for (const item of seeds) {
      if (useCardLayout) {
        cards.push(`
      <article class="rrb-notice-item notice-card" data-board="${board.boardId}" data-notice-id="${item.noticeCode}" data-pub-date="${item.publicationDate}" data-category="${item.category}">
        <div class="notice-meta">
          <span class="notice-board-name">${board.boardName}</span>
          <span class="notice-code">${item.noticeCode}</span>
          <time class="notice-date" datetime="${item.publicationDate}">${item.publicationDate}</time>
          <span class="notice-category">${item.category}</span>
        </div>
        <h3 class="notice-title">
          <a href="${baseDomain}${item.pdfPath}">${item.title}</a>
        </h3>
        <div class="notice-links">
          <a href="${baseDomain}${item.pdfPath}" class="pdf-download">Download Official PDF (English/Hindi)</a>
        </div>
      </article>`);
      } else {
        rows.push(`
        <tr data-board="${board.boardId}" data-zone="${board.zoneCode}" data-notice-id="${item.noticeCode}">
          <td class="col-date">${item.publicationDate.split('-').reverse().join('.')}</td>
          <td class="col-code">${item.noticeCode}</td>
          <td class="col-title">
            <a href="${baseDomain}${item.pdfPath}">${item.title}</a>
          </td>
          <td class="col-download">
            <a href="${baseDomain}${item.pdfPath}">PDF</a>
          </td>
        </tr>`);
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Railway Recruitment Boards (RRB) — Unified Official Portal (https://rrb.indianrailways.gov.in/)</title>
</head>
<body>
  <header>
    <h1>Government of India — Ministry of Railways</h1>
    <h2>Railway Recruitment Control Board & All 21 Regional RRBs Unified Portal</h2>
  </header>
  <main id="unified-notices-portal">
    <section class="notice-board-cards">
      ${cards.join('\n')}
    </section>
    <table class="rrb-notices-table">
      <thead>
        <tr>
          <th>Date of Publication</th>
          <th>CEN / Notice No.</th>
          <th>Subject / Official Description</th>
          <th>Document Link</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join('\n')}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}

export const CHALLENGE_PAGE_HTML_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Attention Required! | Cloudflare</title></head>
<body>
  <div id="cf-browser-verification">Checking your browser before accessing rrb.indianrailways.gov.in...</div>
</body>
</html>`;

export const SOFT_ERROR_200_HTML_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>404 - File or directory not found</title></head>
<body>
  <h1>Server Error in '/' Application</h1>
  <p>404 - File or directory not found. The resource you are looking for might have been removed.</p>
</body>
</html>`;

export const UNEXPECTED_DOM_REGRESSION_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>RRB Portal Maintenance</title></head>
<body>
  <div class="banner">Welcome to Indian Railways Portal. Notice layout has been replaced with static text only.</div>
</body>
</html>`;
