import { QUESTIONS_BY_STOP, stopsForWorld, type WorldDefinition, type WorldQuestion } from "./world-data.ts";
import imageCrops from "./workbook-image-crops.json" with { type: "json" };

type PrintAsset = { src: string; width: number; height: number; sha256: string };
type Crop = { printAsset?: PrintAsset; assetSha256: string; sourceTop: number; sourceBottom: number; sourceLeft?: number; sourceRight?: number; clarification?: string; answerLabelNote?: string };
type Artwork = { src: string; width: number; height: number; left: number; right: number; top: number; bottom: number };
type WorkbookEntry = {
  question: WorldQuestion;
  stopId: string;
  stopLabel: string;
  questionNumber: number;
  questionCount: number;
  answerInstruction: string;
};
type WorkbookPacket = { title: string; subtitle: string; entries: readonly WorkbookEntry[] };
const crops = imageCrops.crops as Record<string, Crop>;
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Use the exact stop and question order the child will see when entering answers. */
export function workbookQuestions(world: WorldDefinition) {
  return stopsForWorld(world.id).flatMap((stop, stopIndex) =>
    (QUESTIONS_BY_STOP.get(stop.id) ?? []).map((question, questionIndex) => ({ stop, stopIndex, question, questionIndex })),
  );
}

/** Preserve the snapshotted review sequence, with one stop numbered from 1. */
export function dangerWorkbookQuestions(dangerId: string, questions: readonly WorldQuestion[]): WorkbookEntry[] {
  if (questions.length === 0 || questions.length > 24) throw new Error("A danger workbook must contain between 1 and 24 questions.");
  return questions.map((question, index) => ({
    question,
    stopId: dangerId,
    stopLabel: "Stop 1 · Sea review",
    questionNumber: index + 1,
    questionCount: questions.length,
    answerInstruction: `Enter your answer in the danger’s review stop, Question ${index + 1}.`,
  }));
}

const stylesheet = `
*{box-sizing:border-box}body{margin:0;color:#17213d;background:#e9e8e3;font-family:Arial,Helvetica,sans-serif}
.toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;background:#fbf8f0;border-bottom:1px solid #cfcabd}
.toolbar p{margin:0;font-size:14px;line-height:1.4}.toolbar button{min-height:44px;padding:10px 22px;border:0;border-radius:24px;background:#17213d;color:white;font:700 15px Arial;cursor:pointer}.toolbar button:disabled{opacity:.5;cursor:wait}.toolbar button:focus-visible{outline:3px solid #1679d2;outline-offset:3px}
#pages{padding:20px 0}.sheet{width:186mm;height:250mm;margin:0 auto 20px;padding:0;display:flex;flex-direction:column;gap:3mm;background:white;break-after:page;page-break-after:always;overflow:visible}
.sheet:last-child{break-after:auto;page-break-after:auto}.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:5mm;border-bottom:1px solid #17213d;padding-bottom:3mm;flex-shrink:0}.page-head h1{font-size:15pt;line-height:1.15;margin:0 0 1mm}.page-head p{font-size:10pt;margin:0}.name{white-space:nowrap;font-size:10pt;padding-top:1mm}
.question-heading{font-size:12pt;line-height:1.3;margin:0;flex-shrink:0}.question-heading span{font-weight:normal;font-size:10pt;margin-left:3mm}.clarification{margin:0;font-size:11pt;line-height:1.35;flex-shrink:0}.answer-label-note{margin:0;font-size:9pt;line-height:1.35;flex-shrink:0}.artwork{align-self:center;display:flex;align-items:center;flex-direction:column;gap:2mm;flex-shrink:0}.fragment{position:relative;overflow:hidden;flex-shrink:0}.fragment img{position:absolute;left:0;max-width:none;display:block}
.workspace{min-height:38mm;flex:1;display:flex;flex-direction:column;border-top:1px solid #a8a8a8;padding-top:2mm}.workspace-label{font-size:10pt;margin:0 0 1mm}.work-lines{flex:1;background:repeating-linear-gradient(to bottom,transparent 0,transparent 8mm,#d6d6d6 8mm,#d6d6d6 calc(8mm + .15mm));print-color-adjust:exact;-webkit-print-color-adjust:exact}.answer{margin:2mm 0 0;font-size:11pt;font-weight:bold}.page-foot{border-top:1px solid #ccc;padding-top:2mm;display:flex;justify-content:space-between;gap:5mm;font-size:8pt;line-height:1.25;flex-shrink:0}
@page{size:auto;margin:12mm} @media print{body{background:white;color:#000}.toolbar{display:none!important}#pages{padding:0}.sheet{margin:0;width:186mm;height:250mm;max-width:100%;box-shadow:none}.page-head{color:#000}.work-lines{background:none;border-top:1px solid #e0e0e0;margin-top:6mm}.page-foot{color:#444}}
@media screen{.sheet{padding:5mm;box-sizing:content-box;box-shadow:0 2px 12px #0002}.toolbar{min-width:0}.toolbar p{max-width:55ch}}
@media screen and (max-width:760px){.toolbar{position:static;padding:12px;flex-wrap:wrap}#pages{overflow-x:auto;padding:12px}.sheet{margin-left:0;margin-right:0}}
`;

function loadImage(popup: Window, src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = popup.document.createElement("img");
    const timeout = window.setTimeout(() => finish(new Error("Some question images did not load. Please try printing again.")), 20000);
    const closed = window.setInterval(() => { if (popup.closed) finish(new Error("Workbook window closed.")); }, 250);
    let settled = false;
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout); window.clearInterval(closed);
      image.onload = null; image.onerror = null;
      if (error) reject(error); else resolve(image);
    }
    image.onload = () => { void image.decode().then(() => finish(), () => finish(new Error("A question image could not be prepared. Please try again."))); };
    image.onerror = () => finish(new Error("Some question images did not load. Please try printing again."));
    image.src = src;
  });
}

/** Keep the publisher's complete question in one coordinate system. A crop
 * removes neighboring material; it never reflows text or relocates choices. */
export function workbookArtwork(question: WorldQuestion) {
  const crop = crops[question.id];
  if (question.id.startsWith("oasis-online-") && !crop) throw new Error("This question crop needs an update before it can be printed.");
  if (crop && crop.assetSha256 !== question.asset.sha256) throw new Error("The question artwork has changed. Reload the page and try again.");
  const asset = crop?.printAsset ?? question.asset;
  const top = crop?.sourceTop ?? 0, bottom = crop?.sourceBottom ?? asset.height;
  const left = crop?.sourceLeft ?? 0, right = crop?.sourceRight ?? asset.width;
  if (![top, bottom, left, right].every(Number.isInteger) || top < 0 || bottom > asset.height || bottom <= top || left < 0 || right > asset.width || right <= left) {
    throw new Error("A question image could not be prepared. Please try again.");
  }
  return { asset, top, bottom, left, right };
}

function artworkFor(question: WorldQuestion, image: HTMLImageElement, src: string): Artwork {
  const { asset, ...bounds } = workbookArtwork(question);
  if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) throw new Error("A question image has changed. Reload the page and try again.");
  return { src, width: asset.width, height: asset.height, ...bounds };
}

function renderArtwork(art: Artwork, scale = 1): string {
  const width = 180 * scale;
  const factor = width / (art.right - art.left);
  return `<div class="fragment" data-intact-layout="true" data-source-left="${art.left}" data-source-right="${art.right}" data-source-top="${art.top}" data-source-bottom="${art.bottom}" style="width:${width}mm;height:${(art.bottom - art.top) * factor}mm"><img src="${escapeHtml(art.src)}" alt="Question artwork and answer choices" width="${art.width}" height="${art.height}" style="width:${art.width * factor}mm;height:${art.height * factor}mm;left:${-art.left * factor}mm;top:${-art.top * factor}mm"></div>`;
}

function sheet(packet: WorkbookPacket, entry: WorkbookEntry, artwork: Artwork, index: number, count: number): string {
  const { question, stopId, stopLabel, questionNumber, questionCount, answerInstruction } = entry;
  // Only reviewed repairs/translations supplement the source image. Printing
  // never reconstructs its text or lays out answer controls.
  const crop = crops[question.id];
  const clarifications = [...new Set([question.showPrompt ? question.prompt : undefined, crop?.clarification].filter((text): text is string => Boolean(text)))];
  const clarification = clarifications.map(text => `<p class="clarification">${escapeHtml(text)}</p>`).join("");
  const answerLabelNote = crop?.answerLabelNote ? `<p class="answer-label-note">${escapeHtml(crop.answerLabelNote)}</p>` : "";
  return `<article class="sheet" data-question-id="${escapeHtml(question.id)}" data-stop-id="${escapeHtml(stopId)}" data-question-number="${questionNumber}">
<header class="page-head"><div><h1>${escapeHtml(packet.title)}</h1><p>${escapeHtml(packet.subtitle)}</p></div><div class="name">Name: __________________</div></header>
<h2 class="question-heading">${escapeHtml(stopLabel)}<span>Question ${questionNumber} of ${questionCount}</span></h2>
${clarification}
<div class="artwork">${renderArtwork(artwork)}</div>
${answerLabelNote}
<section class="workspace" aria-label="Pencil and paper working space"><p class="workspace-label">My working</p><div class="work-lines"></div><p class="answer">My answer: __________</p></section>
<footer class="page-foot"><span>${escapeHtml(answerInstruction)}</span><span>Page ${index + 1} of ${count}</span></footer></article>`;
}

async function waitForDocumentImages(popup: Window): Promise<void> {
  let timeout = 0;
  let closed = 0;
  const unavailable = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error("The workbook is not ready to print. Please try again.")), 20000);
    closed = window.setInterval(() => { if (popup.closed) reject(new Error("Workbook window closed.")); }, 250);
  });
  try {
    await Promise.race([
      Promise.all([...Array.from(popup.document.images).map(image => image.decode()), popup.document.fonts.ready]),
      unavailable,
    ]);
  } finally {
    window.clearTimeout(timeout); window.clearInterval(closed);
  }
}

/** The popup opens during the original click, before any asynchronous work. */
export async function printWorldWorkbook(world: WorldDefinition): Promise<void> {
  return printWorkbook({
    title: world.title,
    subtitle: `World ${world.number} · ${world.concept} ${world.spiral}`,
    entries: workbookQuestions(world).map(({ question, stop, stopIndex, questionIndex }) => ({
      question,
      stopId: stop.id,
      stopLabel: `Stop ${stopIndex + 1} · ${stop.shortLabel}`,
      questionNumber: questionIndex + 1,
      questionCount: QUESTIONS_BY_STOP.get(stop.id)?.length ?? 0,
      answerInstruction: `Enter your answer in World ${world.number}, Stop ${stopIndex + 1}, Question ${questionIndex + 1}.`,
    })),
  });
}

/** Print the same immutable packet used by the danger's single review stop. */
export async function printDangerWorkbook(title: string, dangerId: string, questions: readonly WorldQuestion[]): Promise<void> {
  return printWorkbook({ title, subtitle: "Oceania · Danger review", entries: dangerWorkbookQuestions(dangerId, questions) });
}

async function printWorkbook(packet: WorkbookPacket): Promise<void> {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow popups to print this workbook, then try again.");
  popup.opener = null;
  const { entries } = packet;
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(packet.title)} - Workbook</title><style>${stylesheet}</style></head><body data-print-ready="false"><div class="toolbar"><p id="print-status" role="status">Preparing all ${entries.length} questions…</p><button id="print-workbook" type="button" disabled>Print workbook</button></div><main id="pages"></main></body></html>`);
  popup.document.close();
  const status = popup.document.getElementById("print-status")!;
  const button = popup.document.getElementById("print-workbook") as HTMLButtonElement;
  try {
    const art = await Promise.all(entries.map(async ({ question }) => {
      const { asset } = workbookArtwork(question);
      const src = new URL(`${basePath}${asset.src}`, window.location.origin).href;
      const image = await loadImage(popup, src);
      return artworkFor(question, image, src);
    }));
    if (popup.closed) return;
    popup.document.getElementById("pages")!.innerHTML = entries.map((entry, index) => sheet(packet, entry, art[index], index, entries.length)).join("");
    await waitForDocumentImages(popup);
    if (popup.closed) return;
    // Fit each source image while reserving at least 38mm for pencil work.
    for (const [index, page] of Array.from(popup.document.querySelectorAll<HTMLElement>(".sheet")).entries()) {
      const artwork = page.querySelector<HTMLElement>(".artwork")!;
      const workspace = page.querySelector<HTMLElement>(".workspace")!;
      const footer = page.querySelector<HTMLElement>(".page-foot")!;
      const pageStyle = popup.getComputedStyle(page);
      const bottom = page.getBoundingClientRect().bottom - parseFloat(pageStyle.paddingBottom);
      let scale = 1;
      for (let adjustment = 0; adjustment < 4; adjustment++) {
        const overflow = footer.getBoundingClientRect().bottom - bottom;
        if (overflow <= .5) break;
        const height = artwork.getBoundingClientRect().height;
        scale *= Math.max(.1, (height - overflow - 4) / height);
        artwork.innerHTML = renderArtwork(art[index], scale);
      }
      if (footer.getBoundingClientRect().bottom > bottom + .5) throw new Error("A workbook page could not fit. Please try again.");
      workspace.dataset.minimumHeight = "38mm";
    }
    await waitForDocumentImages(popup);
    if (popup.closed) return;
    popup.document.body.dataset.printReady = "true";
    status.textContent = `${packet.title} · ${entries.length} questions · Print or choose Save as PDF.`;
    button.disabled = false;
    const print = () => { if (!popup.closed) { popup.focus(); popup.print(); } };
    button.addEventListener("click", print);
    print();
  } catch (error) {
    if (popup.closed) return;
    const message = error instanceof Error ? error.message : "This workbook could not be prepared. Please try again.";
    status.textContent = `${message} Close this window and try Print workbook again.`;
    status.setAttribute("role", "alert");
    throw new Error(message);
  }
}
