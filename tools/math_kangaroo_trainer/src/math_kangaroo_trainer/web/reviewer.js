"use strict";

const API = Object.freeze({
  progress: "/api/progress",
  items: "/api/items",
  duplicates: "/api/duplicates",
});

const ITEM_CHECKS = Object.freeze([
  "question_boundary_verified",
  "choices_verified",
  "answer_key_verified",
  "diagram_verified",
  "source_metadata_verified",
]);

const CONTENT_GAP_CODES = new Set([
  "OFFICIAL_SOLUTION_NOT_AVAILABLE",
  "OCR_CONFIDENCE_NOT_AVAILABLE",
  "PUBLISHED_POINT_TIER_UNKNOWN",
]);

const SOURCE_FIELDS = Object.freeze([
  ["source_collection", "Collection"],
  ["source_family", "Source family"],
  ["source_label", "Source"],
  ["contest", "Contest"],
  ["year", "Year"],
  ["grade", "Grade"],
  ["grade_band", "Grade band"],
  ["contest_track_or_grade_band", "Grade band"],
  ["paper_part", "Paper part"],
  ["question_number", "Question"],
  ["published_point_value_or_tier", "Point tier"],
  ["point_tier", "Point tier"],
  ["page", "Page"],
  ["end_page", "End page"],
  ["language", "Language"],
  ["modality", "Modality"],
  ["answer_status", "Answer status"],
  ["extraction_status", "Extraction status"],
]);

const state = {
  progress: null,
  activeView: "overview",
  item: {
    summaries: [],
    index: 0,
    payload: null,
    detail: null,
    reviewed: new Set(),
    loading: false,
    saving: false,
  },
  duplicate: {
    summaries: [],
    index: 0,
    payload: null,
    detail: null,
    reviewed: new Set(),
    loading: false,
    saving: false,
  },
  retry: null,
};

const byId = (id) => document.getElementById(id);

function announce(message) {
  const region = byId("live-message");
  region.textContent = "";
  window.requestAnimationFrame(() => {
    region.textContent = message;
  });
}

function primitive(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyRecord(value) {
  const record = asRecord(value);
  return Object.keys(record).length ? record : null;
}

function displayValue(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function textValue(...values) {
  const value = firstDefined(...values);
  return primitive(value) ? String(value) : "";
}

function finiteNumber(...values) {
  for (const value of values) {
    if (typeof value === "boolean" || value === "" || value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function safeSameOriginUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && ["http:", "https:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function safeSourceLink(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function configuredValue(sources, fallback) {
  for (const [recordValue, keys] of sources) {
    const record = asRecord(recordValue);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
    }
  }
  return fallback;
}

function itemEndpoint(itemId, suffix = "") {
  return `${API.items}/${encodeURIComponent(itemId)}${suffix}`;
}

function duplicateEndpoint(groupId) {
  return `${API.duplicates}/${encodeURIComponent(groupId)}`;
}

async function requestJson(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...requestOptions,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  });

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      // Never display a local server's HTML error response in the private UI.
    }
  }

  if (!response.ok) {
    const errorRecord = asRecord(payload && payload.error);
    const message = payload && typeof payload.error === "string"
      ? payload.error
      : typeof errorRecord.message === "string"
        ? errorRecord.message
        : `The local reviewer API returned ${response.status}.`;
    throw new Error(message);
  }
  if (!responseText) return {};
  if (!payload || typeof payload !== "object") {
    throw new Error("The local reviewer API returned an invalid JSON response.");
  }
  return payload;
}

function showError(error, retry) {
  state.retry = retry;
  byId("error-message").textContent = error instanceof Error
    ? error.message
    : "An unknown local review error occurred.";
  byId("error-banner").hidden = false;
  byId("connection-badge").textContent = "Local API error";
  byId("connection-badge").className = "connection-badge is-error";
  announce("The review could not be loaded. Use Try again to retry.");
}

function clearError() {
  state.retry = null;
  byId("error-banner").hidden = true;
  byId("connection-badge").textContent = "Local API connected";
  byId("connection-badge").className = "connection-badge";
}

function summaryList(payload, key) {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  const aliases = key === "duplicates" ? ["duplicates", "duplicate_groups"] : [key];
  for (const alias of aliases) {
    if (Array.isArray(record[alias])) return record[alias];
  }
  const nested = asRecord(aliases.map((alias) => record[alias]).find((value) => value));
  return asArray(firstDefined(
    nested.summaries,
    nested.results,
    record.summaries,
    record.results,
  ));
}

function summaryHasReview(raw, kind) {
  if (raw.reviewed === true || raw.complete === true || raw.completed === true) return true;
  if (nonEmptyRecord(raw.current_review)) return true;
  const decisionKey = kind === "item" ? "disposition" : "decision";
  if (typeof raw[decisionKey] === "string" && raw[decisionKey]) return true;
  const currentDecisionKey = kind === "item" ? "current_disposition" : "current_decision";
  if (typeof raw[currentDecisionKey] === "string" && raw[currentDecisionKey]) return true;
  const reviewState = textValue(raw.review_state, raw.status).toLowerCase();
  return ["reviewed", "saved", "needs_attention", "complete", "completed"].includes(reviewState);
}

function normalizeSummaries(payload, kind) {
  const key = kind === "item" ? "items" : "duplicates";
  const entries = summaryList(payload, key);
  const seen = new Set();
  const summaries = [];
  for (const entry of entries) {
    const raw = asRecord(entry);
    const idValue = primitive(entry)
      ? entry
      : firstDefined(
        kind === "item" ? raw.item_id : raw.group_id,
        kind === "duplicate" ? raw.duplicate_id : undefined,
        raw.id,
      );
    if (!primitive(idValue) || String(idValue).trim() === "") continue;
    const id = String(idValue);
    if (seen.has(id)) continue;
    seen.add(id);
    summaries.push({
      id,
      reviewed: summaryHasReview(raw, kind),
      raw,
    });
  }
  return summaries;
}

function progressBlock(queue) {
  const progress = asRecord(state.progress);
  const counts = asRecord(progress.counts);
  const progressKey = queue === "duplicates" ? "duplicate_groups" : queue;
  const nested = asRecord(firstDefined(progress[progressKey], counts[progressKey], counts[queue]));
  const singular = queue === "items" ? "item" : "duplicate";
  const target = queue === "items" ? state.item : state.duplicate;
  const reviewedRaw = firstDefined(
    nested.reviewed,
    nested.reviewed_count,
    nested.saved,
    nested.completed,
    progress[`${queue}_reviewed`],
    progress[`${singular}_reviewed`],
    progress[`${queue}_reviewed_count`],
  );
  const reviewedFromApi = Array.isArray(reviewedRaw)
    ? reviewedRaw.length
    : finiteNumber(reviewedRaw);
  const total = Math.max(0, Math.trunc(firstDefined(finiteNumber(
    nested.total,
    progress[`${queue}_total`],
    progress[`${singular}_total`],
  ), target.summaries.length)));
  const reviewed = Math.min(
    total,
    Math.max(0, Math.trunc(firstDefined(reviewedFromApi, 0)), target.reviewed.size),
  );
  const reportedRemaining = Math.max(0, Math.trunc(firstDefined(finiteNumber(
    nested.remaining,
    progress[`${queue}_remaining`],
    progress[`${singular}_remaining`],
  ), total - reviewed)));
  const remaining = Math.min(total - reviewed, reportedRemaining);
  const currentId = textValue(
    nested.current_id,
    nested[`current_${singular}_id`],
    nested.next_item_id,
    nested.next_group_id,
    progress[`current_${singular}_id`],
  );
  const currentIndex = finiteNumber(
    nested.current_index,
    progress[`current_${singular}_index`],
  );
  return { total, reviewed, remaining, currentId, currentIndex };
}

function renderReviewerIdentity(progress) {
  const record = asRecord(progress);
  const reviewer = asRecord(record.reviewer);
  const explicitSlot = finiteNumber(record.reviewer_slot, reviewer.slot, reviewer.reviewer_slot);
  if (!Number.isInteger(explicitSlot) || ![1, 2].includes(explicitSlot)) {
    throw new Error("The local API did not assign Reviewer slot 1 or 2.");
  }
  const otherSlot = 3 - explicitSlot;
  const reviewerId = textValue(record.reviewer_id, reviewer.id, reviewer.reviewer_id, "Reviewer");
  byId("reviewer-name").textContent = reviewerId;
  byId("reviewer-slot").textContent = `Slot ${explicitSlot}`;
  byId("overview-slot").textContent = String(explicitSlot);
  byId("independence-message").textContent =
    `This session is Reviewer slot ${explicitSlot}. A different person must complete slot ${otherSlot} independently.`;
}

function appendDefinition(container, label, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = displayValue(value);
  wrapper.append(dt, dd);
  container.append(wrapper);
}

function renderProgress() {
  const itemProgress = progressBlock("items");
  const duplicateProgress = progressBlock("duplicates");
  byId("overview-item-progress").textContent =
    `${itemProgress.reviewed} of ${itemProgress.total} reviewed · ${itemProgress.remaining} remaining`;
  byId("overview-duplicate-progress").textContent =
    `${duplicateProgress.reviewed} of ${duplicateProgress.total} reviewed · ${duplicateProgress.remaining} remaining`;

  const progress = asRecord(state.progress);
  const ontology = asRecord(progress.ontology);
  const stage = asRecord(firstDefined(progress.stage0, progress.stage_0));
  const quality = asRecord(progress.quality);
  const status = firstDefined(progress.status, progress.review_status, stage.status, quality.status);
  const ready = firstDefined(progress.ready, progress.stage0_ready, stage.ready);
  const ontologyStatus = firstDefined(
    progress.ontology_status,
    ontology.status,
    stage.ontology_status,
  );
  const summary = byId("status-summary");
  summary.replaceChildren();
  const reviewer = asRecord(asRecord(state.progress).reviewer);
  const reviewerSlot = finiteNumber(reviewer.reviewer_slot, reviewer.slot);
  appendDefinition(summary, "Reviewer slot", `${reviewerSlot ?? "—"} of 2 (independent)`);
  appendDefinition(summary, "Questions reviewed", `${itemProgress.reviewed} of ${itemProgress.total}`);
  appendDefinition(summary, "Questions remaining", itemProgress.remaining);
  appendDefinition(summary, "Duplicate candidates reviewed", `${duplicateProgress.reviewed} of ${duplicateProgress.total}`);
  appendDefinition(summary, "Duplicate candidates remaining", duplicateProgress.remaining);
  if (primitive(status)) appendDefinition(summary, "Stage 0 status", status);
  if (primitive(quality.reason)) appendDefinition(summary, "Status reason", quality.reason);
  if (primitive(quality.faithful_parsing_rate)) {
    appendDefinition(summary, "Faithful parsing rate", quality.faithful_parsing_rate);
  }
  if (primitive(quality.double_reviewed_items)) {
    appendDefinition(summary, "Double-reviewed questions", quality.double_reviewed_items);
  }
  if (primitive(quality.duplicate_review_complete)) {
    appendDefinition(summary, "Duplicate review complete", quality.duplicate_review_complete);
  }
  if (primitive(ready)) appendDefinition(summary, "Stage 0 ready", ready);
  appendDefinition(
    summary,
    "Ontology gate",
    primitive(ontologyStatus) ? ontologyStatus : "Pending read-only review",
  );
  summary.hidden = false;
  byId("status-loading").hidden = true;
}

function chooseInitialIndex(target, progress) {
  if (!target.summaries.length) return 0;
  if (progress.currentId) {
    const byIdentifier = target.summaries.findIndex((summary) => summary.id === progress.currentId);
    if (byIdentifier >= 0) return byIdentifier;
  }
  if (Number.isInteger(progress.currentIndex)
      && progress.currentIndex >= 0
      && progress.currentIndex < target.summaries.length) {
    return progress.currentIndex;
  }
  const firstUnreviewed = target.summaries.findIndex((summary) => !summary.reviewed);
  return firstUnreviewed >= 0 ? firstUnreviewed : 0;
}

function installSummaries(itemPayload, duplicatePayload) {
  state.item.summaries = normalizeSummaries(itemPayload, "item");
  state.duplicate.summaries = normalizeSummaries(duplicatePayload, "duplicate");
  state.item.reviewed = new Set(
    state.item.summaries.filter((summary) => summary.reviewed).map((summary) => summary.id),
  );
  state.duplicate.reviewed = new Set(
    state.duplicate.summaries.filter((summary) => summary.reviewed).map((summary) => summary.id),
  );
  state.item.index = chooseInitialIndex(state.item, progressBlock("items"));
  state.duplicate.index = chooseInitialIndex(state.duplicate, progressBlock("duplicates"));
  byId("items-tab-count").textContent = String(state.item.summaries.length);
  byId("duplicates-tab-count").textContent = String(state.duplicate.summaries.length);
  updateQueueNavigation("item");
  updateQueueNavigation("duplicate");
}

function setActiveView(view) {
  state.activeView = view;
  for (const name of ["overview", "items", "duplicates", "status"]) {
    const active = name === view;
    const tab = byId(`${name}-tab`);
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    byId(`${name}-view`).hidden = !active;
  }
  if (view === "items" && !state.item.payload) void loadItem(state.item.index);
  if (view === "duplicates" && !state.duplicate.payload) void loadDuplicate(state.duplicate.index);
  if (view === "status") renderProgress();
}

function setQueueLoading(prefix, loading) {
  const target = prefix === "item" ? state.item : state.duplicate;
  target.loading = loading;
  byId(`${prefix}-loading`).hidden = !loading && Boolean(target.payload);
  byId(`${prefix}-content`).hidden = loading || !target.payload;
  updateQueueNavigation(prefix);
}

function showEmptyQueue(prefix) {
  const noun = prefix === "item" ? "question records" : "duplicate candidates";
  const loading = byId(`${prefix}-loading`);
  loading.textContent = `No ${noun} are available in this Stage 0 review sample.`;
  loading.hidden = false;
  byId(`${prefix}-content`).hidden = true;
  updateQueueNavigation(prefix);
}

function updateQueueNavigation(prefix) {
  const target = prefix === "item" ? state.item : state.duplicate;
  const total = target.summaries.length;
  const noun = prefix === "item" ? "Question" : "Candidate";
  const ordinal = total ? target.index + 1 : 0;
  const busy = target.loading || target.saving;
  byId(`${prefix}-position`).textContent = `${noun} ${ordinal} of ${total}`;
  const progress = byId(`${prefix}-progress`);
  progress.max = Math.max(total, 1);
  progress.value = ordinal;
  progress.textContent = `${ordinal} of ${total}`;
  byId(`${prefix}-progress-label`).textContent = `${noun} progress: ${ordinal} of ${total}`;
  byId(`${prefix}-previous`).disabled = busy || target.index <= 0;
  byId(`${prefix}-next`).disabled = busy || total === 0 || target.index >= total - 1;
  const jump = byId(`${prefix}-jump`);
  jump.max = String(Math.max(total, 1));
  jump.disabled = busy || total === 0;
  jump.value = total ? String(target.index + 1) : "";
  renderJumpList(prefix);
}

function renderJumpList(prefix) {
  const target = prefix === "item" ? state.item : state.duplicate;
  const list = byId(`${prefix}-jump-list`);
  const fragment = document.createDocumentFragment();
  target.summaries.forEach((summary, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const reviewed = target.reviewed.has(summary.id);
    button.type = "button";
    button.textContent = String(index + 1);
    button.dataset.index = String(index);
    button.disabled = target.loading || target.saving;
    button.setAttribute(
      "aria-label",
      `${prefix === "item" ? "Question" : "Duplicate candidate"} ${index + 1}${reviewed ? ", saved in this slot" : ""}`,
    );
    if (index === target.index) button.setAttribute("aria-current", "true");
    if (reviewed) button.classList.add("is-reviewed");
    li.append(button);
    fragment.append(li);
  });
  list.replaceChildren(fragment);
}

function normalizedCode(entry) {
  if (primitive(entry)) return String(entry);
  const record = asRecord(entry);
  const code = textValue(record.code, record.warning_code, record.gap_code, record.id);
  const message = textValue(record.message, record.label, record.description);
  if (code && message && code !== message) return `${code} — ${message}`;
  return code || message;
}

function codeIdentifier(entry) {
  if (primitive(entry)) return String(entry);
  const record = asRecord(entry);
  return textValue(record.code, record.warning_code, record.gap_code, record.id);
}

function normalizeCodes(value) {
  return asArray(value).map(normalizedCode).filter(Boolean);
}

function normalizedChoice(choice) {
  if (primitive(choice)) return String(choice);
  const record = asRecord(choice);
  return textValue(record.text, record.choice_text, record.value, record.label);
}

function normalizedItem(payload, requestedId = "") {
  const payloadRecord = asRecord(payload);
  const raw = asRecord(firstDefined(payloadRecord.item, payloadRecord));
  const protectedAnswer = asRecord(firstDefined(raw.protected_answer, raw.protected));
  const source = asRecord(firstDefined(raw.source_metadata, raw.source));
  const urls = asRecord(raw.urls);
  const itemId = textValue(raw.item_id, raw.id, requestedId);
  const warningEntries = asArray(firstDefined(raw.warnings, raw.warning_codes));
  const gapEntries = asArray(firstDefined(raw.gaps, raw.content_gaps, raw.content_gap_codes));
  const derivedGaps = gapEntries.length
    ? gapEntries
    : warningEntries.filter((entry) => CONTENT_GAP_CODES.has(codeIdentifier(entry)));
  const warnings = warningEntries
    .filter((entry) => !CONTENT_GAP_CODES.has(codeIdentifier(entry)))
    .map(normalizedCode)
    .filter(Boolean);
  const gaps = normalizeCodes(derivedGaps);
  const assetFallback = itemId ? itemEndpoint(itemId, "/asset") : null;
  const sourcePdfFallback = itemId ? itemEndpoint(itemId, "/source-pdf") : null;
  const answerKeyFallback = itemId ? itemEndpoint(itemId, "/answer-key") : null;
  const choices = asArray(raw.choices).map(normalizedChoice);
  const sourcePageCandidate = configuredValue([
    [raw, ["source_page_url", "source_page_link"]],
    [urls, ["source_page", "source_page_url"]],
    [source, ["source_page_url", "source_page_link"]],
  ], null);
  return {
    raw,
    protectedAnswer,
    source,
    itemId,
    stem: textValue(raw.stem, raw.prompt, raw.stem_markdown),
    choices,
    officialAnswer: textValue(
      raw.official_answer,
      protectedAnswer.official_answer,
      primitive(raw.protected_answer) ? raw.protected_answer : undefined,
      protectedAnswer.answer,
    ),
    answerStatus: firstDefined(raw.answer_status, protectedAnswer.answer_status, source.answer_status),
    answerSource: firstDefined(
      raw.answer_source_label,
      protectedAnswer.answer_source_label,
      source.answer_source_label,
    ),
    warnings,
    gaps,
    currentReview: nonEmptyRecord(firstDefined(raw.current_review, payloadRecord.current_review)),
    navigation: asRecord(firstDefined(raw.navigation, payloadRecord.navigation)),
    assetUrl: safeSameOriginUrl(configuredValue([
      [raw, ["asset_url", "crop_url", "question_crop_url"]],
      [urls, ["asset", "asset_url"]],
    ], assetFallback)),
    sourcePdfUrl: safeSameOriginUrl(configuredValue([
      [raw, ["source_pdf_url", "source_page_url"]],
      [urls, ["source_pdf", "source_pdf_url", "source_page", "source_page_url"]],
      [source, ["source_pdf_url", "source_page_url"]],
    ], sourcePdfFallback)),
    answerKeyUrl: safeSameOriginUrl(configuredValue([
      [raw, ["answer_key_url"]],
      [urls, ["answer_key", "answer_key_url"]],
      [source, ["answer_key_url"]],
    ], answerKeyFallback)),
    sourcePageUrl: safeSourceLink(sourcePageCandidate),
  };
}

function appendMetadata(container, item) {
  const seen = new Set();
  const fragment = document.createDocumentFragment();
  const sources = [item.raw, item.source, item.protectedAnswer];
  for (const [key, label] of SOURCE_FIELDS) {
    const value = sources
      .map((source) => source[key])
      .find((candidate) => primitive(candidate) && candidate !== "");
    if (value === undefined || seen.has(label)) continue;
    seen.add(label);
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = displayValue(value);
    wrapper.append(dt, dd);
    fragment.append(wrapper);
  }
  if (!fragment.childNodes.length) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = "Source metadata";
    dd.textContent = "No review-safe metadata returned";
    wrapper.append(dt, dd);
    fragment.append(wrapper);
  }
  container.replaceChildren(fragment);
}

function populateChoices(container, choices) {
  const fragment = document.createDocumentFragment();
  if (!choices.length) {
    const li = document.createElement("li");
    li.className = "empty-choice";
    li.textContent = "No parsed text choices. Verify the choices in the crop.";
    fragment.append(li);
  } else {
    for (const choice of choices) {
      const li = document.createElement("li");
      li.textContent = choice || "Blank choice";
      fragment.append(li);
    }
  }
  container.replaceChildren(fragment);
}

function populateCodes(container, values, emptyMessage) {
  const fragment = document.createDocumentFragment();
  if (!values.length) {
    const li = document.createElement("li");
    li.className = "no-warning";
    li.textContent = emptyMessage;
    fragment.append(li);
  } else {
    for (const value of values) {
      const li = document.createElement("li");
      li.textContent = value;
      fragment.append(li);
    }
  }
  container.replaceChildren(fragment);
}

function populateCrop(img, missing, item, altPrefix = "Question") {
  img.hidden = !item.assetUrl;
  missing.hidden = Boolean(item.assetUrl);
  img.alt = `${altPrefix} crop for ${item.itemId}. Review it against the parsed record.`;
  img.removeAttribute("src");
  img.onerror = () => {
    img.hidden = true;
    missing.hidden = false;
  };
  if (item.assetUrl) img.src = item.assetUrl;
}

function setEvidenceLink(element, url) {
  element.hidden = !url;
  if (url) element.href = url;
  else element.removeAttribute("href");
}

function populateItemReview(review) {
  const form = byId("item-review-form");
  for (const name of ITEM_CHECKS) {
    form.elements[name].checked = Boolean(review && review[name]);
  }
  const disposition = review && ["faithful", "needs_review", "rejected"].includes(review.disposition)
    ? review.disposition
    : "needs_review";
  form.elements.disposition.value = disposition;
  form.elements.notes.value = review && typeof review.notes === "string" ? review.notes : "";
  byId("item-saved-state").textContent = review ? "Saved in your slot" : "Not saved";
  byId("item-saved-state").classList.toggle("is-saved", Boolean(review));
  byId("item-form-error").hidden = true;
}

function renderItemResponse(payload, requestedId) {
  const item = normalizedItem(payload, requestedId);
  if (!item.itemId) throw new Error("The item API did not return an item ID.");
  if (item.itemId !== requestedId) {
    throw new Error("The item API returned a different item than the one requested.");
  }
  state.item.payload = payload;
  state.item.detail = item;
  if (item.currentReview) state.item.reviewed.add(item.itemId);
  byId("item-id").textContent = item.itemId;
  byId("question-stem").textContent = item.stem || "No parsed stem was returned.";
  populateChoices(byId("question-choices"), item.choices);
  byId("official-answer").textContent = `Official answer: ${item.officialAnswer || "—"}`;
  byId("answer-source").textContent = [item.answerStatus, item.answerSource]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(displayValue)
    .join(" · ") || "Answer source not recorded";
  appendMetadata(byId("source-metadata"), item);
  populateCodes(byId("warning-list"), item.warnings, "No recorded parser warnings.");
  populateCodes(byId("content-gap-list"), item.gaps, "No recorded content gaps.");
  populateCrop(byId("question-crop"), byId("question-crop-missing"), item);
  setEvidenceLink(byId("source-page-link"), item.sourcePageUrl);
  setEvidenceLink(byId("source-pdf-link"), item.sourcePdfUrl);
  setEvidenceLink(byId("answer-key-link"), item.answerKeyUrl);
  populateItemReview(item.currentReview);
  renderProgress();
  setQueueLoading("item", false);
}

async function loadItem(index) {
  if (state.item.loading || state.item.saving) return;
  if (!state.item.summaries.length) {
    showEmptyQueue("item");
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.item.summaries.length) return;
  const summary = state.item.summaries[index];
  state.item.index = index;
  state.item.payload = null;
  state.item.detail = null;
  setQueueLoading("item", true);
  try {
    const payload = await requestJson(itemEndpoint(summary.id));
    renderItemResponse(payload, summary.id);
    clearError();
    announce(`Loaded question ${index + 1} of ${state.item.summaries.length}.`);
  } catch (error) {
    setQueueLoading("item", false);
    showError(error, () => loadItem(index));
  } finally {
    state.item.loading = false;
    updateQueueNavigation("item");
  }
}

function itemReviewBody() {
  const form = byId("item-review-form");
  const body = Object.fromEntries(
    ITEM_CHECKS.map((name) => [name, Boolean(form.elements[name].checked)]),
  );
  body.disposition = form.elements.disposition.value;
  body.notes = form.elements.notes.value.trim();
  return body;
}

function validateItemReview(body) {
  if (!["faithful", "needs_review", "rejected"].includes(body.disposition)) {
    return "Choose a disposition before saving.";
  }
  if (body.disposition === "faithful" && ITEM_CHECKS.some((name) => !body[name])) {
    return "Faithful requires all five verification checks. Complete them or choose Needs review.";
  }
  return null;
}

function toggleFormBusy(formId, busy) {
  for (const control of byId(formId).elements) control.disabled = busy;
}

function reviewWriteHeaders(currentReview) {
  const etag = currentReview && typeof currentReview.etag === "string"
    ? currentReview.etag
    : "*";
  return { "If-Match": etag };
}

function applyWriteProgress(payload) {
  const progress = nonEmptyRecord(asRecord(payload).progress);
  if (!progress) return false;
  renderReviewerIdentity(progress);
  state.progress = progress;
  renderProgress();
  return true;
}

async function refreshProgress({ announceResult = true, suppressErrors = false } = {}) {
  if (!suppressErrors) {
    byId("status-loading").hidden = false;
    byId("status-summary").hidden = true;
  }
  try {
    const progress = await requestJson(API.progress);
    renderReviewerIdentity(progress);
    state.progress = progress;
    renderProgress();
    clearError();
    if (announceResult) announce("Review status refreshed.");
    return true;
  } catch (error) {
    if (!suppressErrors) {
      byId("status-loading").hidden = true;
      showError(error, () => refreshProgress());
    }
    return false;
  }
}

function nextIndex(target, navigation) {
  const nextId = textValue(navigation.next_id, navigation.next_item_id, navigation.next_group_id);
  if (nextId) {
    const index = target.summaries.findIndex((summary) => summary.id === nextId);
    if (index >= 0) return index;
  }
  return target.index < target.summaries.length - 1 ? target.index + 1 : null;
}

async function saveItem(advance) {
  if (state.item.loading || state.item.saving || !state.item.detail) return;
  const body = itemReviewBody();
  const errorMessage = validateItemReview(body);
  const formError = byId("item-form-error");
  if (errorMessage) {
    formError.textContent = errorMessage;
    formError.hidden = false;
    announce(errorMessage);
    return;
  }
  formError.hidden = true;
  state.item.saving = true;
  toggleFormBusy("item-review-form", true);
  updateQueueNavigation("item");
  const itemId = state.item.detail.itemId;
  const destination = advance ? nextIndex(state.item, state.item.detail.navigation) : null;
  try {
    const response = await requestJson(itemEndpoint(itemId), {
      method: "POST",
      body: JSON.stringify(body),
      headers: reviewWriteHeaders(state.item.detail.currentReview),
    });
    state.item.reviewed.add(itemId);
    state.item.summaries[state.item.index].reviewed = true;
    state.item.detail.currentReview = nonEmptyRecord(asRecord(response).review) || body;
    byId("item-saved-state").textContent = "Saved in your slot";
    byId("item-saved-state").classList.add("is-saved");
    clearError();
    if (!applyWriteProgress(response)) renderProgress();
    renderJumpList("item");
    announce(`Saved your independent review for question ${state.item.index + 1}.`);
  } catch (requestError) {
    showError(requestError, () => saveItem(advance));
    return;
  } finally {
    state.item.saving = false;
    toggleFormBusy("item-review-form", false);
    updateQueueNavigation("item");
  }
  if (destination !== null) await loadItem(destination);
}

function appendMemberEvidenceLink(container, label, url) {
  if (!url) return;
  const link = document.createElement("a");
  link.className = "source-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${label} ↗`;
  container.append(link);
}

function duplicateMemberCard(member, index) {
  const item = normalizedItem(member);
  const article = document.createElement("article");
  article.className = "duplicate-member";
  article.setAttribute("aria-labelledby", `duplicate-member-${index}-heading`);

  const header = document.createElement("header");
  const headingWrap = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `Member ${index + 1}`;
  const heading = document.createElement("h4");
  heading.id = `duplicate-member-${index}-heading`;
  heading.textContent = item.itemId || `Member ${index + 1}`;
  headingWrap.append(eyebrow, heading);
  const links = document.createElement("div");
  links.className = "source-links";
  appendMemberEvidenceLink(links, "Source page", item.sourcePageUrl);
  appendMemberEvidenceLink(links, "Source PDF", item.sourcePdfUrl);
  appendMemberEvidenceLink(links, "Answer key", item.answerKeyUrl);
  header.append(headingWrap, links);

  const cropWrap = document.createElement("div");
  cropWrap.className = "question-crop-frame";
  const img = document.createElement("img");
  const missing = document.createElement("div");
  missing.className = "asset-missing";
  const missingTitle = document.createElement("strong");
  missingTitle.textContent = "Question crop unavailable";
  const missingHelp = document.createElement("span");
  missingHelp.textContent = "Do not confirm without sufficient evidence.";
  missing.append(missingTitle, missingHelp);
  cropWrap.append(img, missing);
  populateCrop(img, missing, item, `Duplicate member ${index + 1}`);

  const stem = document.createElement("p");
  stem.className = "question-stem";
  stem.textContent = item.stem || "No parsed stem was returned.";
  const choices = document.createElement("ol");
  choices.className = "choice-list";
  choices.type = "A";
  populateChoices(choices, item.choices);
  const answer = document.createElement("div");
  answer.className = "protected-answer";
  const answerStrong = document.createElement("strong");
  answerStrong.textContent = `Official answer: ${item.officialAnswer || "—"}`;
  const answerDetail = document.createElement("span");
  answerDetail.className = "answer-source";
  answerDetail.textContent = [item.answerStatus, item.answerSource]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(displayValue)
    .join(" · ") || "Answer source not recorded";
  answer.append(answerStrong, answerDetail);
  const metadata = document.createElement("dl");
  metadata.className = "metadata-grid";
  appendMetadata(metadata, item);
  const warningsHeading = document.createElement("h5");
  warningsHeading.textContent = "Warnings";
  const warnings = document.createElement("ul");
  warnings.className = "warning-list";
  populateCodes(warnings, item.warnings, "No recorded parser warnings.");
  const gapsHeading = document.createElement("h5");
  gapsHeading.textContent = "Content gaps";
  const gaps = document.createElement("ul");
  gaps.className = "warning-list content-gap-list";
  populateCodes(gaps, item.gaps, "No recorded content gaps.");
  article.append(
    header,
    cropWrap,
    stem,
    choices,
    answer,
    metadata,
    warningsHeading,
    warnings,
    gapsHeading,
    gaps,
  );
  return article;
}

function normalizedDuplicate(payload, requestedId = "") {
  const payloadRecord = asRecord(payload);
  const raw = asRecord(firstDefined(payloadRecord.group, payloadRecord.duplicate, payloadRecord));
  return {
    raw,
    groupId: textValue(raw.group_id, raw.duplicate_id, raw.id, requestedId),
    signatureType: textValue(raw.signature_type, raw.match_type),
    signature: textValue(raw.signature, raw.fingerprint),
    members: asArray(firstDefined(raw.members, raw.items)),
    currentReview: nonEmptyRecord(firstDefined(raw.current_review, payloadRecord.current_review)),
    navigation: asRecord(firstDefined(raw.navigation, payloadRecord.navigation)),
  };
}

function populateDuplicateReview(review) {
  const form = byId("duplicate-review-form");
  const decision = review && ["confirmed", "rejected", "needs_review"].includes(review.decision)
    ? review.decision
    : "needs_review";
  form.elements.decision.value = decision;
  form.elements.notes.value = review && typeof review.notes === "string" ? review.notes : "";
  byId("duplicate-saved-state").textContent = review ? "Saved in your slot" : "Not saved";
  byId("duplicate-saved-state").classList.toggle("is-saved", Boolean(review));
  byId("duplicate-form-error").hidden = true;
}

function renderDuplicateResponse(payload, requestedId) {
  const group = normalizedDuplicate(payload, requestedId);
  if (!group.groupId) throw new Error("The duplicate API did not return a group ID.");
  if (group.groupId !== requestedId) {
    throw new Error("The duplicate API returned a different group than the one requested.");
  }
  if (group.members.length < 2) {
    throw new Error("The duplicate API did not return at least two members for comparison.");
  }
  state.duplicate.payload = payload;
  state.duplicate.detail = group;
  if (group.currentReview) state.duplicate.reviewed.add(group.groupId);
  byId("duplicate-group-id").textContent = group.groupId;
  byId("duplicate-signature-type").textContent = group.signatureType || "—";
  const signature = group.signature || "—";
  byId("duplicate-signature").textContent = signature.length > 24
    ? `${signature.slice(0, 12)}…${signature.slice(-8)}`
    : signature;
  byId("duplicate-signature").title = signature;
  byId("duplicate-members").replaceChildren(...group.members.map(duplicateMemberCard));
  populateDuplicateReview(group.currentReview);
  renderProgress();
  setQueueLoading("duplicate", false);
}

async function loadDuplicate(index) {
  if (state.duplicate.loading || state.duplicate.saving) return;
  if (!state.duplicate.summaries.length) {
    showEmptyQueue("duplicate");
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.duplicate.summaries.length) return;
  const summary = state.duplicate.summaries[index];
  state.duplicate.index = index;
  state.duplicate.payload = null;
  state.duplicate.detail = null;
  setQueueLoading("duplicate", true);
  try {
    const payload = await requestJson(duplicateEndpoint(summary.id));
    renderDuplicateResponse(payload, summary.id);
    clearError();
    announce(`Loaded duplicate candidate ${index + 1} of ${state.duplicate.summaries.length}.`);
  } catch (error) {
    setQueueLoading("duplicate", false);
    showError(error, () => loadDuplicate(index));
  } finally {
    state.duplicate.loading = false;
    updateQueueNavigation("duplicate");
  }
}

async function saveDuplicate(advance) {
  if (state.duplicate.loading || state.duplicate.saving || !state.duplicate.detail) return;
  const form = byId("duplicate-review-form");
  const body = {
    decision: form.elements.decision.value,
    notes: form.elements.notes.value.trim(),
  };
  if (!["confirmed", "rejected", "needs_review"].includes(body.decision)) {
    byId("duplicate-form-error").textContent = "Choose a duplicate decision before saving.";
    byId("duplicate-form-error").hidden = false;
    announce("Choose a duplicate decision before saving.");
    return;
  }
  byId("duplicate-form-error").hidden = true;
  state.duplicate.saving = true;
  toggleFormBusy("duplicate-review-form", true);
  updateQueueNavigation("duplicate");
  const groupId = state.duplicate.detail.groupId;
  const destination = advance ? nextIndex(state.duplicate, state.duplicate.detail.navigation) : null;
  try {
    const response = await requestJson(duplicateEndpoint(groupId), {
      method: "POST",
      body: JSON.stringify(body),
      headers: reviewWriteHeaders(state.duplicate.detail.currentReview),
    });
    state.duplicate.reviewed.add(groupId);
    state.duplicate.summaries[state.duplicate.index].reviewed = true;
    state.duplicate.detail.currentReview = nonEmptyRecord(asRecord(response).review) || body;
    byId("duplicate-saved-state").textContent = "Saved in your slot";
    byId("duplicate-saved-state").classList.add("is-saved");
    clearError();
    if (!applyWriteProgress(response)) renderProgress();
    renderJumpList("duplicate");
    announce(`Saved your independent decision for duplicate candidate ${state.duplicate.index + 1}.`);
  } catch (requestError) {
    showError(requestError, () => saveDuplicate(advance));
    return;
  } finally {
    state.duplicate.saving = false;
    toggleFormBusy("duplicate-review-form", false);
    updateQueueNavigation("duplicate");
  }
  if (destination !== null) await loadDuplicate(destination);
}

function navigateQueue(prefix, requestedIndex) {
  const target = prefix === "item" ? state.item : state.duplicate;
  const index = Number(requestedIndex);
  if (!Number.isInteger(index) || index < 0 || index >= target.summaries.length) {
    announce(`Choose a position from 1 to ${target.summaries.length}.`);
    return;
  }
  if (prefix === "item") void loadItem(index);
  else void loadDuplicate(index);
}

function markFormUnsaved(prefix) {
  const target = prefix === "item" ? state.item : state.duplicate;
  if (!target.payload || target.saving) return;
  const saved = byId(`${prefix}-saved-state`);
  saved.textContent = "Unsaved changes";
  saved.classList.remove("is-saved");
}

function bindEvents() {
  const views = ["overview", "items", "duplicates", "status"];
  for (const view of views) {
    byId(`${view}-tab`).addEventListener("click", () => setActiveView(view));
  }
  byId("start-review").addEventListener("click", () => setActiveView("items"));
  byId("retry-request").addEventListener("click", () => {
    const retry = state.retry;
    if (retry) void retry();
  });
  byId("refresh-status").addEventListener("click", () => void refreshProgress());

  for (const prefix of ["item", "duplicate"]) {
    byId(`${prefix}-previous`).addEventListener("click", () => {
      const target = prefix === "item" ? state.item : state.duplicate;
      navigateQueue(prefix, target.index - 1);
    });
    byId(`${prefix}-next`).addEventListener("click", () => {
      const target = prefix === "item" ? state.item : state.duplicate;
      navigateQueue(prefix, target.index + 1);
    });
    byId(`${prefix}-jump-form`).addEventListener("submit", (event) => {
      event.preventDefault();
      navigateQueue(prefix, Number(byId(`${prefix}-jump`).value) - 1);
    });
    byId(`${prefix}-jump-list`).addEventListener("click", (event) => {
      const button = event.target.closest("button[data-index]");
      if (button) navigateQueue(prefix, Number(button.dataset.index));
    });
  }

  byId("item-review-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveItem(event.submitter?.dataset.advance === "true");
  });
  byId("duplicate-review-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveDuplicate(event.submitter?.dataset.advance === "true");
  });
  byId("item-review-form").addEventListener("input", () => markFormUnsaved("item"));
  byId("duplicate-review-form").addEventListener("input", () => markFormUnsaved("duplicate"));

  byId("item-review-form").addEventListener("change", (event) => {
    if (event.target.name !== "disposition" || event.target.value !== "faithful") return;
    const form = byId("item-review-form");
    if (ITEM_CHECKS.some((name) => !form.elements[name].checked)) {
      announce("Faithful can be saved only after all five evidence checks pass.");
    }
  });

  byId("overview-tab").parentElement.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const current = views.indexOf(state.activeView);
    let next = current;
    if (event.key === "ArrowLeft") next = (current - 1 + views.length) % views.length;
    if (event.key === "ArrowRight") next = (current + 1) % views.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = views.length - 1;
    event.preventDefault();
    setActiveView(views[next]);
    byId(`${views[next]}-tab`).focus();
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (state.activeView === "items") void saveItem(event.shiftKey);
    if (state.activeView === "duplicates") void saveDuplicate(event.shiftKey);
  });
}

async function initialize() {
  byId("connection-badge").textContent = "Connecting…";
  byId("connection-badge").className = "connection-badge is-loading";
  try {
    const [progress, itemPayload, duplicatePayload] = await Promise.all([
      requestJson(API.progress),
      requestJson(API.items),
      requestJson(API.duplicates),
    ]);
    renderReviewerIdentity(progress);
    state.progress = progress;
    installSummaries(itemPayload, duplicatePayload);
    renderProgress();
    clearError();
    if (!state.item.summaries.length) showEmptyQueue("item");
    if (!state.duplicate.summaries.length) showEmptyQueue("duplicate");
    const reviewer = asRecord(progress.reviewer);
    const slot = finiteNumber(reviewer.reviewer_slot, reviewer.slot);
    announce(`Private Stage 0 review is ready. This session is Reviewer slot ${slot}.`);
  } catch (error) {
    showError(error, initialize);
    byId("status-loading").hidden = true;
  }
}

bindEvents();
void initialize();
