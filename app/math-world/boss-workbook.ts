import type { BossChallenge } from "./boss-challenges.ts";
import assets from "./boss-workbook-assets.json" with { type: "json" };

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** The assessment keeps the complete original test order, independently of worlds. */
export function bossWorkbook(challenge: BossChallenge) {
  const test = assets.tests.find(test => test.year === challenge.year);
  if (!test || challenge.id !== `boss-${test.year}` || challenge.gradeBand !== test.gradeBand || challenge.questionCount !== test.questionCount) {
    throw new Error("This challenge workbook is unavailable. Please reload and try again.");
  }
  return test;
}

const stylesheet = `
*{box-sizing:border-box}body{margin:0;color:#17213d;background:#e9e8e3;font-family:Arial,Helvetica,sans-serif}
.toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;background:#fbf8f0;border-bottom:1px solid #cfcabd}.toolbar p{margin:0;font-size:14px;line-height:1.4}.toolbar button{min-height:44px;padding:10px 22px;border:0;border-radius:24px;background:#17213d;color:white;font:700 15px Arial;cursor:pointer}.toolbar button:disabled{opacity:.5;cursor:wait}.toolbar button:focus-visible{outline:3px solid #1679d2;outline-offset:3px}
#pages{padding:20px 0}.sheet{width:186mm;height:250mm;margin:0 auto 20px;padding:0;display:flex;flex-direction:column;gap:3mm;background:white;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:5mm;border-bottom:1px solid #17213d;padding-bottom:3mm;flex-shrink:0}.page-head h1{font-size:15pt;line-height:1.15;margin:0 0 1mm}.page-head p{font-size:10pt;margin:0}.name{white-space:nowrap;font-size:10pt;padding-top:1mm}.question-heading{font-size:12pt;line-height:1.3;margin:0;flex-shrink:0}.source-question{display:block;width:180mm;height:auto;max-height:158mm;object-fit:contain;align-self:center;flex-shrink:0}.source-paper{display:block;width:100%;height:100%;object-fit:contain;min-height:0;flex:1}.paper-sheet{gap:0}
.workspace{min-height:45mm;flex:1;display:flex;flex-direction:column;border-top:1px solid #a8a8a8;padding-top:2mm}.workspace-label{font-size:10pt;margin:0 0 1mm}.work-lines{flex:1;background:repeating-linear-gradient(to bottom,transparent 0,transparent 8mm,#d6d6d6 8mm,#d6d6d6 calc(8mm + .15mm));print-color-adjust:exact;-webkit-print-color-adjust:exact}.answer{margin:2mm 0 0;font-size:11pt;font-weight:bold}.page-foot{border-top:1px solid #ccc;padding-top:2mm;display:flex;justify-content:space-between;gap:5mm;font-size:8pt;line-height:1.25;flex-shrink:0}
@page{size:auto;margin:12mm}@media print{body{background:white;color:#000}.toolbar{display:none!important}#pages{padding:0}.sheet{margin:0;width:186mm;height:250mm;max-width:100%;box-shadow:none}.page-head{color:#000}.work-lines{background:none;border-top:1px solid #e0e0e0;margin-top:6mm}.page-foot{color:#444}}
@media screen{.sheet{padding:5mm;box-sizing:content-box;box-shadow:0 2px 12px #0002}.toolbar p{max-width:55ch}}@media screen and (max-width:760px){.toolbar{position:static;padding:12px;flex-wrap:wrap}#pages{overflow-x:auto;padding:12px}.sheet{margin-left:0;margin-right:0}}
`;

/** All question wording, diagrams and A-E choices come from original artwork. */
export function bossWorkbookDocument(challenge: BossChallenge, origin: string): string {
  const test = bossWorkbook(challenge);
  const sheets = test.pages.map((page, index) => {
    const src = new URL(`${basePath}${page.src}`, origin).href;
    const numbers = page.questionNumbers;
    const questionLabel = numbers.length === 1 ? `Question ${numbers[0]}` : `Questions ${numbers[0]}-${numbers.at(-1)}`;
    const image = `<img class="${test.layout === "paper" ? "source-paper" : "source-question"}" src="${escapeHtml(src)}" width="${page.width}" height="${page.height}" alt="${escapeHtml(questionLabel)}: original question artwork and answer choices">`;
    if (test.layout === "paper") {
      return `<article class="sheet paper-sheet" data-question-numbers="${numbers.join(",")}" aria-label="${escapeHtml(questionLabel)}">${image}</article>`;
    }
    return `<article class="sheet" data-question-numbers="${numbers.join(",")}">
<header class="page-head"><div><h1>Math Kangaroo ${test.year}</h1><p>Boss Challenge - Grades 1 and 2</p></div><div class="name">Name: __________________</div></header>
<h2 class="question-heading">Question ${numbers[0]} of ${test.questionCount}</h2>${image}
<section class="workspace" aria-label="Pencil and paper working space"><p class="workspace-label">My working</p><div class="work-lines"></div><p class="answer">My answer: __________</p></section>
<footer class="page-foot"><span>Math Kangaroo USA ${test.year} - Grades 1 and 2</span><span>Page ${index + 1} of ${test.pages.length}</span></footer></article>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(challenge.title)} - Full test workbook</title><style>${stylesheet}</style></head><body data-print-ready="false" data-boss-year="${test.year}"><div class="toolbar"><p id="print-status" role="status">Preparing all ${test.questionCount} questions...</p><button id="print-workbook" type="button" disabled>Print whole test</button></div><main id="pages">${sheets}</main></body></html>`;
}

async function waitForWorkbook(popup: Window, challenge: BossChallenge): Promise<void> {
  const test = bossWorkbook(challenge);
  let timeout = 0;
  let closed = 0;
  const unavailable = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error("Some test images did not load. Please try again.")), 20000);
    closed = window.setInterval(() => { if (popup.closed) reject(new Error("Workbook window closed.")); }, 250);
  });
  try {
    await Promise.race([
      Promise.all([
        ...Array.from(popup.document.images).map(async (image, index) => {
          await image.decode();
          const expected = test.pages[index];
          if (!expected || image.naturalWidth !== expected.width || image.naturalHeight !== expected.height) {
            throw new Error("A test image has changed. Reload the page and try again.");
          }
        }),
        popup.document.fonts.ready,
      ]),
      unavailable,
    ]);
  } finally {
    window.clearTimeout(timeout); window.clearInterval(closed);
  }
}

/** Open synchronously from the click; print only when every original page is ready. */
export async function printBossWorkbook(challenge: BossChallenge): Promise<void> {
  const test = bossWorkbook(challenge);
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow popups to print this test, then try again.");
  popup.opener = null;
  popup.document.open();
  popup.document.write(bossWorkbookDocument(challenge, window.location.origin));
  popup.document.close();
  const status = popup.document.getElementById("print-status")!;
  const button = popup.document.getElementById("print-workbook") as HTMLButtonElement;
  try {
    await waitForWorkbook(popup, challenge);
    if (popup.closed) return;
    for (const page of Array.from(popup.document.querySelectorAll<HTMLElement>(".sheet"))) {
      const contentBottom = page.getBoundingClientRect().bottom - parseFloat(popup.getComputedStyle(page).paddingBottom);
      const last = page.lastElementChild!;
      if (last.getBoundingClientRect().bottom > contentBottom + 1) throw new Error("A test page could not fit. Please try again.");
    }
    popup.document.body.dataset.printReady = "true";
    status.textContent = `${challenge.title} - All ${test.questionCount} questions - ${test.pages.length} pages. Print or choose Save as PDF.`;
    button.disabled = false;
    const print = () => { if (!popup.closed) { popup.focus(); popup.print(); } };
    button.addEventListener("click", print);
    print();
  } catch (error) {
    if (popup.closed) return;
    const message = error instanceof Error && error.name !== "EncodingError" ? error.message : "Some test images did not load. Please try again.";
    status.textContent = `${message} Close this window and try Print whole test again.`;
    status.setAttribute("role", "alert");
    throw new Error(message);
  }
}
