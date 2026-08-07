(() => {
  "use strict";

  const API = Object.freeze({
    world: "/api/catalogue/world-layout",
    items: "/api/catalogue/items",
    explore: "/api/catalogue/explore",
  });
  const STORAGE_SCHEMA_VERSION = 1;
  const STORAGE_KEY_PREFIX = "spatial-gym-mk-grade12-world-qa";
  const SOUND_KEY = "spatial-gym-sound";
  const ANSWER_LETTERS = Object.freeze(["A", "B", "C", "D", "E"]);
  const REALM_IDS = Object.freeze([
    "number_arithmetic",
    "patterns_algebra",
    "logic_constraints",
    "counting_combinatorics",
    "geometry_spatial",
    "measurement_time",
  ]);
  const NEIGHBOR_RATINGS = Object.freeze([
    ["same_strategy", "Same strategy"],
    ["same_skill_different_surface", "Same skill, different surface"],
    ["surface_only", "Looks similar only"],
    ["unrelated", "Unrelated"],
    ["unsure", "Unsure"],
  ]);

  const state = {
    initialized: false,
    active: false,
    loading: false,
    payload: null,
    sitesById: new Map(),
    activeRealmId: "",
    activeDistrictId: "",
    progress: null,
    currentDetail: null,
    currentSite: null,
    currentNeighbors: null,
    requestToken: 0,
    retryTimer: 0,
    qaSaving: false,
    soundEnabled: true,
    audioContext: null,
  };

  const byId = (id) => document.getElementById(id);
  const asRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const stringValue = (value, fallback = "") => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  };
  const integer = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
  };
  const firstDefined = (...values) =>
    values.find((value) => value !== undefined && value !== null);
  const humanize = (value) =>
    stringValue(value, "Unknown")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  function node(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = stringValue(options.text);
    Object.entries(options.attrs || {}).forEach(([name, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(name, String(value));
    });
    return element;
  }

  function safeStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function announce(message) {
    const target = byId("live-message");
    if (!target) return;
    target.textContent = "";
    window.setTimeout(() => {
      target.textContent = message;
    }, 20);
  }

  function sameOriginUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), window.location.origin);
      return url.origin === window.location.origin ? url.href : "";
    } catch {
      return "";
    }
  }

  async function requestJson(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const record = asRecord(payload);
      const error = new Error(
        stringValue(firstDefined(record.message, record.detail, record.error)) ||
          `Request failed with status ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }
    return { payload, response };
  }

  function placementRecord(value) {
    const record = asRecord(value);
    const selected = asRecord(firstDefined(record.selected, record.placement));
    const presented = asRecord(firstDefined(record.presented, record.proposal));
    return {
      verdict: stringValue(record.verdict),
      realmId: stringValue(
        firstDefined(record.selected_realm_id, record.realm_id, selected.realm_id),
      ),
      districtId: stringValue(
        firstDefined(record.selected_district_id, record.district_id, selected.district_id),
      ),
      presentedRealmId: stringValue(
        firstDefined(record.presented_realm_id, presented.realm_id),
      ),
      presentedDistrictId: stringValue(
        firstDefined(record.presented_district_id, presented.district_id),
      ),
      reviewedAt: stringValue(firstDefined(record.reviewed_at, record.updated_at)),
      etag: stringValue(record.etag),
    };
  }

  function proposalRecord(value) {
    const record = asRecord(value);
    return {
      realmId: stringValue(firstDefined(record.realm_id, record.primary_realm_id)),
      districtId: stringValue(firstDefined(record.district_id, record.primary_district_id)),
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : null,
      reason: stringValue(firstDefined(record.reason, record.explanation)),
    };
  }

  function normalizeSite(value) {
    const record = asRecord(value);
    const source = asRecord(record.source);
    const proposal = proposalRecord(
      firstDefined(record.proposed_placement, record.proposal, record.presented_placement),
    );
    const effective = asRecord(record.effective_placement);
    const placement = placementRecord(
      firstDefined(record.current_placement, record.world_placement, record.placement),
    );
    const approved =
      ["fits", "change"].includes(placement.verdict) &&
      REALM_IDS.includes(placement.realmId) &&
      Boolean(placement.districtId);
    const effectiveRealmId = approved
      ? placement.realmId
      : stringValue(
          firstDefined(record.effective_realm_id, effective.realm_id, proposal.realmId),
        );
    const effectiveDistrictId = approved
      ? placement.districtId
      : stringValue(
          firstDefined(
            record.effective_district_id,
            effective.district_id,
            proposal.districtId,
          ),
        );
    const choiceMode = stringValue(
      firstDefined(record.choice_mode, record.play_mode),
      integer(record.option_count) >= 4 ? "shuffled" : "source_order",
    );
    const mapStatus = stringValue(
      firstDefined(record.map_status, record.location_status),
      approved
        ? "approved"
        : effective.placement_kind === "heaven" ||
            choiceMode === "source_order" ||
            !REALM_IDS.includes(effectiveRealmId)
          ? "heaven"
          : "proposed",
    );
    return {
      id: stringValue(firstDefined(record.item_id, record.id)),
      contentVersion: stringValue(firstDefined(record.content_version, record.version)),
      sourceLabel: stringValue(
        firstDefined(record.source_label, source.label),
        stringValue(firstDefined(record.item_id, record.id)),
      ),
      year: integer(firstDefined(record.year, source.year)),
      questionNumber: integer(
        firstDefined(record.question_number, source.question_number),
      ),
      pointTier: integer(firstDefined(record.point_tier, record.points)),
      choiceMode,
      optionCount: integer(record.option_count),
      mapStatus,
      approved,
      effectiveRealmId,
      effectiveDistrictId,
      proposal,
      placement,
    };
  }

  function normalizeWorld(payload) {
    const root = asRecord(payload);
    const world = asRecord(firstDefined(root.world, root.layout));
    const realms = asArray(firstDefined(root.realms, world.realms)).map((value) => {
      const realm = asRecord(value);
      return {
        id: stringValue(firstDefined(realm.id, realm.realm_id)),
        label: stringValue(
          realm.label,
          humanize(firstDefined(realm.id, realm.realm_id)),
        ),
        shortLabel: stringValue(firstDefined(realm.short_label, realm.shortLabel), realm.label),
        description: stringValue(realm.description),
        districts: asArray(realm.districts).map((districtValue) => {
          const district = asRecord(districtValue);
          return {
            id: stringValue(firstDefined(district.id, district.district_id)),
            label: stringValue(
              district.label,
              humanize(firstDefined(district.id, district.district_id)),
            ),
            description: stringValue(district.description),
          };
        }),
      };
    });
    const sites = asArray(firstDefined(root.sites, root.items, root.inventory)).map(
      normalizeSite,
    );
    return {
      runId: stringValue(root.run_id),
      ontologyVersion: stringValue(
        firstDefined(root.ontology_version, world.ontology_version),
      ),
      layoutVersion: stringValue(
        firstDefined(
          root.layout_version,
          world.layout_version,
          asRecord(world.layout).layout_version,
        ),
      ),
      gradeBand: stringValue(root.grade_band, "1-2"),
      realms,
      sites,
      summary: asRecord(root.summary),
    };
  }

  function emptyProgress(payload) {
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      runId: payload.runId,
      layoutVersion: payload.layoutVersion,
      activeRealmId: "",
      activeDistrictId: "",
      seenIds: [],
      solvedIds: [],
      firstTryCorrectIds: [],
      routeSteps: 0,
      lastCorrectPosition: -1,
      current: null,
    };
  }

  function storageKey(payload) {
    return `${STORAGE_KEY_PREFIX}:${payload.runId}:${payload.layoutVersion}`;
  }

  function setStorageStatus(message) {
    const target = byId("world-qa-storage-status");
    if (target) target.textContent = message;
  }

  function normalizeSavedCurrent(value, sitesById) {
    const record = asRecord(value);
    const itemId = stringValue(firstDefined(record.itemId, record.item_id));
    if (!itemId || !sitesById.has(itemId)) return null;
    const storedPermutation = asArray(record.permutation)
      .filter(Number.isInteger)
      .map(Number);
    const permutation =
      storedPermutation.length >= 2 &&
      new Set(storedPermutation).size === storedPermutation.length &&
      storedPermutation.every(
        (entry) => entry >= 0 && entry < storedPermutation.length,
      )
        ? storedPermutation
        : [];
    const expectedLength = permutation.length;
    let phase = ["answering", "reviewing", "retry", "solved", "complete"].includes(
      record.phase,
    )
      ? record.phase
      : "answering";
    // The short wrong-answer review timer cannot survive a reload. Preserve the
    // miss evidence, but reopen the same question in its usable retry state.
    if (["reviewing", "retry"].includes(phase)) phase = "answering";
    return {
      itemId,
      permutation,
      phase,
      selectedDisplayIndex:
        phase !== "answering" &&
        Number.isInteger(record.selectedDisplayIndex) &&
        record.selectedDisplayIndex >= 0 &&
        record.selectedDisplayIndex < expectedLength
          ? record.selectedDisplayIndex
          : null,
      wrongSourceIndexes: asArray(record.wrongSourceIndexes)
        .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry < expectedLength)
        .map(Number),
      missed: Boolean(record.missed),
      comparisonAnchorId: stringValue(record.comparisonAnchorId),
      comparisonView: stringValue(record.comparisonView, "surface"),
      comparisonEtag: stringValue(record.comparisonEtag),
      comparisonSaved: Boolean(record.comparisonSaved),
    };
  }

  function loadProgress(payload) {
    const fallback = emptyProgress(payload);
    const storage = safeStorage();
    if (!storage) {
      setStorageStatus("Local resume is unavailable in this browser; this tab will still work.");
      return fallback;
    }
    try {
      const saved = storage.getItem(storageKey(payload));
      if (!saved) {
        setStorageStatus("Progress will save automatically on this device.");
        return fallback;
      }
      const parsed = JSON.parse(saved);
      const record = asRecord(parsed);
      if (
        record.schemaVersion !== STORAGE_SCHEMA_VERSION ||
        record.runId !== payload.runId ||
        record.layoutVersion !== payload.layoutVersion
      ) {
        setStorageStatus("The world changed, so this QA pass started fresh.");
        return fallback;
      }
      const allowedIds = new Set(payload.sites.map((site) => site.id));
      const validIds = (value) =>
        [...new Set(asArray(value).filter((id) => typeof id === "string" && allowedIds.has(id)))];
      const progress = {
        ...fallback,
        activeRealmId:
          REALM_IDS.includes(record.activeRealmId) || record.activeRealmId === "heaven"
            ? record.activeRealmId
            : "",
        activeDistrictId: stringValue(record.activeDistrictId),
        seenIds: validIds(record.seenIds),
        solvedIds: validIds(record.solvedIds),
        firstTryCorrectIds: validIds(record.firstTryCorrectIds),
        routeSteps: integer(record.routeSteps),
        lastCorrectPosition: Number.isInteger(record.lastCorrectPosition)
          ? record.lastCorrectPosition
          : -1,
        current: normalizeSavedCurrent(record.current, state.sitesById),
      };
      setStorageStatus(
        progress.current
          ? "Resumed your last question from local progress."
          : "Local progress restored. Choose a question to continue.",
      );
      return progress;
    } catch {
      setStorageStatus("Saved progress could not be read, so this pass started fresh.");
      return fallback;
    }
  }

  function saveProgress() {
    if (!state.payload || !state.progress) return false;
    const storage = safeStorage();
    if (!storage) return false;
    try {
      storage.setItem(storageKey(state.payload), JSON.stringify(state.progress));
      setStorageStatus("Progress saved automatically on this device.");
      return true;
    } catch {
      setStorageStatus("Local saving is blocked; keep this tab open to retain progress.");
      return false;
    }
  }

  function updateProgress(updates) {
    state.progress = { ...state.progress, ...updates };
    saveProgress();
  }

  function readSoundPreference() {
    const storage = safeStorage();
    if (!storage) return true;
    try {
      const value = storage.getItem(SOUND_KEY);
      return value === null ? true : value !== "false";
    } catch {
      return true;
    }
  }

  function syncSoundToggle() {
    const button = byId("world-sound-toggle");
    if (!button) return;
    button.setAttribute("aria-pressed", String(state.soundEnabled));
    button.setAttribute("aria-label", state.soundEnabled ? "Turn sound off" : "Turn sound on");
    byId("world-sound-label").textContent = state.soundEnabled ? "Sound on" : "Sound off";
  }

  function ensureAudioContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    try {
      if (!state.audioContext || state.audioContext.state === "closed") {
        state.audioContext = new Context();
      }
      if (state.audioContext.state === "suspended") {
        void state.audioContext.resume().catch(() => undefined);
      }
      return state.audioContext;
    } catch {
      return null;
    }
  }

  function scheduleTone(context, frequency, start, duration, volume) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
  }

  function playEarcon(correct) {
    if (!state.soundEnabled) return;
    const context = ensureAudioContext();
    if (!context) return;
    try {
      const now = context.currentTime + 0.012;
      if (correct) {
        scheduleTone(context, 523.25, now, 0.13, 0.052);
        scheduleTone(context, 659.25, now + 0.075, 0.15, 0.048);
      } else {
        scheduleTone(context, 220, now, 0.11, 0.048);
        scheduleTone(context, 174.61, now + 0.055, 0.12, 0.044);
      }
    } catch {
      // Audio is an enhancement; play and review remain available without it.
    }
  }

  function realmById(realmId) {
    return state.payload?.realms.find((realm) => realm.id === realmId) || null;
  }

  function districtById(realmId, districtId) {
    return realmById(realmId)?.districts.find((district) => district.id === districtId) || null;
  }

  function siteHome(site) {
    if (site.approved) {
      return {
        realmId: site.placement.realmId,
        districtId: site.placement.districtId,
        approved: true,
      };
    }
    if (site.mapStatus === "heaven") {
      return { realmId: "", districtId: "", approved: false };
    }
    if (REALM_IDS.includes(site.effectiveRealmId) && site.effectiveDistrictId) {
      return {
        realmId: site.effectiveRealmId,
        districtId: site.effectiveDistrictId,
        approved: false,
      };
    }
    return { realmId: "", districtId: "", approved: false };
  }

  function heavenSites() {
    return state.payload.sites.filter(
      (site) =>
        !site.approved &&
        (site.mapStatus === "heaven" ||
          site.choiceMode === "source_order" ||
          !REALM_IDS.includes(siteHome(site).realmId)),
    );
  }

  function candidatesForSelection() {
    if (!state.payload) return [];
    if (state.activeRealmId === "heaven") return heavenSites();
    if (REALM_IDS.includes(state.activeRealmId)) {
      return state.payload.sites.filter((site) => {
        const home = siteHome(site);
        return (
          home.realmId === state.activeRealmId &&
          (!state.activeDistrictId || home.districtId === state.activeDistrictId)
        );
      });
    }
    return state.payload.sites;
  }

  function updateRealmCounts() {
    if (!state.payload) return;
    const reviewedCount = state.payload.sites.filter(
      (site) => Boolean(site.placement.verdict),
    ).length;
    const total = state.payload.sites.length;
    byId("world-qa-progress-count").textContent = reviewedCount.toLocaleString();
    byId("world-qa-progress-total").textContent = total.toLocaleString();
    const progress = byId("world-qa-progress-bar");
    progress.max = total;
    progress.value = reviewedCount;
    progress.textContent = `${reviewedCount} of ${total}`;
    byId("world-heaven-count").textContent = heavenSites().length.toLocaleString();
    byId("world-heaven-count").setAttribute(
      "aria-label",
      `${heavenSites().length.toLocaleString()} questions`,
    );
    document.querySelectorAll("[data-world-realm]").forEach((button) => {
      const realmId = button.dataset.worldRealm;
      const sites = state.payload.sites.filter((site) => siteHome(site).realmId === realmId);
      const checked = sites.filter((site) => Boolean(site.placement.verdict)).length;
      const count = button.querySelector(".world-count");
      if (count) count.textContent = `${checked}/${sites.length}`;
      button.setAttribute(
        "aria-label",
        `${realmById(realmId)?.label || humanize(realmId)}, ${checked} of ${sites.length} placements checked`,
      );
      button.classList.toggle("is-reviewed", sites.length > 0 && checked === sites.length);
      button.classList.toggle("has-progress", checked > 0 && checked < sites.length);
    });
    byId("world-crossroads-count").textContent = total.toLocaleString();
    byId("world-qa-progress-label").textContent =
      reviewedCount === total
        ? "Every verified Grades 1–2 question has a teacher QA judgement."
        : `${(total - reviewedCount).toLocaleString()} QA passes remain; every judgement can be changed later.`;
  }

  function updateSelectionUi() {
    document.querySelectorAll("[data-world-realm]").forEach((button) => {
      const active = button.dataset.worldRealm === state.activeRealmId;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    byId("world-heaven-open").classList.toggle(
      "is-selected",
      state.activeRealmId === "heaven",
    );
    const realm = realmById(state.activeRealmId);
    const district = districtById(state.activeRealmId, state.activeDistrictId);
    const label =
      state.activeRealmId === "heaven"
        ? "Question Heaven"
        : realm
          ? `${realm.label}${district ? ` · ${district.label}` : ""}`
          : "Crossroads · all realms";
    byId("world-map-selection").textContent = label;
    const count = candidatesForSelection().length;
    byId("world-map-status").textContent = `${count.toLocaleString()} ${
      count === 1 ? "question" : "questions"
    } available here. Choose the region again for another unseen question.`;
    renderDistrictControls();
  }

  function ensureDistrictControls() {
    let container = byId("world-district-list");
    if (container) return container;
    container = node("div", {
      className: "world-district-list",
      attrs: {
        id: "world-district-list",
        role: "group",
        "aria-label": "Choose a district within the selected realm",
        hidden: "",
      },
    });
    byId("world-map-status").before(container);
    return container;
  }

  function renderDistrictControls() {
    const container = ensureDistrictControls();
    const realm = realmById(state.activeRealmId);
    container.replaceChildren();
    container.hidden = !realm;
    if (!realm) return;
    realm.districts.forEach((district) => {
      const sites = state.payload.sites.filter((site) => {
        const home = siteHome(site);
        return home.realmId === realm.id && home.districtId === district.id;
      });
      const checked = sites.filter((site) => site.approved).length;
      const button = node("button", {
        className: `world-district${
          state.activeDistrictId === district.id ? " is-selected" : ""
        }`,
        text: `${district.label} · ${checked}/${sites.length}`,
        attrs: {
          type: "button",
          "data-world-district": district.id,
          "aria-pressed": String(state.activeDistrictId === district.id),
          disabled: sites.length === 0 ? "" : undefined,
        },
      });
      button.addEventListener("click", () => {
        state.activeDistrictId =
          state.activeDistrictId === district.id ? "" : district.id;
        updateProgress({ activeDistrictId: state.activeDistrictId, routeSteps: 0 });
        updateSelectionUi();
        void drawFromSelection();
      });
      container.append(button);
    });
  }

  function randomIndex(length) {
    if (length < 1) return -1;
    return Math.floor(Math.random() * length);
  }

  function shuffledPermutation(length, correctSourceIndex) {
    const values = Array.from({ length }, (_, index) => index);
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swap = randomIndex(index + 1);
      [values[index], values[swap]] = [values[swap], values[index]];
    }
    let correctPosition = values.indexOf(correctSourceIndex);
    if (correctPosition === correctSourceIndex || correctPosition === state.progress.lastCorrectPosition) {
      const alternatives = values
        .map((_, index) => index)
        .filter(
          (index) =>
            index !== correctPosition &&
            index !== correctSourceIndex &&
            index !== state.progress.lastCorrectPosition,
        );
      const swapPosition = alternatives[randomIndex(alternatives.length)] ??
        values.map((_, index) => index).find((index) => index !== correctPosition);
      if (swapPosition !== undefined) {
        [values[correctPosition], values[swapPosition]] = [
          values[swapPosition],
          values[correctPosition],
        ];
        correctPosition = values.indexOf(correctSourceIndex);
      }
    }
    return values;
  }

  function answerSourceIndex(value, optionCount) {
    const answer = stringValue(value).trim().toUpperCase();
    const letterIndex = ANSWER_LETTERS.indexOf(answer);
    if (letterIndex >= 0 && letterIndex < optionCount) return letterIndex;
    if (/^[1-5]$/.test(answer)) {
      const numericIndex = Number(answer) - 1;
      if (numericIndex < optionCount) return numericIndex;
    }
    return -1;
  }

  function safeChoice(value, index) {
    if (typeof value === "string" || typeof value === "number") {
      return { text: String(value), imageUrl: "", imageAlt: "" };
    }
    const record = asRecord(value);
    return {
      text: stringValue(
        firstDefined(record.text, record.value, record.choice_text, record.content, record.label),
      ),
      imageUrl: sameOriginUrl(
        firstDefined(record.image_url, record.imageUrl, record.asset_url, record.assetUrl),
      ),
      imageAlt: stringValue(firstDefined(record.image_alt, record.imageAlt, record.alt), `Visual answer ${index + 1}`),
    };
  }

  function normalizeDetail(payload) {
    const root = asRecord(payload);
    const source = asRecord(root.source);
    const helper = asRecord(firstDefined(root.english_helper, root.englishHelper));
    const answer = asRecord(firstDefined(root.answer_metadata, root.answer));
    const helperChoices = asArray(helper.english_choices);
    const rawChoices = helperChoices.length ? helperChoices : asArray(root.choices);
    const assets = asArray(root.assets).map((value, index) => {
      const asset = asRecord(value);
      return {
        ordinal: integer(firstDefined(asset.ordinal, index + 1), index + 1),
        url: sameOriginUrl(firstDefined(asset.url, asset.asset_url)),
        status: stringValue(asset.status, "available"),
        width: integer(asset.width),
        height: integer(asset.height),
      };
    });
    return {
      id: stringValue(firstDefined(root.item_id, root.id)),
      contentVersion: stringValue(firstDefined(root.content_version, root.version)),
      source,
      sourceLabel: stringValue(source.label, stringValue(firstDefined(root.item_id, root.id))),
      prompt: stringValue(
        firstDefined(helper.english_prompt, root.prompt, root.prompt_text),
        "No parsed prompt is available. Inspect the complete source image.",
      ),
      sourcePrompt: stringValue(firstDefined(helper.source_prompt, root.prompt)),
      sourceLanguage: stringValue(helper.source_language),
      choices: rawChoices.map(safeChoice),
      assets,
      officialAnswer: firstDefined(answer.official_answer, answer.answer, answer.value),
      answerStatus: stringValue(firstDefined(answer.answer_status, answer.status)),
      pdfUrl: sameOriginUrl(root.source_pdf_url),
      proposal: asRecord(root.proposal),
    };
  }

  function setPlayLoading(loading) {
    byId("problem-neighbor-loading").hidden = !loading;
    if (loading) {
      byId("problem-selected-empty").hidden = true;
      byId("problem-neighborhood-content").hidden = true;
    }
  }

  function renderAssets(detail) {
    const container = byId("problem-selected-assets");
    container.replaceChildren();
    const section = byId("problem-selected-assets-section");
    section.hidden = detail.assets.length === 0;
    detail.assets.forEach((asset) => {
      const figure = node("figure", { className: "problem-selected-asset" });
      if (asset.url && asset.status === "available") {
        const image = node("img", {
          attrs: {
            src: asset.url,
            alt: `Complete question image for ${detail.sourceLabel}. It may contain information needed to answer, including graphical choices.`,
            loading: "eager",
            decoding: "async",
            width: asset.width || undefined,
            height: asset.height || undefined,
          },
        });
        image.addEventListener("error", () => {
          image.hidden = true;
          figure.prepend(
            node("p", {
              className: "problem-selected-asset-missing",
              text: "This audited image could not be displayed.",
            }),
          );
        });
        figure.append(image);
      } else {
        figure.append(
          node("p", {
            className: "problem-selected-asset-missing",
            text: "This question image was unavailable in the catalogue snapshot.",
          }),
        );
      }
      container.append(figure);
    });
  }

  function displayChoices(detail, current) {
    if (state.currentSite.choiceMode === "source_order") {
      return ANSWER_LETTERS.map((letter, index) => ({
        sourceIndex: index,
        displayIndex: index,
        letter,
        choice: { text: `Choose source answer ${letter}`, imageUrl: "", imageAlt: "" },
      }));
    }
    return current.permutation.map((sourceIndex, displayIndex) => ({
      sourceIndex,
      displayIndex,
      letter: ANSWER_LETTERS[displayIndex],
      choice: detail.choices[sourceIndex],
    }));
  }

  function renderChoices(detail, current) {
    const list = byId("problem-selected-choices");
    list.replaceChildren();
    const correctSourceIndex = answerSourceIndex(
      detail.officialAnswer,
      current.permutation.length,
    );
    displayChoices(detail, current).forEach((answer) => {
      const item = node("li", { className: "world-play-choice-item" });
      const button = node("button", {
        className: "world-play-choice",
        attrs: {
          id: `world-play-choice-${answer.displayIndex + 1}`,
          type: "button",
          "data-world-choice-index": answer.displayIndex,
          "data-choice-number": ANSWER_LETTERS[answer.displayIndex],
          "aria-keyshortcuts": String(answer.displayIndex + 1),
          "aria-label": `${ANSWER_LETTERS[answer.displayIndex]}. ${answer.choice?.text || `Source answer ${answer.letter}`}`,
        },
      });
      const content = node("span", { className: "world-play-choice-content" });
      if (answer.choice?.text) content.append(node("span", { text: answer.choice.text }));
      if (answer.choice?.imageUrl) {
        content.append(
          node("img", {
            attrs: {
              src: answer.choice.imageUrl,
              alt: answer.choice.imageAlt,
              loading: "eager",
              decoding: "async",
            },
          }),
        );
      }
      button.append(content);
      const isWrong = current.wrongSourceIndexes.includes(answer.sourceIndex);
      const isSelected = current.selectedDisplayIndex === answer.displayIndex;
      const solved = ["solved", "complete"].includes(current.phase);
      const isCorrect = answer.sourceIndex === correctSourceIndex;
      button.classList.toggle("is-incorrect", isWrong);
      button.classList.toggle("is-correct", solved && isCorrect);
      button.classList.toggle("is-muted", solved && !isCorrect);
      if (isWrong) button.setAttribute("aria-label", `${button.getAttribute("aria-label")}. Incorrect.`);
      if (solved && isCorrect) {
        button.setAttribute("aria-label", `${button.getAttribute("aria-label")}. Correct.`);
      }
      button.disabled = current.phase === "reviewing" || solved || (isWrong && current.phase === "answering");
      if (isSelected) button.setAttribute("aria-pressed", "true");
      item.append(button);
      list.append(item);
    });
    const note = byId("problem-selected-choices-note");
    note.hidden = false;
    note.textContent =
      state.currentSite.choiceMode === "source_order"
        ? "This question’s choices are embedded in the source image. Use the original A–E order while it waits in Heaven for separate option crops."
        : "Answer contents are shuffled; the displayed A–E letters are new for this play-through.";
  }

  function renderEvidence(detail) {
    const language = byId("problem-selected-language-helper");
    language.hidden = !detail.sourcePrompt || detail.sourcePrompt === detail.prompt;
    if (!language.hidden) {
      byId("problem-selected-language-label").textContent = detail.sourceLanguage || "Source";
      byId("problem-selected-source-prompt").textContent = detail.sourcePrompt;
      byId("problem-selected-source-choices").replaceChildren();
      byId("problem-selected-source-choices-note").hidden = false;
      byId("problem-selected-source-choices-note").textContent =
        "Inspect the complete source image for the original choice evidence.";
      byId("problem-selected-language-status").replaceChildren();
    }
    const metadata = byId("problem-selected-metadata");
    metadata.replaceChildren();
    const home = siteHome(state.currentSite);
    [
      ["Points", state.currentSite.pointTier ? `${state.currentSite.pointTier} points` : "Unknown"],
      ["Answer layout", state.currentSite.choiceMode === "source_order" ? "Source order" : "Shuffled"],
      ["Proposed realm", realmById(home.realmId)?.label || "Waiting for a home"],
      ["Proposed district", districtById(home.realmId, home.districtId)?.label || "Not proposed"],
    ].forEach(([label, value]) => {
      const row = node("div");
      row.append(node("dt", { text: label }), node("dd", { text: value }));
      metadata.append(row);
    });
    const tags = byId("problem-selected-tags");
    tags.replaceChildren();
    if (home.realmId) tags.append(node("span", { text: realmById(home.realmId)?.label }));
    if (home.districtId) tags.append(node("span", { text: districtById(home.realmId, home.districtId)?.label }));
    const sourcePdf = byId("problem-selected-source-pdf");
    sourcePdf.hidden = !detail.pdfUrl;
    if (detail.pdfUrl) sourcePdf.href = detail.pdfUrl;
  }

  function feedback(kind, heading, copy) {
    const panel = byId("world-play-feedback");
    panel.hidden = false;
    panel.classList.toggle("is-correct", kind === "correct");
    panel.classList.toggle("is-incorrect", kind === "wrong");
    byId("world-play-feedback-symbol").textContent = kind === "correct" ? "✓" : "×";
    byId("world-play-feedback-heading").textContent = heading;
    byId("world-play-feedback-copy").textContent = copy;
  }

  function resetQaCard() {
    const card = byId("world-play-qa-card");
    card.hidden = true;
    card.open = false;
    byId("world-play-qa-change-controls").hidden = true;
    byId("world-play-qa-note").value = "";
    byId("world-play-qa-status").textContent = "";
    byId("world-play-next").hidden = true;
    const neighborQa = byId("world-play-neighbor-qa");
    if (neighborQa) neighborQa.hidden = true;
  }

  function qaSuggestion(site) {
    if (site.approved) {
      return {
        realmId: site.placement.realmId,
        districtId: site.placement.districtId,
        approved: true,
      };
    }
    return {
      realmId: site.proposal.realmId,
      districtId: site.proposal.districtId,
      approved: false,
    };
  }

  function ensureQaProposalLine() {
    let line = byId("world-play-qa-proposal");
    if (line) return line;
    line = node("p", { className: "world-play-qa-proposal", attrs: { id: "world-play-qa-proposal" } });
    const body = byId("world-play-qa-card").querySelector(".world-play-qa-body");
    body.insertBefore(line, body.firstChild);
    return line;
  }

  function populateDistrictSelect(realmId, selectedId = "") {
    const select = byId("world-play-qa-district");
    select.replaceChildren(node("option", { text: "Choose a district", attrs: { value: "" } }));
    const realm = realmById(realmId);
    asArray(realm?.districts).forEach((district) => {
      select.append(
        node("option", {
          text: district.label,
          attrs: { value: district.id },
        }),
      );
    });
    select.disabled = !realm;
    select.value = realm?.districts.some((district) => district.id === selectedId)
      ? selectedId
      : "";
    syncChangeSaveState();
  }

  function syncChangeSaveState() {
    const button = byId("world-play-qa-save-change");
    if (!button) return;
    const realmId = byId("world-play-qa-realm")?.value || "";
    const districtId = byId("world-play-qa-district")?.value || "";
    button.disabled =
      state.qaSaving ||
      !REALM_IDS.includes(realmId) ||
      !districtById(realmId, districtId);
  }

  function renderQaCard() {
    const suggestion = qaSuggestion(state.currentSite);
    const realm = realmById(suggestion.realmId);
    const district = districtById(suggestion.realmId, suggestion.districtId);
    const proposal = ensureQaProposalLine();
    proposal.textContent = realm && district
      ? `${suggestion.approved ? "Approved home" : "Suggested home"}: ${realm.label} → ${district.label}`
      : "This question is waiting in Heaven for a curriculum home.";
    byId("world-play-qa-fits").hidden = !(realm && district);
    byId("world-play-qa-change").textContent = realm && district ? "↗ Change" : "↗ Choose home";
    byId("world-play-qa-realm").value = realm?.id || "";
    populateDistrictSelect(realm?.id || "", district?.id || "");
    const card = byId("world-play-qa-card");
    card.hidden = false;
    card.open = true;
    if (state.currentSite.placement.verdict) {
      byId("world-play-qa-status").textContent = suggestion.approved
        ? "Approved for this world version. You can change it at any time."
        : state.currentSite.placement.verdict === "unsure"
          ? "Previously marked unsure. You can place it now or continue."
          : "Previously skipped. You can place it now or continue.";
      byId("world-play-next").hidden = false;
    }
    renderNeighborQa();
    window.requestAnimationFrame(() => {
      (realm && district ? byId("world-play-qa-fits") : byId("world-play-qa-change"))?.focus();
    });
  }

  function ensureNeighborQa() {
    let section = byId("world-play-neighbor-qa");
    if (section) return section;
    section = node("section", {
      className: "world-play-neighbor-qa",
      attrs: { id: "world-play-neighbor-qa", hidden: "" },
    });
    section.append(
      node("p", {
        attrs: { id: "world-play-neighbor-prompt" },
        text: "Was this a useful nearby question?",
      }),
    );
    const actions = node("div", {
      className: "world-play-neighbor-actions",
      attrs: { role: "group", "aria-label": "Nearby-question judgment" },
    });
    NEIGHBOR_RATINGS.forEach(([value, label]) => {
      actions.append(
        node("button", {
          text: label,
          attrs: {
            type: "button",
            "data-world-neighbor-rating": value,
          },
        }),
      );
    });
    section.append(actions, node("p", { attrs: { id: "world-play-neighbor-status", role: "status" } }));
    const body = byId("world-play-qa-card").querySelector(".world-play-qa-body");
    body.append(section);
    return section;
  }

  function renderNeighborQa() {
    const section = ensureNeighborQa();
    const current = state.progress.current;
    section.hidden = !current?.comparisonAnchorId || current.comparisonSaved;
    if (section.hidden) return;
    byId("world-play-neighbor-prompt").textContent =
      "Was this a useful mathematical neighbor of the previous question?";
    byId("world-play-neighbor-status").textContent = "Optional · this improves the recommendation roads.";
  }

  function renderCurrentQuestion({ focusAnswer = false } = {}) {
    const detail = state.currentDetail;
    const site = state.currentSite;
    const current = state.progress.current;
    if (!detail || !site || !current) return;
    byId("problem-selected-reference").textContent = detail.id;
    byId("problem-selected-heading").textContent =
      site.year && site.questionNumber
        ? `Math Kangaroo ${site.year} · Question ${site.questionNumber}`
        : "Math Kangaroo question";
    byId("problem-selected-source").textContent = `${detail.sourceLabel}${
      site.pointTier ? ` · ${site.pointTier} points` : ""
    }`;
    byId("problem-selected-prompt-heading").textContent = "Question";
    byId("problem-selected-prompt").textContent = detail.prompt;
    renderAssets(detail);
    renderChoices(detail, current);
    renderEvidence(detail);
    byId("problem-selected-question-loading").hidden = true;
    byId("problem-selected-question-error").hidden = true;
    byId("problem-selected-question").hidden = false;
    byId("problem-selected-empty").hidden = true;
    byId("problem-neighborhood-content").hidden = false;
    byId("world-play-question-details").open = false;
    resetQaCard();
    if (["solved", "complete"].includes(current.phase)) {
      feedback("correct", "Correct", "Now give this problem one quick curriculum check.");
      renderQaCard();
    } else if (["reviewing", "retry"].includes(current.phase)) {
      feedback("wrong", "Try again", "That answer does not match the official key. Choose another.");
    } else {
      byId("world-play-feedback").hidden = true;
    }
    if (focusAnswer && current.phase === "answering") {
      window.requestAnimationFrame(() => {
        byId("problem-selected-choices")
          .querySelector(".world-play-choice:not(:disabled)")
          ?.focus();
      });
    }
  }

  async function loadItem(
    itemId,
    { savedCurrent = null, comparison = null, focusAnswer = true, restoreAttempt = 0 } = {},
  ) {
    const site = state.sitesById.get(itemId);
    if (!site) return false;
    window.clearTimeout(state.retryTimer);
    setPlayLoading(true);
    const token = ++state.requestToken;
    try {
      const { payload } = await requestJson(`${API.items}/${encodeURIComponent(itemId)}`);
      if (token !== state.requestToken) return false;
      const detail = normalizeDetail(payload);
      const sourceCount = site.choiceMode === "source_order" ? 5 : detail.choices.length;
      const correctSourceIndex = answerSourceIndex(detail.officialAnswer, sourceCount);
      if (correctSourceIndex < 0 || sourceCount < 2) {
        throw new Error("This question does not have one usable verified answer yet.");
      }
      const savedPermutation = asArray(savedCurrent?.permutation);
      let current =
        savedCurrent &&
        savedPermutation.length === sourceCount &&
        new Set(savedPermutation).size === sourceCount &&
        savedPermutation.every(
          (entry) => Number.isInteger(entry) && entry >= 0 && entry < sourceCount,
        )
          ? savedCurrent
          : null;
      if (!current) {
        const permutation = site.choiceMode === "source_order"
          ? Array.from({ length: sourceCount }, (_, index) => index)
          : shuffledPermutation(sourceCount, correctSourceIndex);
        current = {
          itemId,
          permutation,
          phase: "answering",
          selectedDisplayIndex: null,
          wrongSourceIndexes: [],
          missed: false,
          comparisonAnchorId: comparison?.anchorId || "",
          comparisonView: comparison?.view || "surface",
          comparisonEtag: comparison?.etag || "",
          comparisonSaved: false,
        };
      }
      const seenIds = state.progress.seenIds.includes(itemId)
        ? state.progress.seenIds
        : [...state.progress.seenIds, itemId];
      state.currentSite = site;
      state.currentDetail = detail;
      state.currentNeighbors = null;
      updateProgress({ current, seenIds });
      setPlayLoading(false);
      renderCurrentQuestion({ focusAnswer });
      void loadNeighborList(itemId);
      announce(`Opened ${detail.sourceLabel}.`);
      return true;
    } catch (error) {
      if (token !== state.requestToken) return false;
      if (
        savedCurrent &&
        restoreAttempt < 2 &&
        (error.status === 404 || /unknown item/i.test(error.message))
      ) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 400 * (restoreAttempt + 1));
        });
        if (token !== state.requestToken) return false;
        return loadItem(itemId, {
          savedCurrent,
          comparison,
          focusAnswer,
          restoreAttempt: restoreAttempt + 1,
        });
      }
      setPlayLoading(false);
      byId("problem-selected-empty").hidden = false;
      byId("problem-selected-empty").querySelector("strong").textContent = "This question could not open";
      byId("problem-selected-empty").querySelector("p").textContent = error.message;
      return false;
    }
  }

  function chooseRandomSite(candidates, avoidId = "") {
    if (!candidates.length) return null;
    const seen = new Set(state.progress.seenIds);
    let available = candidates.filter((site) => !seen.has(site.id) && site.id !== avoidId);
    if (!available.length) available = candidates.filter((site) => site.id !== avoidId);
    if (!available.length) available = candidates;
    return available[randomIndex(available.length)] || null;
  }

  async function drawFromSelection({ resetRoute = true } = {}) {
    const candidates = candidatesForSelection();
    const site = chooseRandomSite(candidates, state.progress.current?.itemId || "");
    if (!site) {
      byId("world-map-status").textContent = "No verified questions are available in this region yet.";
      return false;
    }
    if (resetRoute) updateProgress({ routeSteps: 0 });
    return loadItem(site.id);
  }

  async function drawNeighbor() {
    const anchorId = state.progress.current?.itemId;
    if (!anchorId) return false;
    const view = byId("problem-space-view-select")?.value || "surface";
    try {
      const url = new URL(
        `${API.items}/${encodeURIComponent(anchorId)}/neighbors`,
        window.location.origin,
      );
      url.searchParams.set("view", view);
      url.searchParams.set("limit", "50");
      const { payload } = await requestJson(url);
      const neighbors = asArray(asRecord(payload).neighbors);
      const seen = new Set(state.progress.seenIds);
      const candidate = neighbors.find((value) => {
        const record = asRecord(value);
        const id = stringValue(firstDefined(record.item_id, record.id));
        return state.sitesById.has(id) && !seen.has(id);
      });
      if (!candidate) return false;
      const record = asRecord(candidate);
      const id = stringValue(firstDefined(record.item_id, record.id));
      const existing = asRecord(firstDefined(record.existing_review, record.review));
      return loadItem(id, {
        comparison: {
          anchorId,
          view: stringValue(asRecord(payload).view, view),
          etag: stringValue(existing.etag),
        },
      });
    } catch {
      return false;
    }
  }

  function renderNeighborList() {
    const list = byId("problem-neighbor-list");
    list.replaceChildren();
    const payload = state.currentNeighbors;
    if (!payload || !state.currentSite) {
      byId("problem-neighbors-summary").textContent = "";
      return;
    }
    const neighbors = asArray(payload.neighbors)
      .map((value) => {
        const record = asRecord(value);
        const id = stringValue(firstDefined(record.item_id, record.id));
        return { record, id, site: state.sitesById.get(id) };
      })
      .filter((entry) => entry.site)
      .slice(0, 8);
    const canWalk = ["solved", "complete"].includes(state.progress.current?.phase);
    neighbors.forEach(({ record, id, site }, index) => {
      const item = node("li", { className: "problem-neighbor-item" });
      const score = Number(record.score);
      const button = node("button", {
        className: "problem-neighbor-button",
        attrs: {
          type: "button",
          "data-world-neighbor-id": id,
          "data-world-neighbor-etag": stringValue(
            asRecord(firstDefined(record.existing_review, record.review)).etag,
          ),
          disabled: canWalk ? undefined : "",
          "aria-label": `Walk to nearby question ${index + 1}, ${site.sourceLabel}`,
        },
      });
      const heading = node("span", { className: "problem-neighbor-header" });
      const identity = node("span");
      identity.append(
        node("strong", { text: site.sourceLabel }),
        node("small", {
          text: [
            `${site.pointTier || "?"} points`,
            realmById(siteHome(site).realmId)?.label || "Question Heaven",
          ].join(" · "),
        }),
      );
      heading.append(identity);
      if (Number.isFinite(score)) {
        heading.append(
          node("span", { className: "score-badge", text: `Near ${score.toFixed(2)}` }),
        );
      }
      button.append(
        heading,
        node("span", {
          className: "problem-neighbor-prompt",
          text: stringValue(record.prompt, "Open this question to inspect the complete prompt."),
        }),
        node("span", {
          className: "problem-neighbor-action",
          text: canWalk ? "Walk here →" : "Solve this question before taking a road",
        }),
      );
      item.append(button);
      list.append(item);
    });
    byId("problem-neighbors-summary").textContent = neighbors.length
      ? `${neighbors.length} nearby`
      : "No Grades 1–2 roads";
  }

  async function loadNeighborList(itemId) {
    const view = byId("problem-space-view-select")?.value || "surface";
    try {
      const url = new URL(
        `${API.items}/${encodeURIComponent(itemId)}/neighbors`,
        window.location.origin,
      );
      url.searchParams.set("view", view);
      url.searchParams.set("limit", "20");
      const { payload } = await requestJson(url);
      if (state.currentSite?.id !== itemId) return;
      state.currentNeighbors = asRecord(payload);
      renderNeighborList();
    } catch {
      if (state.currentSite?.id !== itemId) return;
      state.currentNeighbors = null;
      byId("problem-neighbor-list").replaceChildren();
      byId("problem-neighbors-summary").textContent = "Roads unavailable";
    }
  }

  async function nextQuestion() {
    const current = state.progress.current;
    if (!current || !["solved", "complete"].includes(current.phase)) return;
    byId("world-play-next").disabled = true;
    let moved = false;
    if (state.progress.routeSteps < 2) {
      moved = await drawNeighbor();
      if (moved) updateProgress({ routeSteps: state.progress.routeSteps + 1 });
    }
    if (!moved) {
      updateProgress({ routeSteps: 0 });
      moved = await drawFromSelection({ resetRoute: false });
    }
    byId("world-play-next").disabled = false;
  }

  function chooseAnswer(displayIndex) {
    const detail = state.currentDetail;
    const current = state.progress.current;
    if (!detail || !current || current.phase !== "answering") return;
    const sourceIndex = current.permutation[displayIndex];
    const correctSourceIndex = answerSourceIndex(detail.officialAnswer, current.permutation.length);
    const correct = sourceIndex === correctSourceIndex;
    const next = {
      ...current,
      selectedDisplayIndex: displayIndex,
      missed: current.missed || !correct,
      phase: correct ? "solved" : "reviewing",
      wrongSourceIndexes: correct
        ? current.wrongSourceIndexes
        : [...new Set([...current.wrongSourceIndexes, sourceIndex])],
    };
    const solvedIds = correct && !state.progress.solvedIds.includes(detail.id)
      ? [...state.progress.solvedIds, detail.id]
      : state.progress.solvedIds;
    const firstTryCorrectIds =
      correct && !current.missed && !state.progress.firstTryCorrectIds.includes(detail.id)
        ? [...state.progress.firstTryCorrectIds, detail.id]
        : state.progress.firstTryCorrectIds;
    updateProgress({
      current: next,
      solvedIds,
      firstTryCorrectIds,
      lastCorrectPosition: correct ? displayIndex : state.progress.lastCorrectPosition,
    });
    playEarcon(correct);
    renderCurrentQuestion();
    renderNeighborList();
    if (correct) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1300 : 2200;
    state.retryTimer = window.setTimeout(() => {
      if (state.progress.current?.itemId !== detail.id || state.progress.current.phase !== "reviewing") {
        return;
      }
      updateProgress({
        current: {
          ...state.progress.current,
          phase: "answering",
          selectedDisplayIndex: null,
        },
      });
      renderCurrentQuestion();
      window.requestAnimationFrame(() => {
        const attempted = byId(`world-play-choice-${displayIndex + 1}`);
        const fallback = byId("problem-selected-choices").querySelector(
          ".world-play-choice:not(:disabled)",
        );
        (attempted?.disabled ? fallback : attempted)?.focus();
      });
    }, delay);
  }

  function placementBody(verdict, selected = null) {
    const site = state.currentSite;
    const suggestion = qaSuggestion(site);
    return {
      content_version: site.contentVersion,
      layout_version: state.payload.layoutVersion,
      presented_realm_id: suggestion.realmId || null,
      presented_district_id: suggestion.districtId || null,
      verdict,
      selected_realm_id: selected?.realmId || null,
      selected_district_id: selected?.districtId || null,
      notes: byId("world-play-qa-note").value.trim(),
    };
  }

  function setQaSaving(saving) {
    state.qaSaving = saving;
    [
      "world-play-qa-fits",
      "world-play-qa-change",
      "world-play-qa-unsure",
      "world-play-qa-skip",
    ].forEach((id) => {
      byId(id).disabled = saving;
    });
    syncChangeSaveState();
    if (saving) byId("world-play-qa-status").textContent = "Saving…";
  }

  async function refreshWorld() {
    const { payload } = await requestJson(API.world);
    const normalized = normalizeWorld(payload);
    state.payload = normalized;
    state.sitesById = new Map(normalized.sites.map((site) => [site.id, site]));
    if (state.currentSite) state.currentSite = state.sitesById.get(state.currentSite.id) || state.currentSite;
    updateRealmCounts();
    updateSelectionUi();
  }

  async function savePlacement(verdict, selected = null) {
    const site = state.currentSite;
    if (!site) return;
    setQaSaving(true);
    try {
      const { payload, response } = await requestJson(
        `${API.items}/${encodeURIComponent(site.id)}/world-placement`,
        {
          method: "PUT",
          headers: { "If-Match": site.placement.etag || "*" },
          body: JSON.stringify(placementBody(verdict, selected)),
        },
      );
      const saved = placementRecord(
        firstDefined(
          asRecord(payload).current_placement,
          asRecord(payload).placement,
          asRecord(payload).current,
          payload,
        ),
      );
      saved.etag = response.headers.get("ETag") || saved.etag;
      site.placement = saved;
      site.approved = ["fits", "change"].includes(saved.verdict);
      if (site.approved) {
        site.effectiveRealmId = saved.realmId;
        site.effectiveDistrictId = saved.districtId;
        site.mapStatus = "approved";
      }
      await refreshWorld();
      byId("world-play-qa-change-controls").hidden = true;
      byId("world-play-qa-status").textContent = site.approved
        ? "Approved for this world version. You can change it later."
        : verdict === "unsure"
          ? "Marked unsure. It will stay available for another pass."
          : "Skipped for now. It will stay available for another pass.";
      byId("world-play-next").hidden = false;
      updateProgress({
        current: { ...state.progress.current, phase: "complete" },
      });
      renderChoices(state.currentDetail, state.progress.current);
      announce(site.approved ? "World placement approved." : "Placement review saved.");
      window.requestAnimationFrame(() => byId("world-play-next").focus());
    } catch (error) {
      byId("world-play-qa-status").textContent =
        error.status === 412
          ? "This placement changed in another view. Reload the world and try again."
          : `Could not save: ${error.message}`;
    } finally {
      setQaSaving(false);
    }
  }

  async function saveNeighborRating(rating) {
    const current = state.progress.current;
    if (!current?.comparisonAnchorId || current.comparisonSaved) return;
    const status = byId("world-play-neighbor-status");
    status.textContent = "Saving route judgment…";
    try {
      await requestJson(
        `${API.items}/${encodeURIComponent(current.comparisonAnchorId)}/neighbors/${encodeURIComponent(current.itemId)}/review`,
        {
          method: "PUT",
          headers: { "If-Match": current.comparisonEtag || "*" },
          body: JSON.stringify({ rating, view: current.comparisonView || "surface" }),
        },
      );
      updateProgress({ current: { ...current, comparisonSaved: true } });
      status.textContent = "Route judgment saved.";
      byId("world-play-neighbor-qa").classList.add("is-saved");
      announce("Nearby-question judgment saved.");
    } catch (error) {
      status.textContent = `Could not save route judgment: ${error.message}`;
    }
  }

  function selectRealm(realmId) {
    state.activeRealmId = realmId;
    state.activeDistrictId = "";
    updateProgress({ activeRealmId: realmId, activeDistrictId: "", routeSteps: 0 });
    updateSelectionUi();
    void drawFromSelection();
  }

  async function searchAndOpen() {
    const query = byId("problem-space-query").value.trim();
    if (!query) {
      byId("problem-space-error").hidden = false;
      byId("problem-space-error").textContent = "Enter a question ID or phrase, or choose Surprise me.";
      return;
    }
    byId("problem-space-error").hidden = true;
    if (state.sitesById.has(query)) {
      await loadItem(query);
      return;
    }
    const view = byId("problem-space-view-select").value === "tag"
      ? "surface"
      : byId("problem-space-view-select").value;
    try {
      const { payload } = await requestJson(API.explore, {
        method: "POST",
        body: JSON.stringify({ query, view, limit: 12 }),
      });
      const match = asArray(asRecord(payload).neighbors).find((value) =>
        state.sitesById.has(stringValue(firstDefined(asRecord(value).item_id, asRecord(value).id))),
      );
      if (!match) throw new Error("No Grades 1–2 match was found.");
      await loadItem(stringValue(firstDefined(asRecord(match).item_id, asRecord(match).id)));
    } catch (error) {
      byId("problem-space-error").hidden = false;
      byId("problem-space-error").textContent = error.message;
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-world-realm]").forEach((button) => {
      button.addEventListener("click", () => selectRealm(button.dataset.worldRealm));
    });
    byId("world-crossroads").addEventListener("click", () => selectRealm(""));
    byId("world-heaven-open").addEventListener("click", () => selectRealm("heaven"));
    byId("world-sound-toggle").addEventListener("click", () => {
      state.soundEnabled = !state.soundEnabled;
      try {
        safeStorage()?.setItem(SOUND_KEY, String(state.soundEnabled));
      } catch {
        // Keep the in-memory setting when storage is unavailable.
      }
      if (state.soundEnabled) ensureAudioContext();
      syncSoundToggle();
    });
    byId("world-play-answer-form").addEventListener("submit", (event) => event.preventDefault());
    byId("problem-selected-choices").addEventListener("click", (event) => {
      const button = event.target.closest("[data-world-choice-index]");
      if (button) chooseAnswer(integer(button.dataset.worldChoiceIndex));
    });
    byId("world-play-next").addEventListener("click", nextQuestion);
    byId("world-play-qa-fits").addEventListener("click", () => savePlacement("fits"));
    byId("world-play-qa-change").addEventListener("click", () => {
      const controls = byId("world-play-qa-change-controls");
      controls.hidden = !controls.hidden;
      if (!controls.hidden) byId("world-play-qa-realm").focus();
    });
    byId("world-play-qa-unsure").addEventListener("click", () => savePlacement("unsure"));
    byId("world-play-qa-skip").addEventListener("click", () => savePlacement("skip"));
    byId("world-play-qa-realm").addEventListener("change", (event) => {
      populateDistrictSelect(event.target.value);
    });
    byId("world-play-qa-district").addEventListener("change", syncChangeSaveState);
    byId("world-play-qa-save-change").addEventListener("click", () => {
      const realmId = byId("world-play-qa-realm").value;
      const districtId = byId("world-play-qa-district").value;
      if (!REALM_IDS.includes(realmId) || !districtById(realmId, districtId)) {
        byId("world-play-qa-status").textContent = "Choose both a realm and one of its districts.";
        return;
      }
      void savePlacement("change", { realmId, districtId });
    });
    byId("world-play-qa-card").addEventListener("click", (event) => {
      const button = event.target.closest("[data-world-neighbor-rating]");
      if (button) void saveNeighborRating(button.dataset.worldNeighborRating);
    });
    byId("problem-neighbor-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-world-neighbor-id]");
      if (!button || button.disabled || !state.currentSite) return;
      void loadItem(button.dataset.worldNeighborId, {
        comparison: {
          anchorId: state.currentSite.id,
          view: byId("problem-space-view-select")?.value || "surface",
          etag: button.dataset.worldNeighborEtag || "",
        },
      });
    });
    byId("problem-space-search").addEventListener("submit", (event) => {
      if (!state.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void searchAndOpen();
    }, true);
    byId("problem-space-random").addEventListener("click", (event) => {
      if (!state.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void drawFromSelection();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!state.active || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!/^[1-5]$/.test(event.key)) return;
      const index = Number(event.key) - 1;
      if (
        index < 0 ||
        index >= (state.progress?.current?.permutation.length || 0) ||
        state.progress?.current?.phase !== "answering"
      ) {
        return;
      }
      event.preventDefault();
      chooseAnswer(index);
    });
  }

  async function loadWorld() {
    if (state.loading) return;
    if (state.payload) {
      const current = state.progress?.current;
      if (current && state.currentDetail?.id !== current.itemId) {
        const restored = await loadItem(current.itemId, {
          savedCurrent: current,
          focusAnswer: true,
        });
        if (!restored) setStorageStatus("Your saved question is intact; choose World again to retry loading it.");
      } else if (current && state.currentDetail?.id === current.itemId) {
        renderCurrentQuestion({ focusAnswer: true });
      }
      return;
    }
    state.loading = true;
    byId("problem-space-map-loading").hidden = false;
    try {
      const { payload } = await requestJson(API.world);
      const normalized = normalizeWorld(payload);
      if (!normalized.runId || !normalized.sites.length || normalized.realms.length !== 6) {
        throw new Error("The Grades 1–2 world is incomplete.");
      }
      state.payload = normalized;
      state.sitesById = new Map(normalized.sites.map((site) => [site.id, site]));
      state.progress = loadProgress(normalized);
      state.activeRealmId = state.progress.activeRealmId;
      state.activeDistrictId = state.progress.activeDistrictId;
      byId("problem-space-map-loading").hidden = true;
      byId("problem-space-workspace").hidden = false;
      updateRealmCounts();
      updateSelectionUi();
      if (state.progress.current) {
        const restored = await loadItem(state.progress.current.itemId, {
          savedCurrent: state.progress.current,
          focusAnswer: true,
        });
        if (!restored) {
          setStorageStatus("Your saved question is intact; reload or choose World again to retry it.");
        }
      }
    } catch (error) {
      byId("problem-space-map-loading").hidden = true;
      byId("problem-space-error").hidden = false;
      byId("problem-space-error").textContent = `The Grades 1–2 world could not load: ${error.message}`;
    } finally {
      state.loading = false;
    }
  }

  function activate() {
    state.active = true;
    if (!state.initialized) {
      state.initialized = true;
      state.soundEnabled = readSoundPreference();
      syncSoundToggle();
      bindEvents();
    }
    void loadWorld();
  }

  function deactivate() {
    state.active = false;
    window.clearTimeout(state.retryTimer);
    const current = state.progress?.current;
    if (["reviewing", "retry"].includes(current?.phase)) {
      updateProgress({
        current: {
          ...current,
          phase: "answering",
          selectedDisplayIndex: null,
        },
      });
    }
  }

  function openItem(itemId) {
    if (!state.sitesById.has(itemId)) return Promise.resolve(false);
    return loadItem(itemId);
  }

  function currentItemId() {
    return state.currentSite?.id || state.progress?.current?.itemId || "";
  }

  window.CatalogueWorldQA = Object.freeze({
    activate,
    deactivate,
    openItem,
    currentItemId,
  });
})();
