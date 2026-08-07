(() => {
  "use strict";

  const API = Object.freeze({
    summary: "/api/catalogue/summary",
    items: "/api/catalogue/items",
    taxonomy: "/api/catalogue/taxonomy",
    export: "/api/catalogue/export",
    recommendations: "/api/catalogue/recommendations/preview",
    map: "/api/catalogue/map",
    explore: "/api/catalogue/explore",
  });
  const MAP_QUESTION_SCALE = 2.3;

  const VIEWS = Object.freeze([
    "overview",
    "taxonomy",
    "similarity",
    "world",
    "curriculum",
    "questions",
    "promotion",
  ]);
  const FILTER_KEYS = Object.freeze([
    "grade",
    "points",
    "modality",
    "answer_status",
    "review_state",
    "promotion_state",
    "primary_domain",
    "question_type",
    "q",
  ]);
  const SOURCE_CHECK_KEYS = Object.freeze([
    "prompt",
    "choices",
    "answer",
    "points",
    "visual",
  ]);
  const NEIGHBOR_RATINGS = Object.freeze([
    ["same_strategy", "Same strategy"],
    ["same_skill_different_surface", "Same skill, different surface"],
    ["surface_only", "Surface only"],
    ["duplicate", "Duplicate"],
    ["unrelated", "Unrelated"],
    ["unsure", "Unsure"],
  ]);

  const state = {
    activeView: "overview",
    summary: null,
    taxonomy: null,
    selectedSkillId: "",
    skillReviewSaving: false,
    filters: Object.fromEntries(FILTER_KEYS.map((key) => [key, ""])),
    items: {
      rows: [],
      total: 0,
      offset: 0,
      limit: 25,
      loaded: false,
      requestToken: 0,
      detail: null,
      detailId: "",
      etag: "*",
      saving: false,
    },
    similarity: {
      anchorId: "",
      view: "hybrid",
      limit: 12,
      payload: null,
      requestToken: 0,
      ratings: new Map(),
      etags: new Map(),
    },
    problemSpace: {
      query: "",
      view: "surface",
      anchorId: "",
      mapPayload: null,
      mapRequestToken: 0,
      searchRequestToken: 0,
      neighborhoodRequestToken: 0,
      detailRequestToken: 0,
      trail: [],
      trailIndex: -1,
      filters: { grade: "", points: "", domain: "", questionType: "" },
      visiblePoints: [],
      focusedPointId: "",
      hoveredPointId: "",
      focusedClusterId: "",
      hoveredClusterId: "",
      randomSeenIds: new Set(),
      scale: 1,
      panX: 0,
      panY: 0,
      drag: null,
      resizeObserver: null,
    },
    recommendation: {
      payload: null,
      requestToken: 0,
    },
    retry: null,
  };

  const byId = (id) => document.getElementById(id);
  const asRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const firstDefined = (...values) =>
    values.find((value) => value !== undefined && value !== null);
  const stringValue = (value, fallback = "") => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  };
  const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const integer = (value, fallback = 0) => Math.max(0, Math.trunc(finiteNumber(value, fallback)));
  const formatNumber = (value) => integer(value).toLocaleString();
  const humanize = (value) =>
    stringValue(value, "Unknown")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const languageName = (value) => {
    const code = stringValue(value).trim();
    if (!code) return "Source language";
    try {
      return new Intl.DisplayNames([navigator.language || "en"], { type: "language" }).of(code) || code;
    } catch {
      return code;
    }
  };
  const gradeRangeValue = (value) => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    const range = asRecord(value);
    const minimum = firstDefined(range.min, range.minimum, range.from);
    const maximum = firstDefined(range.max, range.maximum, range.to);
    if (minimum !== undefined && maximum !== undefined) return `${minimum}–${maximum}`;
    return "";
  };
  const pointTierValue = (value) => {
    if (typeof value === "string" || typeof value === "number") return integer(value);
    const tier = asRecord(value);
    return integer(
      firstDefined(
        tier.points,
        tier.value,
        tier.tier,
        tier.point_tier,
        tier.published_point_tier,
      ),
    );
  };

  function node(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = stringValue(options.text);
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([name, value]) => {
        if (value !== undefined && value !== null) element.setAttribute(name, String(value));
      });
    }
    return element;
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = stringValue(value, "—");
  }

  function announce(message) {
    const region = byId("live-message");
    region.textContent = "";
    window.setTimeout(() => {
      region.textContent = message;
    }, 20);
  }

  function safeSameOriginUrl(value) {
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
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
      credentials: "same-origin",
    });
    let payload = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => "");
      payload = text ? { message: text } : null;
    }
    if (!response.ok) {
      const record = asRecord(payload);
      const error = new Error(
        stringValue(firstDefined(record.message, record.detail, record.error)) ||
          `Request failed with status ${response.status}.`,
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return { payload, response };
  }

  function setConnection(kind, text) {
    const badge = byId("connection-badge");
    badge.classList.toggle("is-loading", kind === "loading");
    badge.classList.toggle("is-error", kind === "error");
    badge.textContent = text;
  }

  function showGlobalError(title, error, retry) {
    setText("error-title", title);
    setText("error-message", error instanceof Error ? error.message : String(error));
    byId("error-banner").hidden = false;
    state.retry = retry || null;
    byId("retry-request").hidden = !state.retry;
    setConnection("error", "Local service unavailable");
  }

  function clearGlobalError() {
    byId("error-banner").hidden = true;
    state.retry = null;
    setConnection("ready", "Private local service");
  }

  function setInlineError(id, message = "") {
    const element = byId(id);
    element.textContent = message;
    element.hidden = !message;
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", state.activeView);
    FILTER_KEYS.forEach((key) => {
      const value = state.filters[key];
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });
    if (state.items.offset) url.searchParams.set("offset", String(state.items.offset));
    else url.searchParams.delete("offset");
    if (state.items.limit !== 25) url.searchParams.set("limit", String(state.items.limit));
    else url.searchParams.delete("limit");
    if (state.items.detailId) url.searchParams.set("item", state.items.detailId);
    else url.searchParams.delete("item");
    if (state.similarity.anchorId) url.searchParams.set("anchor", state.similarity.anchorId);
    else url.searchParams.delete("anchor");
    if (state.similarity.view !== "hybrid") {
      url.searchParams.set("similarity_view", state.similarity.view);
    } else {
      url.searchParams.delete("similarity_view");
    }
    if (state.problemSpace.anchorId) {
      url.searchParams.set("space_anchor", state.problemSpace.anchorId);
    } else {
      url.searchParams.delete("space_anchor");
    }
    if (state.problemSpace.view !== "surface") {
      url.searchParams.set("space_view", state.problemSpace.view);
    } else {
      url.searchParams.delete("space_view");
    }
    window.history.replaceState(null, "", url);
  }

  function readUrlState() {
    const params = new URL(window.location.href).searchParams;
    const requestedView = params.get("view");
    const view = requestedView === "problem-space" ? "world" : requestedView;
    state.activeView = VIEWS.includes(view) ? view : "overview";
    FILTER_KEYS.forEach((key) => {
      state.filters[key] = params.get(key) || "";
    });
    state.items.offset = integer(params.get("offset"), 0);
    const limit = integer(params.get("limit"), 25);
    state.items.limit = [10, 25, 50].includes(limit) ? limit : 25;
    state.items.detailId = params.get("item") || "";
    state.similarity.anchorId = params.get("anchor") || state.items.detailId;
    const similarityView = params.get("similarity_view") || "hybrid";
    state.similarity.view = ["surface", "tag", "hybrid"].includes(similarityView)
      ? similarityView
      : "hybrid";
    state.problemSpace.anchorId = params.get("space_anchor") || "";
    const problemView = params.get("space_view") || "surface";
    state.problemSpace.view = ["surface", "tag", "hybrid"].includes(problemView)
      ? problemView
      : "hybrid";
  }

  function syncControlsFromState() {
    FILTER_KEYS.forEach((key) => {
      const control = document.querySelector(`[name="${key}"]`);
      if (control) control.value = state.filters[key];
    });
    byId("filter-limit").value = String(state.items.limit);
    byId("similarity-anchor-id").value = state.similarity.anchorId;
    byId("similarity-view-select").value = state.similarity.view;
    byId("similarity-limit").value = String(state.similarity.limit);
    byId("problem-space-view-select").value = state.problemSpace.view;
  }

  function setActiveView(view, { focus = false } = {}) {
    if (!VIEWS.includes(view)) return;
    state.activeView = view;
    let activeTab = null;
    document.querySelectorAll(".view-tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) activeTab = tab;
    });
    VIEWS.forEach((name) => {
      byId(`${name}-view`).hidden = name !== view;
    });
    updateUrl();
    if (focus) byId(`${view}-tab`).focus();
    window.requestAnimationFrame(() => {
      activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    if (view === "questions" && !state.items.loaded) loadItems();
    if (view === "similarity") {
      if (state.similarity.anchorId && !state.similarity.payload) loadNeighbors();
      else if (!state.similarity.anchorId) byId("similarity-empty").hidden = false;
    }
    if (view === "world") {
      window.CatalogueWorldQA?.activate();
      loadProblemMap();
      window.requestAnimationFrame(drawProblemMap);
    } else {
      window.CatalogueWorldQA?.deactivate();
    }
  }

  function countMap(value) {
    if (Array.isArray(value)) {
      return Object.fromEntries(
        value.map((entry) => {
          const record = asRecord(entry);
          return [
            stringValue(firstDefined(record.key, record.id, record.value, record.label)),
            integer(firstDefined(record.count, record.total, record.value_count)),
          ];
        }),
      );
    }
    const record = asRecord(value);
    return Object.fromEntries(
      Object.entries(record).map(([key, count]) => [
        key,
        typeof count === "object"
          ? integer(firstDefined(count.count, count.total, count.value))
          : integer(count),
      ]),
    );
  }

  function normalizeSummary(payload) {
    const root = asRecord(payload);
    const counts = asRecord(root.counts);
    const source = asRecord(firstDefined(root.source_review, root.source, counts.source_review));
    const curriculum = asRecord(
      firstDefined(root.curriculum_review, root.curriculum, counts.curriculum_review),
    );
    const promotion = asRecord(firstDefined(root.promotion, root.promotion_counts, counts.promotion));
    const total = integer(
      firstDefined(root.total_items, root.total, root.corpus_total, counts.total),
      1833,
    );
    return {
      total,
      sourceReviewed: integer(
        firstDefined(source.reviewed, source.complete, root.source_reviewed),
      ),
      classified: integer(
        firstDefined(
          curriculum.teacher_classified,
          curriculum.classified,
          curriculum.reviewed,
          root.teacher_classified_items,
          root.curriculum_classified,
        ),
      ),
      proposalAvailable: integer(
        firstDefined(
          curriculum.proposal_available,
          root.proposal_available_items,
          counts.proposal_available_items,
        ),
      ),
      proposalClassified: integer(
        firstDefined(
          curriculum.proposal_classified,
          root.proposal_classified_items,
          counts.proposal_classified_items,
        ),
      ),
      attention: integer(
        firstDefined(source.needs_attention, root.needs_attention, counts.needs_attention),
      ),
      answerStatuses: countMap(
        firstDefined(root.answer_status_counts, root.answer_statuses, asRecord(root.distributions).answer_status),
      ),
      modalities: countMap(
        firstDefined(root.modality_counts, root.modalities, asRecord(root.distributions).modality),
      ),
      promotion: {
        blocked: integer(firstDefined(promotion.blocked, root.promotion_blocked)),
        curriculumReady: integer(
          firstDefined(promotion.curriculum_ready, promotion.curriculumReady),
        ),
        releaseCandidate: integer(
          firstDefined(promotion.release_candidate, promotion.releaseCandidate),
        ),
        promoted: integer(promotion.promoted),
        blockers: countMap(
          firstDefined(promotion.blockers, root.promotion_blockers, root.blocker_counts),
        ),
      },
    };
  }

  function renderBreakdown(id, values, emptyLabel) {
    const list = byId(id);
    list.replaceChildren();
    const entries = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) {
      const row = node("div");
      row.append(node("dt", { text: emptyLabel }), node("dd", { text: "—" }));
      list.append(row);
      return;
    }
    entries.forEach(([label, count]) => {
      const row = node("div");
      row.append(node("dt", { text: humanize(label) }), node("dd", { text: formatNumber(count) }));
      list.append(row);
    });
  }

  function renderBlockerList(id, blockers) {
    const list = byId(id);
    list.replaceChildren();
    const entries = Object.entries(blockers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) {
      const item = node("li");
      item.append(node("span", { text: "No blocker counts reported" }), node("strong", { text: "—" }));
      list.append(item);
      return;
    }
    entries.forEach(([label, count]) => {
      const item = node("li");
      item.append(node("span", { text: humanize(label) }), node("strong", { text: formatNumber(count) }));
      list.append(item);
    });
  }

  function renderSummary() {
    const summary = state.summary;
    if (!summary) return;
    const total = Math.max(1, summary.total);
    setText("overview-total", formatNumber(summary.total));
    setText("questions-tab-count", formatNumber(summary.total));
    setText("source-reviewed-count", formatNumber(summary.sourceReviewed));
    setText("source-reviewed-detail", `of ${formatNumber(summary.total)} questions`);
    byId("source-reviewed-progress").max = total;
    byId("source-reviewed-progress").value = Math.min(total, summary.sourceReviewed);
    setText("classified-count", formatNumber(summary.classified));
    setText("classified-detail", `of ${formatNumber(summary.total)} teacher judgments`);
    const proposalCoverage = byId("proposal-coverage-detail");
    proposalCoverage.hidden = summary.proposalAvailable === 0;
    proposalCoverage.textContent = summary.proposalAvailable
      ? `${formatNumber(summary.proposalAvailable)} proposals available · ${formatNumber(summary.proposalClassified)} classified beyond unknown`
      : "";
    byId("classified-progress").max = total;
    byId("classified-progress").value = Math.min(total, summary.classified);
    setText("attention-count", formatNumber(summary.attention));
    setText("curriculum-ready-count", formatNumber(summary.promotion.curriculumReady));
    renderBreakdown("answer-status-overview", summary.answerStatuses, "No answer status data");
    renderBreakdown("modality-overview", summary.modalities, "No modality data");
    renderBlockerList("overview-blocker-list", summary.promotion.blockers);
    setText("promotion-blocked-count", formatNumber(summary.promotion.blocked));
    setText("promotion-curriculum-count", formatNumber(summary.promotion.curriculumReady));
    setText("promotion-release-count", formatNumber(summary.promotion.releaseCandidate));
    setText("promotion-promoted-count", formatNumber(summary.promotion.promoted));
    renderBlockerList("promotion-blocker-breakdown", summary.promotion.blockers);
    byId("overview-loading").hidden = true;
    byId("overview-content").hidden = false;
    byId("promotion-loading").hidden = true;
    byId("promotion-content").hidden = false;
  }

  async function loadSummary({ silent = false } = {}) {
    if (!silent) {
      byId("overview-loading").hidden = false;
      byId("promotion-loading").hidden = false;
    }
    try {
      const { payload } = await requestJson(API.summary);
      state.summary = normalizeSummary(payload);
      renderSummary();
      clearGlobalError();
    } catch (error) {
      showGlobalError("The full-corpus summary could not be loaded.", error, () => loadSummary());
    }
  }

  function vocabularyEntries(value) {
    if (Array.isArray(value)) return value;
    return Object.entries(asRecord(value)).map(([id, entry]) =>
      typeof entry === "object" ? { id, ...entry } : { id, label: entry },
    );
  }

  function normalizeVocabulary(value) {
    return vocabularyEntries(value)
      .map((entry) => {
        if (typeof entry === "string") return { id: entry, label: humanize(entry), description: "" };
        const record = asRecord(entry);
        const id = stringValue(
          firstDefined(record.id, record.value, record.skill_id, record.tag_id, record.code),
        );
        return {
          id,
          label: stringValue(firstDefined(record.label, record.name, record.title), humanize(id)),
          description: stringValue(firstDefined(record.description, record.definition, record.help_text)),
          status: stringValue(firstDefined(record.status, record.review_state)),
          facet: stringValue(firstDefined(record.facet, record.category, record.group)),
          gradeRange: gradeRangeValue(
            firstDefined(
              record.grade_range,
              record.typical_grade_range,
              record.grade_band,
              record.grades,
            ),
          ),
          boundaryNote: stringValue(
            firstDefined(record.boundary_note, record.boundary, record.exclusions, record.scope_note),
          ),
          coverageCount: integer(
            firstDefined(record.coverage_count, record.proposal_coverage_count, record.item_count),
          ),
          examples: asArray(
            firstDefined(record.example_items, record.examples, record.example_item_ids),
          ),
          relations: asArray(firstDefined(record.relations, record.proposed_relations)),
          review: asRecord(firstDefined(record.current_judgement, record.current_judgment, record.review)),
          etag: stringValue(record.etag),
        };
      })
      .filter((entry) => entry.id)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function normalizeTaxonomy(payload) {
    const root = asRecord(payload);
    const vocab = asRecord(firstDefined(root.vocabularies, root.controlled_vocabularies));
    const skillReviews = asRecord(
      firstDefined(root.skill_judgements, root.skill_judgments, root.skill_reviews),
    );
    const skillCoverage = asRecord(firstDefined(root.skill_coverage, root.coverage_by_skill));
    const skillExamples = asRecord(firstDefined(root.skill_examples, root.examples_by_skill));
    const skillRelations = asRecord(firstDefined(root.skill_relations, root.relations_by_skill));
    const globalRelations = asArray(root.relations);
    const skills = normalizeVocabulary(firstDefined(root.skills, vocab.skills)).map((skill) => {
      const coverage = asRecord(skillCoverage[skill.id]);
      const related = globalRelations.filter((value) => {
        const relation = asRecord(value);
        return [
          relation.from_skill_id,
          relation.to_skill_id,
          relation.source_skill_id,
          relation.target_skill_id,
          relation.from,
          relation.to,
        ].includes(skill.id);
      });
      const directCoverage = skillCoverage[skill.id];
      return {
        ...skill,
        coverageCount: integer(
          firstDefined(
            coverage.count,
            coverage.total,
            typeof directCoverage === "number" ? directCoverage : undefined,
            skill.coverageCount,
          ),
        ),
        examples: asArray(
          firstDefined(coverage.examples, skillExamples[skill.id], skill.examples),
        ),
        relations: asArray(
          firstDefined(skillRelations[skill.id], skill.relations.length ? skill.relations : undefined, related),
        ),
        review: asRecord(firstDefined(skillReviews[skill.id], skill.review)),
        etag: stringValue(
          firstDefined(
            asRecord(skillReviews[skill.id]).etag,
            coverage.etag,
            skill.etag,
          ),
        ),
      };
    });
    return {
      version: stringValue(
        firstDefined(root.ontology_version, vocab.ontology_version, root.version, root.schema_version),
        "Unversioned",
      ),
      status: stringValue(
        firstDefined(root.status, root.ontology_status, root.review_status),
        root.proposals_authoritative === false || vocab.proposals_authoritative === false
          ? "Proposals require teacher review"
          : "Loaded",
      ),
      domains: normalizeVocabulary(
        firstDefined(root.domains, root.primary_domains, vocab.primary_domains),
      ),
      questionTypes: normalizeVocabulary(
        firstDefined(root.question_types, vocab.question_types),
      ),
      skills,
      representations: normalizeVocabulary(
        firstDefined(root.representations, root.representation_tags, vocab.representation_tags),
      ),
      cognitiveDemands: normalizeVocabulary(
        firstDefined(
          root.cognitive_demands,
          root.cognitive_demand_tags,
          vocab.cognitive_demand_tags,
        ),
      ),
    };
  }

  function populateSelect(id, entries, placeholder) {
    const select = byId(id);
    const current = select.value;
    const first = node("option", { text: placeholder, attrs: { value: "" } });
    select.replaceChildren(first);
    entries.forEach((entry) => {
      select.append(node("option", { text: entry.label, attrs: { value: entry.id } }));
    });
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function populateTagOptions(id, entries, name) {
    const container = byId(id);
    container.replaceChildren();
    if (!entries.length) {
      container.append(node("p", { className: "fieldset-help", text: "No vocabulary entries supplied." }));
      return;
    }
    entries.forEach((entry) => {
      const label = node("label", { className: "tag-option" });
      const input = node("input", { attrs: { type: "checkbox", name, value: entry.id } });
      const copy = node("span");
      copy.append(
        node("strong", { text: entry.label }),
        node("small", { text: entry.description || [entry.facet, entry.status].filter(Boolean).join(" · ") }),
      );
      label.append(input, copy);
      container.append(label);
    });
  }

  function renderTaxonomyCards(containerId, entries) {
    const container = byId(containerId);
    container.replaceChildren();
    entries.forEach((entry) => {
      const card = node("article", { className: "taxonomy-card" });
      card.dataset.search = [entry.id, entry.label, entry.description, entry.status, entry.facet]
        .join(" ")
        .toLocaleLowerCase();
      card.append(node("strong", { text: entry.label }), node("code", { text: entry.id }));
      if (entry.description) card.append(node("p", { text: entry.description }));
      const metadata = node("div", { className: "taxonomy-meta" });
      [entry.facet, entry.status, entry.gradeRange].filter(Boolean).forEach((value) => {
        metadata.append(node("span", { text: humanize(value) }));
      });
      if (metadata.childElementCount) card.append(metadata);
      container.append(card);
    });
  }

  function renderTaxonomy() {
    const taxonomy = state.taxonomy;
    if (!taxonomy) return;
    setText("taxonomy-version", taxonomy.version);
    setText("taxonomy-status", taxonomy.status);
    setText("domain-count", formatNumber(taxonomy.domains.length));
    setText("question-type-count", formatNumber(taxonomy.questionTypes.length));
    setText("skill-count", formatNumber(taxonomy.skills.length));
    setText("representation-count", formatNumber(taxonomy.representations.length));
    renderTaxonomyCards("taxonomy-domains", taxonomy.domains);
    renderTaxonomyCards("taxonomy-question-types", taxonomy.questionTypes);
    renderTaxonomyCards("taxonomy-skills", taxonomy.skills);
    renderTaxonomyCards("taxonomy-representations", taxonomy.representations);
    populateSelect("filter-primary-domain", taxonomy.domains, "All domains");
    populateSelect("filter-question-type", taxonomy.questionTypes, "All question types");
    populateSelect("review-primary-domain", taxonomy.domains, "Choose a domain");
    populateSelect("review-question-type", taxonomy.questionTypes, "Choose a question type");
    populateSelect("review-cognitive-demand", taxonomy.cognitiveDemands, "Choose a demand level");
    populateSelect("recommendation-skill", taxonomy.skills, "Choose a reviewed or proposed skill");
    populateSelect("taxonomy-skill-select", taxonomy.skills, "Choose a skill");
    populateSelect("skill-merge-target", taxonomy.skills, "Choose only for a merge judgment");
    populateTagOptions("skill-options", taxonomy.skills, "skill_ids");
    populateTagOptions("representation-options", taxonomy.representations, "representation_ids");
    syncControlsFromState();
    byId("taxonomy-loading").hidden = true;
    byId("taxonomy-content").hidden = false;
    filterTaxonomy();
    renderSkillInspector(state.selectedSkillId);
    if (state.items.detail) populateReviewForm(state.items.detail.review);
  }

  function filterTaxonomy() {
    const query = byId("taxonomy-search").value.trim().toLocaleLowerCase();
    let visible = 0;
    document.querySelectorAll(".taxonomy-card").forEach((card) => {
      card.hidden = Boolean(query) && !card.dataset.search.includes(query);
      if (!card.hidden) visible += 1;
    });
    byId("taxonomy-empty").hidden = visible !== 0;
  }

  function skillExampleId(value) {
    if (typeof value === "string" || typeof value === "number") return String(value);
    return itemId(asRecord(value));
  }

  function skillRelationText(value) {
    if (typeof value === "string") return value;
    const relation = asRecord(value);
    const kind = stringValue(firstDefined(relation.relation, relation.type, relation.kind));
    const source = stringValue(
      firstDefined(relation.from_skill_id, relation.source_skill_id, relation.from),
    );
    const target = stringValue(
      firstDefined(
        relation.to_skill_id,
        relation.target_skill_id,
        relation.target,
        relation.to,
        relation.skill_id,
      ),
    );
    const note = stringValue(firstDefined(relation.note, relation.description, relation.rationale));
    const direction = source || target ? `${source || "?"} → ${target || "?"}` : "";
    const status = stringValue(relation.status);
    return [kind && humanize(kind), direction, status && humanize(status), note]
      .filter(Boolean)
      .join(" · ") || "Unspecified relation";
  }

  function normalizedSkillReview(value) {
    const review = asRecord(value);
    return {
      judgement: stringValue(
        firstDefined(review.judgement, review.judgment, review.decision),
        "unsure",
      ),
      proposedName: stringValue(firstDefined(review.proposed_name, review.revised_name)),
      proposedDescription: stringValue(
        firstDefined(review.proposed_description, review.revised_description, review.boundary_note),
      ),
      mergeTarget: stringValue(
        firstDefined(review.merge_target_skill_id, review.merge_target),
      ),
      notes: stringValue(review.notes),
      updatedAt: stringValue(firstDefined(review.updated_at, review.reviewed_at)),
      etag: stringValue(review.etag),
    };
  }

  function renderSkillInspector(skillId) {
    state.selectedSkillId = skillId;
    const skill = state.taxonomy?.skills.find((entry) => entry.id === skillId);
    byId("skill-inspector-empty").hidden = Boolean(skill);
    byId("skill-inspector-detail").hidden = !skill;
    if (!skill) {
      setText("skill-review-saved-state", "No skill selected");
      return;
    }
    const review = normalizedSkillReview(skill.review);
    setText("selected-skill-heading", skill.label);
    renderDefinitionList("selected-skill-details", [
      ["Stable ID", skill.id],
      ["Name", skill.label],
      ["Facet", skill.facet ? humanize(skill.facet) : "Not reported"],
      ["Description", skill.description || "Not reported"],
      ["Grade range", skill.gradeRange ? humanize(skill.gradeRange) : "Not specified"],
      ["Status", skill.status ? humanize(skill.status) : "Not reported"],
    ]);
    setText(
      "selected-skill-boundary",
      skill.boundaryNote || "No explicit boundary note is recorded. Treat that absence as an ontology QA question.",
    );
    setText("selected-skill-coverage", `${formatNumber(skill.coverageCount)} proposals`);
    const examples = byId("selected-skill-examples");
    examples.replaceChildren();
    const exampleIds = skill.examples.map(skillExampleId).filter(Boolean);
    if (!exampleIds.length) {
      examples.append(node("li", { text: "No example item references returned." }));
    } else {
      exampleIds.forEach((id) => {
        const item = node("li");
        item.append(
          node("button", {
            className: "skill-example-button",
            text: id,
            attrs: { type: "button", "data-item-id": id },
          }),
        );
        examples.append(item);
      });
    }
    const relations = byId("selected-skill-relations");
    relations.replaceChildren();
    const relationText = skill.relations.map(skillRelationText).filter(Boolean);
    (relationText.length ? relationText : ["No proposed relations returned."]).forEach((value) => {
      relations.append(node("li", { text: value }));
    });
    selectRadio("skill_judgement", review.judgement, "unsure");
    byId("skill-proposed-name").value = review.proposedName;
    byId("skill-proposed-description").value = review.proposedDescription;
    setSelectValue("skill-merge-target", review.mergeTarget);
    byId("skill-review-notes").value = review.notes;
    const savedState = byId("skill-review-saved-state");
    savedState.textContent = review.updatedAt
      ? `Saved · ${new Date(review.updatedAt).toLocaleString()}`
      : review.judgement !== "unsure"
        ? `Saved · ${humanize(review.judgement)}`
        : "Not yet adjudicated";
    savedState.classList.toggle(
      "is-saved",
      Boolean(review.updatedAt) || review.judgement !== "unsure",
    );
    setInlineError("skill-review-error");
  }

  function skillReviewBody() {
    return {
      judgement: radioValue("skill_judgement"),
      proposed_name: byId("skill-proposed-name").value.trim(),
      proposed_description: byId("skill-proposed-description").value.trim(),
      merge_target_skill_id: byId("skill-merge-target").value,
      notes: byId("skill-review-notes").value.trim(),
    };
  }

  function validateSkillReview(body) {
    if (!body.judgement) return "Choose an ontology judgment.";
    if (body.judgement === "merge" && !body.merge_target_skill_id) {
      return "A merge judgment requires a target skill.";
    }
    if (body.judgement === "merge" && body.merge_target_skill_id === state.selectedSkillId) {
      return "A skill cannot be merged into itself.";
    }
    if (body.judgement === "revise" && !body.proposed_name && !body.proposed_description) {
      return "A revise judgment needs a proposed name, description, or boundary.";
    }
    if ((body.judgement === "split" || body.judgement === "remove") && !body.notes) {
      return `${humanize(body.judgement)} judgments require a concise rationale in the notes.`;
    }
    return "";
  }

  async function saveSkillReview() {
    const skill = state.taxonomy?.skills.find((entry) => entry.id === state.selectedSkillId);
    if (!skill || state.skillReviewSaving) return;
    const body = skillReviewBody();
    const validationError = validateSkillReview(body);
    if (validationError) {
      setInlineError("skill-review-error", validationError);
      return;
    }
    setInlineError("skill-review-error");
    state.skillReviewSaving = true;
    byId("save-skill-review").disabled = true;
    setText("skill-review-saved-state", "Saving…");
    const review = normalizedSkillReview(skill.review);
    try {
      const { payload, response } = await requestJson(
        `${API.taxonomy}/skills/${encodeURIComponent(skill.id)}/review`,
        {
          method: "PUT",
          headers: { "If-Match": skill.etag || review.etag || "*" },
          body: JSON.stringify(body),
        },
      );
      const returned = asRecord(payload);
      skill.review = asRecord(firstDefined(returned.review, returned.judgement, returned));
      skill.etag = response.headers.get("ETag") || stringValue(firstDefined(returned.etag, asRecord(skill.review).etag));
      renderSkillInspector(skill.id);
      announce(`Scoped ontology judgment saved for ${skill.label}.`);
    } catch (error) {
      setInlineError(
        "skill-review-error",
        error.status === 412
          ? "This skill changed after you opened it. Reload the taxonomy before saving."
          : `Skill judgment not saved: ${error.message}`,
      );
      setText("skill-review-saved-state", "Not saved");
    } finally {
      state.skillReviewSaving = false;
      byId("save-skill-review").disabled = false;
    }
  }

  async function loadTaxonomy() {
    byId("taxonomy-loading").hidden = false;
    try {
      const { payload } = await requestJson(API.taxonomy);
      state.taxonomy = normalizeTaxonomy(payload);
      renderTaxonomy();
      clearGlobalError();
    } catch (error) {
      byId("taxonomy-loading").hidden = true;
      showGlobalError("The curriculum taxonomy could not be loaded.", error, () => loadTaxonomy());
    }
  }

  function readFilters() {
    FILTER_KEYS.forEach((key) => {
      const control = document.querySelector(`#catalogue-filters [name="${key}"]`);
      state.filters[key] = control ? control.value.trim() : "";
    });
    state.items.limit = integer(byId("filter-limit").value, 25);
    state.items.offset = 0;
    state.items.detailId = "";
    state.items.detail = null;
    updateUrl();
  }

  function itemId(record) {
    return stringValue(firstDefined(record.item_id, record.id, record.stable_id, record.question_id));
  }

  function sourceRecord(value) {
    if (typeof value === "string") return { label: value };
    return asRecord(value);
  }

  function sourceLabel(value) {
    const source = sourceRecord(value);
    const suppliedLabel = stringValue(
      firstDefined(source.label, source.name, source.source_name),
    );
    if (suppliedLabel) return suppliedLabel;
    const pieces = [
      firstDefined(source.contest, source.source_family),
      source.year,
      firstDefined(source.grade, source.grade_band),
      firstDefined(source.question_number, source.problem_number),
    ]
      .map((piece) => stringValue(piece))
      .filter(Boolean);
    return pieces.join(" · ") || "Source not reported";
  }

  function normalizeItemSummary(value) {
    const record = asRecord(value);
    const source = sourceRecord(record.source);
    const promotion = asRecord(record.promotion);
    const blockers = asArray(firstDefined(record.blockers, promotion.blockers));
    return {
      id: itemId(record),
      title: stringValue(
        firstDefined(record.title, record.prompt_excerpt, record.prompt, record.question_label),
        itemId(record) || "Question",
      ),
      source: sourceLabel(Object.keys(source).length ? source : record.source_label),
      grade: stringValue(firstDefined(record.grade, record.grade_band, source.grade, source.grade_band)),
      points: stringValue(firstDefined(record.points, source.points)),
      reviewState: stringValue(firstDefined(record.review_state, asRecord(record.review).state), "unreviewed"),
      promotionState: stringValue(
        firstDefined(record.promotion_state, promotion.state, promotion.status),
        "blocked",
      ),
      blockerCount: integer(firstDefined(record.blocker_count, blockers.length)),
    };
  }

  function normalizeItemsPayload(payload) {
    const root = Array.isArray(payload) ? { items: payload } : asRecord(payload);
    const rows = asArray(firstDefined(root.items, root.results, root.questions, root.rows))
      .map(normalizeItemSummary)
      .filter((item) => item.id);
    return {
      rows,
      total: integer(firstDefined(root.total, root.total_items, root.count), rows.length),
      offset: integer(firstDefined(root.offset, root.start), state.items.offset),
      limit: integer(firstDefined(root.limit, root.page_size), state.items.limit),
    };
  }

  function itemsUrl() {
    const url = new URL(API.items, window.location.origin);
    url.searchParams.set("offset", String(state.items.offset));
    url.searchParams.set("limit", String(state.items.limit));
    FILTER_KEYS.forEach((key) => {
      if (state.filters[key]) url.searchParams.set(key, state.filters[key]);
    });
    return url;
  }

  function renderQueue() {
    const queue = byId("question-queue");
    queue.replaceChildren();
    state.items.rows.forEach((item, index) => {
      const entry = node("li");
      const button = node("button", {
        className: "queue-item-button",
        attrs: {
          type: "button",
          "data-item-id": item.id,
          "data-testid": "question-queue-item",
          "aria-current": String(item.id === state.items.detailId),
        },
      });
      const top = node("span", { className: "queue-item-top" });
      top.append(
        node("span", {
          className: "queue-item-title",
          text: item.title.length > 100 ? `${item.title.slice(0, 97)}…` : item.title,
        }),
        node("span", {
          className: `queue-item-status${item.blockerCount ? " has-blockers" : ""}`,
          text: item.blockerCount ? `! ${item.blockerCount}` : "✓ Clear",
        }),
      );
      const bottom = node("span", { className: "queue-item-bottom" });
      bottom.append(
        node("span", { className: "queue-item-source", text: item.source }),
        node("span", { className: "queue-item-status", text: humanize(item.reviewState) }),
      );
      button.append(top, bottom);
      button.addEventListener("click", () => selectItem(item.id, { focus: true }));
      entry.append(button);
      queue.append(entry);
      if (index === 0 && !state.items.detailId) state.items.detailId = item.id;
    });
    setText("queue-page-count", formatNumber(state.items.rows.length));
    const first = state.items.total ? state.items.offset + 1 : 0;
    const last = Math.min(state.items.total, state.items.offset + state.items.rows.length);
    byId("queue-result-summary").replaceChildren(
      node("strong", { text: `${formatNumber(first)}–${formatNumber(last)}` }),
      document.createTextNode(` of ${formatNumber(state.items.total)} questions`),
    );
    const page = state.items.total ? Math.floor(state.items.offset / state.items.limit) + 1 : 0;
    const pageCount = state.items.total ? Math.ceil(state.items.total / state.items.limit) : 0;
    setText("page-label", `Page ${page} of ${pageCount}`);
    byId("page-previous").disabled = state.items.offset <= 0;
    byId("page-next").disabled = state.items.offset + state.items.rows.length >= state.items.total;
    byId("queue-empty").hidden = state.items.rows.length !== 0;
    byId("question-queue").hidden = state.items.rows.length === 0;
    byId("queue-loading").hidden = true;
  }

  async function loadItems({ preferredId = "", focusDetail = false } = {}) {
    const token = ++state.items.requestToken;
    byId("queue-loading").hidden = false;
    byId("queue-empty").hidden = true;
    try {
      const { payload } = await requestJson(itemsUrl());
      if (token !== state.items.requestToken) return;
      const normalized = normalizeItemsPayload(payload);
      state.items.rows = normalized.rows;
      state.items.total = normalized.total;
      state.items.offset = normalized.offset;
      state.items.limit = normalized.limit || state.items.limit;
      state.items.loaded = true;
      const candidate =
        preferredId ||
        (state.items.rows.some((item) => item.id === state.items.detailId)
          ? state.items.detailId
          : state.items.rows[0]?.id || "");
      state.items.detailId = candidate;
      renderQueue();
      updateUrl();
      if (candidate) await loadDetail(candidate, { focus: focusDetail });
      else clearDetail();
      clearGlobalError();
    } catch (error) {
      if (token !== state.items.requestToken) return;
      byId("queue-loading").hidden = true;
      showGlobalError("The question queue could not be loaded.", error, () => loadItems());
    }
  }

  function clearDetail() {
    state.items.detail = null;
    state.items.detailId = "";
    byId("detail-loading").hidden = true;
    byId("question-detail").hidden = true;
    byId("detail-placeholder").hidden = false;
    updateUrl();
  }

  function textList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (typeof entry === "string") return entry;
          const record = asRecord(entry);
          return stringValue(firstDefined(record.message, record.label, record.text, record.code, record.id));
        })
        .filter(Boolean);
    }
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, entry]) =>
        typeof entry === "string" ? `${humanize(key)}: ${entry}` : humanize(key),
      );
    }
    return stringValue(value) ? [stringValue(value)] : [];
  }

  function normalizeChoices(value) {
    if (!Array.isArray(value)) return textList(value);
    return value.map((choice, index) => {
      if (typeof choice === "string" || typeof choice === "number") return String(choice);
      const record = asRecord(choice);
      return stringValue(
        firstDefined(record.text, record.label, record.value, record.choice_text, record.content),
        `Choice ${index + 1}`,
      );
    });
  }

  function normalizeRenderableChoices(value) {
    if (!Array.isArray(value)) {
      return textList(value).map((text) => ({ text, imageUrl: "", imageAlt: "" }));
    }
    return value.map((choice, index) => {
      if (typeof choice === "string" || typeof choice === "number") {
        return { text: String(choice), imageUrl: "", imageAlt: "" };
      }
      const record = asRecord(choice);
      return {
        text: stringValue(
          firstDefined(
            record.text,
            record.value,
            record.choice_text,
            record.content,
            record.label,
          ),
        ),
        imageUrl: safeSameOriginUrl(
          firstDefined(record.image_url, record.imageUrl, record.asset_url, record.assetUrl),
        ),
        imageAlt: stringValue(
          firstDefined(record.image_alt, record.imageAlt, record.alt),
          `Visual content for choice ${String.fromCharCode(65 + index)}`,
        ),
      };
    });
  }

  function normalizeQuestionAssets(value, fallbackUrl = "") {
    const assets = asArray(value).map((entry, index) => {
      const record = asRecord(entry);
      return {
        ordinal: integer(firstDefined(record.ordinal, record.order, index + 1), index + 1),
        url: safeSameOriginUrl(firstDefined(record.url, record.asset_url, record.src)),
        status: stringValue(record.status, "available"),
        mediaType: stringValue(firstDefined(record.media_type, record.mediaType)),
        width: integer(record.width),
        height: integer(record.height),
        alt: stringValue(firstDefined(record.alt, record.alt_text, record.description)),
        caption: stringValue(record.caption),
      };
    });
    if (!assets.length && fallbackUrl) {
      assets.push({
        ordinal: 1,
        url: fallbackUrl,
        status: "available",
        mediaType: "",
        width: 0,
        height: 0,
        alt: "",
        caption: "",
      });
    }
    return assets.sort((left, right) => left.ordinal - right.ordinal);
  }

  function normalizeEnglishHelper(value) {
    const record = asRecord(value);
    if (!Object.keys(record).length) return null;
    return {
      sourceLanguage: stringValue(
        firstDefined(record.source_language, record.sourceLanguage),
      ),
      sourcePrompt: stringValue(firstDefined(record.source_prompt, record.sourcePrompt)),
      sourceChoices: normalizeRenderableChoices(
        firstDefined(record.source_choices, record.sourceChoices),
      ),
      englishPrompt: stringValue(
        firstDefined(record.english_prompt, record.englishPrompt),
      ),
      englishChoices: normalizeRenderableChoices(
        firstDefined(record.english_choices, record.englishChoices),
      ),
      promptStatus: stringValue(
        firstDefined(record.prompt_status, record.promptStatus),
        "unknown",
      ),
      choicesStatus: stringValue(
        firstDefined(record.choices_status, record.choicesStatus),
        "unknown",
      ),
      translationMethod: stringValue(
        firstDefined(record.translation_method, record.translationMethod),
        "unknown",
      ),
      reviewStatus: stringValue(
        firstDefined(record.review_status, record.reviewStatus),
        "unknown",
      ),
    };
  }

  function normalizeReview(value) {
    const review = asRecord(value);
    const sourceChecks = asRecord(firstDefined(review.source_checks, review.sourceChecks));
    return {
      sourceChecks: Object.fromEntries(
        SOURCE_CHECK_KEYS.map((key) => [key, Boolean(sourceChecks[key])]),
      ),
      disposition: stringValue(review.disposition, "needs_correction"),
      primaryDomain: stringValue(firstDefined(review.primary_domain, review.primaryDomain)),
      questionType: stringValue(firstDefined(review.question_type, review.questionType)),
      skillIds: textList(firstDefined(review.skill_ids, review.skills)),
      representationIds: textList(
        firstDefined(review.representation_ids, review.representation_tags, review.representations),
      ),
      cognitiveDemand: stringValue(
        firstDefined(review.cognitive_demand, review.cognitive_demand_tag),
      ),
      gradeAppropriateness: stringValue(
        firstDefined(review.grade_appropriateness, review.grade_fit),
        "uncertain",
      ),
      taxonomyDecision: stringValue(review.taxonomy_decision, "needs_changes"),
      notes: stringValue(review.notes),
      state: stringValue(firstDefined(review.state, review.review_state), "unreviewed"),
      updatedAt: stringValue(firstDefined(review.updated_at, review.reviewed_at)),
      etag: stringValue(review.etag),
    };
  }

  function normalizeDetail(payload, response) {
    const root = asRecord(payload);
    const content = asRecord(firstDefined(root.content, root.item, root.question));
    const merged = { ...content, ...root };
    const source = sourceRecord(firstDefined(merged.source, merged.source_metadata));
    const answer = asRecord(firstDefined(merged.answer_metadata, merged.answer, merged.answer_evidence));
    const proposal = asRecord(
      firstDefined(merged.proposal, merged.classification_proposal, merged.curriculum_proposal),
    );
    const promotion = asRecord(firstDefined(merged.promotion, merged.promotion_state));
    const review = normalizeReview(
      firstDefined(merged.existing_review, merged.current_review, merged.review),
    );
    const directEtag = response?.headers?.get("ETag") || "";
    const cropUrl = safeSameOriginUrl(
      firstDefined(merged.source_crop_url, source.crop_url, source.source_crop_url),
    );
    return {
      id: itemId(merged),
      contentVersion: stringValue(firstDefined(merged.content_version, merged.version)),
      source,
      sourceLine: sourceLabel(Object.keys(source).length ? source : merged.source_label),
      prompt: stringValue(firstDefined(merged.prompt, merged.prompt_text, merged.question_text)),
      choices: normalizeChoices(firstDefined(merged.choices, merged.answer_choices, merged.options)),
      renderableChoices: normalizeRenderableChoices(
        firstDefined(merged.choices, merged.answer_choices, merged.options),
      ),
      englishHelper: normalizeEnglishHelper(
        firstDefined(merged.english_helper, merged.englishHelper),
      ),
      assets: normalizeQuestionAssets(
        firstDefined(merged.assets, merged.question_assets, merged.asset_refs),
        cropUrl,
      ),
      answer,
      warnings: textList(firstDefined(merged.warnings, merged.source_warnings, merged.review_flags)),
      gaps: textList(firstDefined(merged.gaps, merged.content_gaps, merged.missing_content)),
      proposal,
      promotion,
      blockers: textList(firstDefined(merged.blockers, promotion.blockers)),
      review,
      cropUrl,
      pdfUrl: safeSameOriginUrl(
        firstDefined(merged.source_pdf_url, source.pdf_url, source.source_pdf_url),
      ),
      keyUrl: safeSameOriginUrl(
        firstDefined(merged.key_evidence_url, answer.key_evidence_url, source.key_evidence_url),
      ),
      etag: directEtag || review.etag || stringValue(merged.etag) || "*",
    };
  }

  function renderDefinitionList(id, entries) {
    const list = byId(id);
    list.replaceChildren();
    entries.forEach(([label, value]) => {
      const row = node("div");
      row.append(node("dt", { text: label }), node("dd", { text: value || "—" }));
      list.append(row);
    });
  }

  function proposalValue(value) {
    if (Array.isArray(value)) return value.map((entry) => humanize(stringValue(entry))).join(", ");
    if (value && typeof value === "object") {
      return Object.entries(value)
        .map(([key, entry]) => `${humanize(key)}: ${stringValue(entry, JSON.stringify(entry))}`)
        .join("; ");
    }
    return humanize(stringValue(value, "Not proposed"));
  }

  function renderFindings(id, values, emptyText) {
    const list = byId(id);
    list.replaceChildren();
    if (!values.length) {
      list.append(node("li", { className: "is-empty", text: emptyText }));
      return;
    }
    values.forEach((value) => list.append(node("li", { text: value })));
  }

  function setCheckedValues(name, values) {
    const selected = new Set(values);
    document.querySelectorAll(`[name="${name}"]`).forEach((input) => {
      input.checked = selected.has(input.value);
    });
  }

  function selectRadio(name, value, fallback) {
    const radio = document.querySelector(`[name="${name}"][value="${CSS.escape(value)}"]`);
    const target = radio || document.querySelector(`[name="${name}"][value="${fallback}"]`);
    if (target) target.checked = true;
  }

  function setSelectValue(id, value) {
    const select = byId(id);
    if ([...select.options].some((option) => option.value === value)) select.value = value;
    else select.value = "";
  }

  function populateReviewForm(review) {
    if (!review) return;
    SOURCE_CHECK_KEYS.forEach((key) => {
      const input = document.querySelector(`[name="source_${key}"]`);
      if (input) input.checked = Boolean(review.sourceChecks[key]);
    });
    selectRadio("disposition", review.disposition, "needs_correction");
    setSelectValue("review-primary-domain", review.primaryDomain);
    setSelectValue("review-question-type", review.questionType);
    setSelectValue("review-cognitive-demand", review.cognitiveDemand);
    setSelectValue("review-grade-appropriateness", review.gradeAppropriateness);
    setCheckedValues("skill_ids", review.skillIds);
    setCheckedValues("representation_ids", review.representationIds);
    selectRadio("taxonomy_decision", review.taxonomyDecision, "needs_changes");
    byId("review-notes").value = review.notes;
    const saved = review.state !== "unreviewed" || Boolean(review.updatedAt);
    const status = byId("review-saved-state");
    status.textContent = saved
      ? `Saved${review.updatedAt ? ` · ${new Date(review.updatedAt).toLocaleString()}` : ""}`
      : "Not saved";
    status.classList.toggle("is-saved", saved);
    setInlineError("review-form-error");
  }

  function renderDetail(detail, { focus = false } = {}) {
    setText("question-title", detail.prompt ? "Question evidence" : detail.id);
    setText("question-id", detail.id);
    setText("question-source-line", detail.sourceLine);
    const currentIndex = state.items.rows.findIndex((item) => item.id === detail.id);
    setText(
      "detail-position",
      currentIndex >= 0
        ? `Question ${state.items.offset + currentIndex + 1} of ${formatNumber(state.items.total)}`
        : "Question evidence",
    );
    setText("detail-review-state", humanize(detail.review.state));
    byId("detail-review-state").className = `status-badge ${
      detail.review.state === "needs_attention"
        ? "status-attention"
        : detail.review.state !== "unreviewed"
          ? "status-reviewed"
          : ""
    }`;

    const blockersPanel = byId("promotion-blockers-panel");
    const blockerList = byId("promotion-blocker-list");
    blockerList.replaceChildren();
    blockersPanel.classList.toggle("is-clear", detail.blockers.length === 0);
    setText("promotion-blockers-heading", detail.blockers.length ? "Current blockers" : "Current gates are clear");
    blockersPanel.querySelector(".blocker-symbol").textContent = detail.blockers.length ? "!" : "✓";
    (detail.blockers.length ? detail.blockers : ["No current promotion blockers reported."]).forEach((entry) => {
      blockerList.append(node("li", { text: entry }));
    });

    const crop = byId("source-crop");
    const cropMissing = byId("source-crop-missing");
    if (detail.cropUrl) {
      crop.src = detail.cropUrl;
      crop.alt = `Source crop for ${detail.id}; inspect the visual evidence before validating.`;
      crop.hidden = false;
      cropMissing.hidden = true;
    } else {
      crop.removeAttribute("src");
      crop.alt = "";
      crop.hidden = true;
      cropMissing.hidden = false;
    }
    [["source-pdf-link", detail.pdfUrl], ["key-evidence-link", detail.keyUrl]].forEach(
      ([id, url]) => {
        const link = byId(id);
        link.hidden = !url;
        if (url) link.href = url;
        else link.removeAttribute("href");
      },
    );

    setText("question-prompt", detail.prompt || "No parsed prompt is available.");
    const choices = byId("question-choices");
    choices.replaceChildren();
    (detail.choices.length ? detail.choices : ["No structured choices are available."]).forEach((choice) => {
      choices.append(node("li", { text: choice }));
    });
    const source = detail.source;
    const metadata = byId("question-metadata-tags");
    metadata.replaceChildren();
    [
      firstDefined(source.grade, source.grade_band),
      firstDefined(source.points, source.published_point_tier, asRecord(detail.answer).points),
      firstDefined(source.year, source.contest_year),
      firstDefined(source.modality, source.question_modality),
    ]
      .map((value) => stringValue(value))
      .filter(Boolean)
      .forEach((value) => metadata.append(node("span", { text: humanize(value) })));

    const answer = detail.answer;
    renderDefinitionList("answer-evidence-details", [
      ["Status", humanize(firstDefined(answer.answer_status, answer.status, "Unknown"))],
      ["Official answer", stringValue(firstDefined(answer.official_answer, answer.answer, answer.value), "Not reported")],
      ["Key source", stringValue(firstDefined(answer.answer_source_label, answer.source_label, answer.key_source, answer.provenance), "Not reported")],
    ]);
    renderFindings("question-warnings", detail.warnings, "No source warnings reported.");
    renderFindings("question-gaps", detail.gaps, "No content gaps reported.");

    const proposal = detail.proposal;
    setText(
      "proposal-provenance",
      stringValue(firstDefined(proposal.status, proposal.provenance), "Proposal"),
    );
    renderDefinitionList("proposal-details", [
      ["Primary domain", proposalValue(firstDefined(proposal.primary_domain, proposal.domain))],
      ["Question type", proposalValue(proposal.question_type)],
      ["Skills", proposalValue(firstDefined(proposal.skill_ids, proposal.skills))],
      ["Representations", proposalValue(firstDefined(proposal.representation_ids, proposal.representation_tags))],
      ["Cognitive demand", proposalValue(firstDefined(proposal.cognitive_demand, proposal.cognitive_demand_tag))],
      ["Confidence", proposal.confidence === undefined ? "Not reported" : `${Math.round(finiteNumber(proposal.confidence) * 100)}%`],
    ]);
    populateReviewForm(detail.review);
    byId("detail-placeholder").hidden = true;
    byId("detail-loading").hidden = true;
    byId("question-detail").hidden = false;
    renderQueue();
    if (focus) byId("question-title").focus();
  }

  async function loadDetail(id, { focus = false } = {}) {
    if (!id) return;
    state.items.detailId = id;
    byId("detail-placeholder").hidden = true;
    byId("question-detail").hidden = true;
    byId("detail-loading").hidden = false;
    updateUrl();
    renderQueue();
    try {
      const { payload, response } = await requestJson(`${API.items}/${encodeURIComponent(id)}`);
      if (state.items.detailId !== id) return;
      const detail = normalizeDetail(payload, response);
      if (!detail.id) detail.id = id;
      state.items.detail = detail;
      state.items.etag = detail.etag;
      renderDetail(detail, { focus });
      clearGlobalError();
    } catch (error) {
      if (state.items.detailId !== id) return;
      byId("detail-loading").hidden = true;
      byId("detail-placeholder").hidden = false;
      showGlobalError("This question record could not be loaded.", error, () => loadDetail(id));
    }
  }

  function selectItem(id, options = {}) {
    if (!id || state.items.saving) return;
    loadDetail(id, options);
  }

  function checkedValues(name) {
    return [...document.querySelectorAll(`[name="${name}"]:checked`)].map((input) => input.value);
  }

  function radioValue(name) {
    return document.querySelector(`[name="${name}"]:checked`)?.value || "";
  }

  function reviewBody() {
    return {
      source_checks: Object.fromEntries(
        SOURCE_CHECK_KEYS.map((key) => [
          key,
          Boolean(document.querySelector(`[name="source_${key}"]`)?.checked),
        ]),
      ),
      disposition: radioValue("disposition"),
      primary_domain: byId("review-primary-domain").value,
      question_type: byId("review-question-type").value,
      skill_ids: checkedValues("skill_ids"),
      representation_ids: checkedValues("representation_ids"),
      cognitive_demand: byId("review-cognitive-demand").value,
      grade_appropriateness: byId("review-grade-appropriateness").value,
      taxonomy_decision: radioValue("taxonomy_decision"),
      notes: byId("review-notes").value.trim(),
    };
  }

  function validateReview(review) {
    if (review.disposition === "faithful") {
      const missing = SOURCE_CHECK_KEYS.filter((key) => !review.source_checks[key]);
      if (missing.length) {
        return `A faithful source decision requires every source check. Still clear: ${missing
          .map(humanize)
          .join(", ")}.`;
      }
    }
    if (review.taxonomy_decision === "validated" && review.disposition !== "exclude") {
      if (!review.primary_domain || !review.question_type || !review.cognitive_demand) {
        return "A validated taxonomy decision requires a domain, question type, and cognitive demand.";
      }
      if (!review.skill_ids.length) return "Select at least one required skill before validating taxonomy.";
    }
    return "";
  }

  function setReviewSaving(saving) {
    state.items.saving = saving;
    byId("save-review").disabled = saving;
    byId("save-next-review").disabled = saving;
    if (saving) setText("review-saved-state", "Saving…");
  }

  async function saveReview(advance) {
    const detail = state.items.detail;
    if (!detail || state.items.saving) return;
    const review = reviewBody();
    const validationError = validateReview(review);
    if (validationError) {
      setInlineError("review-form-error", validationError);
      byId("review-form-error").focus?.();
      return;
    }
    setInlineError("review-form-error");
    const currentIndex = state.items.rows.findIndex((item) => item.id === detail.id);
    const nextId = currentIndex >= 0 ? state.items.rows[currentIndex + 1]?.id || "" : "";
    const hasNextPage = state.items.offset + state.items.rows.length < state.items.total;
    setReviewSaving(true);
    try {
      const { payload, response } = await requestJson(
        `${API.items}/${encodeURIComponent(detail.id)}/review`,
        {
          method: "PUT",
          headers: { "If-Match": state.items.etag || "*" },
          body: JSON.stringify(review),
        },
      );
      const returned = asRecord(payload);
      detail.review = normalizeReview(firstDefined(returned.review, returned.current_review, returned));
      state.items.etag = response.headers.get("ETag") || detail.review.etag || state.items.etag;
      const savedState = byId("review-saved-state");
      savedState.textContent = "Saved";
      savedState.classList.add("is-saved");
      announce(`Review saved for ${detail.id}.`);
      await loadSummary({ silent: true });
      if (advance && nextId) {
        await loadItems({ preferredId: nextId, focusDetail: true });
      } else if (advance && hasNextPage) {
        state.items.offset += state.items.limit;
        await loadItems({ focusDetail: true });
      } else {
        await loadItems({ preferredId: detail.id });
      }
    } catch (error) {
      if (error.status === 412) {
        setInlineError(
          "review-form-error",
          "This question changed after you opened it. Reload the current record before saving your judgment.",
        );
      } else {
        setInlineError("review-form-error", `Review not saved: ${error.message}`);
      }
      announce("Review was not saved.");
    } finally {
      setReviewSaving(false);
    }
  }

  function normalizeTagList(value) {
    if (!Array.isArray(value)) return textList(value);
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const record = asRecord(entry);
        return stringValue(
          firstDefined(record.label, record.name, record.id, record.value, record.tag_id, record.tag),
        );
      })
      .filter(Boolean);
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeMapCluster(value, fallbackId = "") {
    const positional = Array.isArray(value) ? value : [];
    const record = asRecord(value);
    const id = stringValue(firstDefined(record.id, record.cluster_id, positional[0], fallbackId));
    const dominantTags = asArray(
      firstDefined(record.dominant_tags, record.tags, record.evidence),
    )
      .map((entry) => {
        if (typeof entry === "string") {
          return { tag: entry, memberCount: 0, coverage: null };
        }
        const tagRecord = asRecord(entry);
        return {
          tag: stringValue(
            firstDefined(tagRecord.tag, tagRecord.label, tagRecord.id, tagRecord.name),
          ),
          memberCount: integer(
            firstDefined(tagRecord.member_count, tagRecord.count, tagRecord.items),
          ),
          coverage: optionalNumber(
            firstDefined(tagRecord.coverage, tagRecord.share, tagRecord.proportion),
          ),
        };
      })
      .filter((entry) => entry.tag);
    return {
      id,
      label: stringValue(
        firstDefined(record.label, record.name, record.cluster_label, positional[1], id),
      ),
      x: optionalNumber(firstDefined(record.x, record.map_x, positional[2])),
      y: optionalNumber(firstDefined(record.y, record.map_y, positional[3])),
      count: integer(
        firstDefined(record.count, record.item_count, record.member_count, positional[4]),
      ),
      dominantTags,
      evidence: textList(firstDefined(record.evidence, record.reasons)),
    };
  }

  function normalizeMapPoint(value, index, clusterById) {
    const positional = Array.isArray(value) ? value : [];
    const record = asRecord(value);
    const coordinates = firstDefined(
      record.position,
      record.coordinates,
      record.point,
      record.projection,
    );
    const coordinateList = Array.isArray(coordinates) ? coordinates : [];
    const coordinateRecord = asRecord(coordinates);
    const id = stringValue(
      firstDefined(record.item_id, record.id, record.stable_id, positional[0]),
    );
    const x = optionalNumber(
      firstDefined(record.x, record.map_x, coordinateRecord.x, coordinateList[0], positional[1]),
    );
    const y = optionalNumber(
      firstDefined(record.y, record.map_y, coordinateRecord.y, coordinateList[1], positional[2]),
    );
    const grade = gradeRangeValue(
      firstDefined(record.grade_band, record.grade, positional[3]),
    );
    const domain = stringValue(
      firstDefined(record.primary_domain, record.domain, positional[4]),
    );
    const questionType = stringValue(
      firstDefined(record.question_type, record.type, positional[5]),
    );
    const clusterId = stringValue(
      firstDefined(record.cluster_id, asRecord(record.cluster).id, positional[6], domain),
    );
    const cluster = clusterById.get(clusterId);
    return {
      id,
      x,
      y,
      grade,
      domain,
      questionType,
      pointTier: pointTierValue(
        firstDefined(
          record.published_point_tier,
          record.point_tier,
          record.points,
          positional[7],
        ),
      ),
      clusterId,
      clusterLabel: stringValue(
        firstDefined(
          record.cluster_label,
          asRecord(record.cluster).label,
          cluster?.label,
          domain,
          clusterId,
        ),
      ),
      prompt: stringValue(
        firstDefined(record.prompt_excerpt, record.prompt, record.question_text),
      ),
      tags: normalizeTagList(
        firstDefined(record.proposed_tags, record.tags, record.skill_ids),
      ),
      reviewState: stringValue(
        firstDefined(record.review_state, record.teacher_review_state, record.disposition),
      ),
      proposalState: stringValue(
        firstDefined(
          record.proposal_state,
          record.classification_source,
          record.classification_status,
        ),
      ),
      source: sourceLabel(firstDefined(record.source, record.source_label)),
      order: index,
    };
  }

  function normalizeProblemMapPayload(payload) {
    const root = asRecord(payload);
    const rawClusters = firstDefined(root.clusters, root.cluster_labels, root.cluster_evidence, []);
    const clusterEntries = Array.isArray(rawClusters)
      ? rawClusters.map((value) => ["", value])
      : Object.entries(asRecord(rawClusters));
    const clusters = clusterEntries
      .map(([id, value]) => normalizeMapCluster(value, id))
      .filter((cluster) => cluster.id || cluster.label);
    const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
    const rawPoints = Array.isArray(payload)
      ? payload
      : asArray(firstDefined(root.points, root.nodes, root.items, root.results, root.data));
    const points = rawPoints
      .map((value, index) => normalizeMapPoint(value, index, clusterById))
      .filter((point) => point.id && point.x !== null && point.y !== null);
    const projection = asRecord(root.projection);
    const projectionQuality = asRecord(
      firstDefined(projection.quality, root.projection_quality),
    );
    const projectionParameters = asRecord(projection.parameters);
    const rawKnnOverlap = optionalNumber(
      firstDefined(
        projectionQuality.knn_overlap,
        projectionQuality.neighborhood_retention,
      ),
    );
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minimumX = xs.length ? Math.min(...xs) : -1;
    const maximumX = xs.length ? Math.max(...xs) : 1;
    const minimumY = ys.length ? Math.min(...ys) : -1;
    const maximumY = ys.length ? Math.max(...ys) : 1;
    return {
      view: stringValue(root.view, state.problemSpace.view),
      mapVersion: stringValue(
        firstDefined(root.map_version, root.projection_version, projection.version),
      ),
      projectionMethod: stringValue(
        firstDefined(
          root.projection_method,
          root.method,
          projection.method,
          projection.algorithm,
        ),
      ),
      projectionParameters: {
        implementation: stringValue(projectionParameters.implementation),
        implementationVersion: stringValue(
          projectionParameters.implementation_version,
        ),
        inputMode: stringValue(projectionParameters.input_mode),
        configuredNeighbors: optionalNumber(
          projectionParameters.configured_neighbors,
        ),
        effectiveNeighbors: optionalNumber(
          projectionParameters.effective_neighbors,
        ),
        minDist: optionalNumber(projectionParameters.min_dist),
        randomSeed: optionalNumber(projectionParameters.random_seed),
        jobs: optionalNumber(projectionParameters.jobs),
      },
      projectionQuality: {
        neighborK: integer(
          firstDefined(projectionQuality.neighbor_k, projectionQuality.k),
        ),
        sampleSize: integer(
          firstDefined(projectionQuality.sample_size, projectionQuality.sample_count),
        ),
        candidateCount: integer(projectionQuality.candidate_count),
        exactDuplicateGroupCount: integer(
          projectionQuality.exact_duplicate_group_count,
        ),
        exactDuplicateCandidateCount: integer(
          projectionQuality.exact_duplicate_candidate_count,
        ),
        tieAtCutoffAnchorCount: integer(
          projectionQuality.tie_at_cutoff_anchor_count,
        ),
        tieAtCutoffAnchorFraction: optionalNumber(
          projectionQuality.tie_at_cutoff_anchor_fraction,
        ),
        meanCutoffTieCandidateCount: optionalNumber(
          projectionQuality.mean_cutoff_tie_candidate_count,
        ),
        knnOverlap: rawKnnOverlap === null ? null : score01(rawKnnOverlap),
        pcaKnnOverlap: optionalNumber(projectionQuality.pca_knn_overlap),
        knnOverlapImprovement: optionalNumber(
          projectionQuality.knn_overlap_improvement,
        ),
        sourceMetric: stringValue(
          firstDefined(projectionQuality.source_metric, projection.source_metric),
        ),
        qualityCaveat: stringValue(projectionQuality.quality_caveat),
      },
      sourceMetric: stringValue(projection.source_metric),
      configuredWeights: asRecord(projection.configured_weights),
      configuredWeightScope: stringValue(projection.configured_weight_scope),
      missingFacetPolicy: stringValue(projection.missing_facet_policy),
      warnings: textList(firstDefined(root.warnings, projection.warnings)),
      points,
      totalItems: integer(
        firstDefined(root.total_items, root.total, root.corpus_total),
        rawPoints.length,
      ),
      unmappedCount: Math.max(
        0,
        integer(firstDefined(root.total_items, root.total, root.corpus_total), rawPoints.length) -
          points.length,
      ),
      clusters,
      bounds: {
        minimumX,
        maximumX: maximumX === minimumX ? minimumX + 1 : maximumX,
        minimumY,
        maximumY: maximumY === minimumY ? minimumY + 1 : maximumY,
      },
    };
  }

  function replaceProblemFilterOptions(
    id,
    values,
    firstLabel,
    selectedValue,
    formatValue = humanize,
  ) {
    const select = byId(id);
    const options = [node("option", { text: firstLabel, attrs: { value: "" } })];
    [...new Set(values.filter(Boolean))]
      .sort((left, right) => humanize(left).localeCompare(humanize(right)))
      .forEach((value) => {
        options.push(node("option", { text: formatValue(value), attrs: { value } }));
      });
    select.replaceChildren(...options);
    select.value = options.some((option) => option.value === selectedValue) ? selectedValue : "";
  }

  function populateProblemMapFilters() {
    const points = state.problemSpace.mapPayload?.points || [];
    replaceProblemFilterOptions(
      "problem-map-grade",
      points.map((point) => point.grade),
      "All grades",
      state.problemSpace.filters.grade,
    );
    replaceProblemFilterOptions(
      "problem-map-points",
      points.map((point) => point.pointTier).filter(Boolean),
      "All point tiers",
      state.problemSpace.filters.points,
      (value) => `${value} points`,
    );
    replaceProblemFilterOptions(
      "problem-map-domain",
      points.map((point) => point.domain),
      "All domains",
      state.problemSpace.filters.domain,
    );
    replaceProblemFilterOptions(
      "problem-map-type",
      points.map((point) => point.questionType),
      "All question types",
      state.problemSpace.filters.questionType,
    );
    state.problemSpace.filters.grade = byId("problem-map-grade").value;
    state.problemSpace.filters.points = byId("problem-map-points").value;
    state.problemSpace.filters.domain = byId("problem-map-domain").value;
    state.problemSpace.filters.questionType = byId("problem-map-type").value;
  }

  function applyProblemMapFilters({ announceChange = false, refit = true } = {}) {
    const payload = state.problemSpace.mapPayload;
    if (!payload) return;
    hideProblemMapCandidates();
    const filters = state.problemSpace.filters;
    state.problemSpace.visiblePoints = payload.points.filter(
      (point) =>
        (!filters.grade || point.grade === filters.grade) &&
        (!filters.points || String(point.pointTier) === filters.points) &&
        (!filters.domain || point.domain === filters.domain) &&
        (!filters.questionType || point.questionType === filters.questionType),
    );
    const visibleIds = new Set(state.problemSpace.visiblePoints.map((point) => point.id));
    if (!visibleIds.has(state.problemSpace.focusedPointId)) {
      state.problemSpace.focusedPointId = visibleIds.has(state.problemSpace.anchorId)
        ? state.problemSpace.anchorId
        : state.problemSpace.visiblePoints[0]?.id || "";
    }
    const clusters = visibleProblemClusters();
    if (!clusters.some((cluster) => cluster.id === state.problemSpace.focusedClusterId)) {
      state.problemSpace.focusedClusterId = clusters[0]?.id || "";
    }
    setText(
      "problem-map-count",
      `${formatNumber(state.problemSpace.visiblePoints.length)} visible · ${formatNumber(payload.points.length)} mapped of ${formatNumber(payload.totalItems)} items`,
    );
    updateProblemMapCenterControl();
    renderProblemClusterKey();
    if (refit) fitProblemMapToVisible();
    else {
      updateProblemMapMode();
      drawProblemMap();
    }
    if (announceChange) {
      announce(`${formatNumber(state.problemSpace.visiblePoints.length)} questions visible on the corpus map.`);
    }
  }

  function mapGradeStyle(grade) {
    const normalized = stringValue(grade).toLocaleLowerCase();
    if (normalized.includes("1") && normalized.includes("2")) {
      return { color: "#c9574b", shape: "circle", label: "Grades 1–2" };
    }
    if (normalized.includes("3") && normalized.includes("4")) {
      return { color: "#16836b", shape: "square", label: "Grades 3–4" };
    }
    if (normalized.includes("5") && normalized.includes("6")) {
      return { color: "#6655c7", shape: "triangle", label: "Grades 5–6" };
    }
    return { color: "#a16d00", shape: "diamond", label: "Unknown grade" };
  }

  function problemMapSize() {
    const canvas = byId("problem-map-canvas");
    return {
      width: Math.max(300, canvas.clientWidth || 900),
      height: Math.max(360, canvas.clientHeight || 620),
    };
  }

  function problemMapBasePoint(point, width, height) {
    const bounds = state.problemSpace.mapPayload?.bounds;
    if (!bounds || point.x === null || point.y === null) return { x: 0, y: 0 };
    const margin = Math.min(52, Math.max(28, Math.min(width, height) * 0.06));
    const extentX = Math.max(0, bounds.maximumX - bounds.minimumX);
    const extentY = Math.max(0, bounds.maximumY - bounds.minimumY);
    const availableWidth = Math.max(1, width - margin * 2);
    const availableHeight = Math.max(1, height - margin * 2);
    const fitScale = Math.min(
      extentX > 0 ? availableWidth / extentX : Number.POSITIVE_INFINITY,
      extentY > 0 ? availableHeight / extentY : Number.POSITIVE_INFINITY,
    );
    const uniformScale = Number.isFinite(fitScale) ? fitScale : 1;
    const centerX = (bounds.minimumX + bounds.maximumX) / 2;
    const centerY = (bounds.minimumY + bounds.maximumY) / 2;
    const baseX = width / 2 + (point.x - centerX) * uniformScale;
    const baseY = height / 2 - (point.y - centerY) * uniformScale;
    return { x: baseX, y: baseY };
  }

  function problemMapScreenPoint(point, width, height) {
    const base = problemMapBasePoint(point, width, height);
    return {
      x:
        width / 2 +
        (base.x - width / 2) * state.problemSpace.scale +
        state.problemSpace.panX,
      y:
        height / 2 +
        (base.y - height / 2) * state.problemSpace.scale +
        state.problemSpace.panY,
    };
  }

  function drawProblemMapShape(context, point, x, y, size, emphasized = false) {
    const style = mapGradeStyle(point.grade);
    context.beginPath();
    if (style.shape === "circle") {
      context.arc(x, y, size, 0, Math.PI * 2);
    } else if (style.shape === "square") {
      context.rect(x - size, y - size, size * 2, size * 2);
    } else if (style.shape === "triangle") {
      context.moveTo(x, y - size * 1.2);
      context.lineTo(x + size * 1.1, y + size);
      context.lineTo(x - size * 1.1, y + size);
      context.closePath();
    } else {
      context.moveTo(x, y - size * 1.2);
      context.lineTo(x + size * 1.2, y);
      context.lineTo(x, y + size * 1.2);
      context.lineTo(x - size * 1.2, y);
      context.closePath();
    }
    context.fillStyle = style.color;
    context.fill();
    context.lineWidth = emphasized ? 2.5 : 0.7;
    context.strokeStyle = emphasized ? "#17213d" : "rgba(23, 33, 61, 0.42)";
    context.stroke();
  }

  function visibleProblemClusters() {
    const groups = new Map();
    const clusterEvidence = new Map(
      (state.problemSpace.mapPayload?.clusters || []).map((cluster) => [cluster.id, cluster]),
    );
    state.problemSpace.visiblePoints.forEach((point) => {
      const id = problemPointClusterId(point);
      const evidence = clusterEvidence.get(id);
      const group = groups.get(id) || {
        id,
        label: evidence?.label || point.clusterLabel || point.domain || "Unclustered",
        dominantTags: evidence?.dominantTags || [],
        x: 0,
        y: 0,
        count: 0,
      };
      group.x += point.x;
      group.y += point.y;
      group.count += 1;
      groups.set(id, group);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        x: group.x / group.count,
        y: group.y / group.count,
      }))
      .sort((left, right) => right.count - left.count);
  }

  function problemPointClusterId(point) {
    return point.clusterId || point.domain || "unclustered";
  }

  function problemClusterCode(clusterId) {
    const allIds = [
      ...(state.problemSpace.mapPayload?.clusters || []).map((cluster) => cluster.id),
      ...(state.problemSpace.mapPayload?.points || []).map(problemPointClusterId),
    ].filter(Boolean);
    const uniqueIds = [...new Set(allIds)];
    const index = uniqueIds.indexOf(clusterId);
    return `C${index >= 0 ? index + 1 : uniqueIds.length + 1}`;
  }

  function renderProblemClusterKey() {
    const list = byId("problem-cluster-list");
    if (!list) return;
    list.replaceChildren();
    visibleProblemClusters().forEach((cluster) => {
      const item = node("li");
      const button = node("button", {
        className: "problem-cluster-button",
        attrs: {
          type: "button",
          "data-problem-cluster-id": cluster.id,
          "aria-label": `${problemClusterCode(cluster.id)}, ${humanize(cluster.label)}, ${formatNumber(cluster.count)} visible questions. Zoom to cluster.`,
        },
      });
      const identity = node("span", { className: "problem-cluster-identity" });
      identity.append(
        node("strong", { text: problemClusterCode(cluster.id) }),
        node("span", { text: humanize(cluster.label) }),
        node("small", { text: `${formatNumber(cluster.count)} visible` }),
      );
      const evidence = cluster.dominantTags
        .slice(0, 3)
        .map((entry) => {
          const coverage = entry.coverage === null
            ? ""
            : ` ${Math.round(entry.coverage * 100)}%`;
          return `${humanize(entry.tag)}${coverage}`;
        })
        .join(" · ");
      if (evidence) button.append(node("span", { className: "problem-cluster-evidence", text: evidence }));
      button.append(node("span", { className: "problem-cluster-action", text: "Zoom to cluster →" }));
      item.append(button);
      list.append(item);
    });
  }

  function problemMapShowsQuestions() {
    return state.problemSpace.scale >= MAP_QUESTION_SCALE;
  }

  function updateProblemMapMode() {
    const questionMode = problemMapShowsQuestions();
    setText(
      "problem-map-mode",
      questionMode
        ? "Question detail. Select a visible point to open its semantic neighborhood."
        : "Cluster overview. Select a cluster to zoom into individual questions.",
    );
    const canvas = byId("problem-map-canvas");
    const focus = questionMode
      ? problemMapPointById(state.problemSpace.focusedPointId, { visibleOnly: true })
      : visibleProblemClusters().find(
          (cluster) => cluster.id === state.problemSpace.focusedClusterId,
        );
    if (questionMode && focus) setProblemMapPointDetail(focus.id);
    else if (!questionMode && focus) setProblemMapClusterDetail(focus.id);
    else {
      canvas.setAttribute(
        "aria-label",
        `Corpus map in ${questionMode ? "question detail" : "cluster overview"} mode. Use arrow keys to move, Enter to select, plus or minus to zoom, and zero to fit the visible questions.`,
      );
    }
  }

  function fitProblemMapToVisible() {
    const points = state.problemSpace.visiblePoints;
    if (!points.length) {
      state.problemSpace.scale = 1;
      state.problemSpace.panX = 0;
      state.problemSpace.panY = 0;
      updateProblemMapMode();
      drawProblemMap();
      return;
    }
    const { width, height } = problemMapSize();
    const bases = points.map((point) => problemMapBasePoint(point, width, height));
    const minimumX = Math.min(...bases.map((point) => point.x));
    const maximumX = Math.max(...bases.map((point) => point.x));
    const minimumY = Math.min(...bases.map((point) => point.y));
    const maximumY = Math.max(...bases.map((point) => point.y));
    const padding = Math.min(76, Math.max(42, width * 0.09));
    const extentX = Math.max(24, maximumX - minimumX);
    const extentY = Math.max(24, maximumY - minimumY);
    state.problemSpace.scale = Math.min(
      6,
      Math.max(
        0.65,
        Math.min((width - padding * 2) / extentX, (height - padding * 2) / extentY),
      ),
    );
    const centerX = (minimumX + maximumX) / 2;
    const centerY = (minimumY + maximumY) / 2;
    state.problemSpace.panX = -(centerX - width / 2) * state.problemSpace.scale;
    state.problemSpace.panY = -(centerY - height / 2) * state.problemSpace.scale;
    updateProblemMapMode();
    drawProblemMap();
  }

  function drawProblemMap() {
    const canvas = byId("problem-map-canvas");
    const payload = state.problemSpace.mapPayload;
    if (!canvas || !payload || byId("problem-space-view").hidden) return;
    const { width, height } = problemMapSize();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fffdf8";
    context.fillRect(0, 0, width, height);

    const questionMode = problemMapShowsQuestions();
    context.save();
    context.globalAlpha = questionMode ? 0.74 : 0.2;
    state.problemSpace.visiblePoints.forEach((point) => {
      if (
        questionMode &&
        (point.id === state.problemSpace.anchorId ||
          point.id === state.problemSpace.focusedPointId ||
          point.id === state.problemSpace.hoveredPointId)
      ) {
        return;
      }
      const screen = problemMapScreenPoint(point, width, height);
      if (screen.x < -12 || screen.x > width + 12 || screen.y < -12 || screen.y > height + 12) {
        return;
      }
      drawProblemMapShape(context, point, screen.x, screen.y, questionMode ? 3.4 : 1.35);
    });
    context.restore();

    if (!questionMode) {
      visibleProblemClusters().forEach((cluster) => {
        const screen = problemMapScreenPoint(cluster, width, height);
        if (screen.x < -30 || screen.x > width + 30 || screen.y < -30 || screen.y > height + 30) {
          return;
        }
        const radius = Math.min(30, Math.max(17, 13 + Math.sqrt(cluster.count) * 0.65));
        const emphasized =
          cluster.id === state.problemSpace.focusedClusterId ||
          cluster.id === state.problemSpace.hoveredClusterId;
        context.beginPath();
        context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        context.fillStyle = emphasized ? "#17213d" : "rgba(255, 253, 248, 0.94)";
        context.fill();
        context.strokeStyle = emphasized ? "#1679d2" : "#7767d7";
        context.lineWidth = emphasized ? 3 : 2;
        context.stroke();
        context.fillStyle = emphasized ? "#ffffff" : "#443890";
        context.font = "900 12px Inter, system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(problemClusterCode(cluster.id), screen.x, screen.y);
      });
    }

    const emphasizedIds = [
      state.problemSpace.anchorId,
      state.problemSpace.focusedPointId,
      state.problemSpace.hoveredPointId,
    ].filter(Boolean);
    [...new Set(emphasizedIds)].forEach((id) => {
      const point = state.problemSpace.visiblePoints.find((entry) => entry.id === id);
      if (!point || (!questionMode && id !== state.problemSpace.anchorId)) return;
      const screen = problemMapScreenPoint(point, width, height);
      drawProblemMapShape(context, point, screen.x, screen.y, questionMode ? 6.2 : 4.5, true);
      if (id === state.problemSpace.anchorId) {
        context.beginPath();
        context.arc(screen.x, screen.y, 10, 0, Math.PI * 2);
        context.strokeStyle = "#1679d2";
        context.lineWidth = 2.5;
        context.stroke();
      }
    });

    if (!state.problemSpace.visiblePoints.length) {
      context.fillStyle = "#657087";
      context.font = "750 15px Inter, system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText("No questions match these filters.", width / 2, height / 2);
    }
  }

  function problemMapPointById(id, { visibleOnly = false } = {}) {
    const points = visibleOnly
      ? state.problemSpace.visiblePoints
      : state.problemSpace.mapPayload?.points || [];
    return points.find((point) => point.id === id) || null;
  }

  function setProblemMapPointDetail(id, { announceChange = false } = {}) {
    const point = problemMapPointById(id);
    if (!point) {
      setText("map-point-detail-heading", "No question focused");
      setText(
        "map-point-detail-prompt",
        "Hover over a point or focus the map and use the arrow keys.",
      );
      setText("map-point-detail-meta", "");
      byId("problem-map-canvas").setAttribute(
        "aria-label",
        "Corpus map. No question is focused. Use arrow keys to move, Enter to select, plus or minus to zoom, and zero to fit the visible questions.",
      );
      return;
    }
    setText("map-point-detail-heading", point.id);
    setText(
      "map-point-detail-prompt",
      point.prompt || "Prompt excerpt is available after selecting this question.",
    );
    const metadata = [
      point.grade && humanize(point.grade),
      point.domain && humanize(point.domain),
      point.questionType && humanize(point.questionType),
      point.pointTier && `${point.pointTier} published points`,
      point.clusterLabel && `Cluster: ${humanize(point.clusterLabel)}`,
      point.reviewState && `Review: ${humanize(point.reviewState)}`,
      point.proposalState && `Proposal: ${humanize(point.proposalState)}`,
    ].filter(Boolean);
    setText("map-point-detail-meta", metadata.join(" · ") || "No facet evidence reported.");
    const canvas = byId("problem-map-canvas");
    canvas.setAttribute(
      "aria-label",
      `Corpus map. Focused question ${point.id}. ${metadata.join(", ")}. Use arrow keys to move and Enter to explore.`,
    );
    if (announceChange) announce(`Map focus: ${point.id}. ${metadata.join(", ")}`);
  }

  function setProblemMapClusterDetail(id, { announceChange = false } = {}) {
    const cluster = visibleProblemClusters().find((entry) => entry.id === id);
    if (!cluster) {
      setText("map-point-detail-heading", "No cluster focused");
      setText(
        "map-point-detail-prompt",
        "Focus the map and use the arrow keys to move among visible clusters.",
      );
      setText("map-point-detail-meta", "");
      byId("problem-map-canvas").setAttribute(
        "aria-label",
        "Corpus map in cluster overview mode. No cluster is focused. Use arrow keys to move, Enter to zoom, plus or minus to change scale, and zero to fit the visible questions.",
      );
      return;
    }
    const code = problemClusterCode(cluster.id);
    const evidence = cluster.dominantTags
      .slice(0, 3)
      .map((entry) => {
        const coverage = entry.coverage === null
          ? ""
          : ` (${Math.round(entry.coverage * 100)}%)`;
        return `${humanize(entry.tag)}${coverage}`;
      });
    setText("map-point-detail-heading", `${code} · ${humanize(cluster.label)}`);
    setText(
      "map-point-detail-prompt",
      `${formatNumber(cluster.count)} currently visible questions. Select this cluster to zoom into individual questions.`,
    );
    setText(
      "map-point-detail-meta",
      evidence.length
        ? `Dominant proposal tags: ${evidence.join(" · ")}`
        : "No dominant proposal tags reported.",
    );
    byId("problem-map-canvas").setAttribute(
      "aria-label",
      `Corpus map in cluster overview mode. Focused ${code}, ${humanize(cluster.label)}, ${formatNumber(cluster.count)} visible questions. Use arrow keys to move among clusters and Enter to zoom.`,
    );
    if (announceChange) {
      announce(`${code}, ${humanize(cluster.label)}, ${formatNumber(cluster.count)} visible questions.`);
    }
  }

  function nearestProblemMapPoint(clientX, clientY, threshold = 14) {
    return problemMapPointsNear(clientX, clientY, threshold)[0] || null;
  }

  function problemMapPointsNear(clientX, clientY, threshold = 14) {
    const canvas = byId("problem-map-canvas");
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { width, height } = problemMapSize();
    return state.problemSpace.visiblePoints
      .map((point) => {
        const screen = problemMapScreenPoint(point, width, height);
        return { point, distance: Math.hypot(screen.x - x, screen.y - y) };
      })
      .filter((entry) => entry.distance <= threshold)
      .sort((left, right) => left.distance - right.distance || left.point.order - right.point.order)
      .map((entry) => entry.point);
  }

  function hideProblemMapCandidates() {
    const panel = byId("problem-map-candidates");
    if (panel) panel.hidden = true;
  }

  function showProblemMapCandidates(points) {
    const panel = byId("problem-map-candidates");
    const list = byId("problem-map-candidate-list");
    if (!panel || !list || points.length < 2) {
      hideProblemMapCandidates();
      return;
    }
    const shown = points.slice(0, 8);
    list.replaceChildren();
    shown.forEach((point) => {
      const item = node("li");
      const button = node("button", {
        className: "problem-map-candidate-button",
        attrs: {
          type: "button",
          "data-problem-map-candidate-id": point.id,
        },
      });
      const metadata = [
        point.grade && humanize(point.grade),
        point.pointTier && `${point.pointTier} points`,
        point.domain && humanize(point.domain),
        point.questionType && humanize(point.questionType),
      ].filter(Boolean);
      button.append(
        node("strong", { text: point.id }),
        node("small", {
          text: metadata.join(" · ") || "No map facets reported",
        }),
      );
      item.append(button);
      list.append(item);
    });
    setText(
      "problem-map-candidate-summary",
      points.length > shown.length
        ? `${formatNumber(points.length)} questions overlap here. Showing the nearest ${shown.length}; zoom in for a shorter list.`
        : `${formatNumber(points.length)} questions overlap here. Choose one to explore.`,
    );
    panel.hidden = false;
    announce(`${formatNumber(points.length)} questions overlap at this map location. Choose one from the list.`);
    window.requestAnimationFrame(() => list.querySelector("button")?.focus());
  }

  function nearestProblemMapCluster(clientX, clientY) {
    const canvas = byId("problem-map-canvas");
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { width, height } = problemMapSize();
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    visibleProblemClusters().forEach((cluster) => {
      const screen = problemMapScreenPoint(cluster, width, height);
      const distance = Math.hypot(screen.x - x, screen.y - y);
      const hitRadius = Math.min(38, Math.max(25, 21 + Math.sqrt(cluster.count) * 0.5));
      if (distance <= hitRadius && distance < nearestDistance) {
        nearest = cluster;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  function zoomProblemMap(factor, originX, originY) {
    hideProblemMapCandidates();
    const { width, height } = problemMapSize();
    const oldScale = state.problemSpace.scale;
    const nextScale = Math.min(6, Math.max(0.65, oldScale * factor));
    if (nextScale === oldScale) return;
    const ratio = nextScale / oldScale;
    const x = originX ?? width / 2;
    const y = originY ?? height / 2;
    state.problemSpace.panX =
      x - width / 2 - (x - width / 2 - state.problemSpace.panX) * ratio;
    state.problemSpace.panY =
      y - height / 2 - (y - height / 2 - state.problemSpace.panY) * ratio;
    state.problemSpace.scale = nextScale;
    updateProblemMapMode();
    drawProblemMap();
  }

  function resetProblemMap() {
    fitProblemMapToVisible();
  }

  function centerProblemMapOnPoint(id) {
    const point = problemMapPointById(id, { visibleOnly: true });
    if (!point) return false;
    if (!problemMapShowsQuestions()) {
      state.problemSpace.scale = MAP_QUESTION_SCALE;
    }
    const { width, height } = problemMapSize();
    const screen = problemMapScreenPoint(point, width, height);
    state.problemSpace.panX += width / 2 - screen.x;
    state.problemSpace.panY += height / 2 - screen.y;
    state.problemSpace.focusedPointId = id;
    setProblemMapPointDetail(id);
    updateProblemMapMode();
    drawProblemMap();
    return true;
  }

  function centerSelectedProblemMapPoint() {
    const id = state.problemSpace.anchorId;
    if (!id) return;
    if (!problemMapPointById(id, { visibleOnly: true })) {
      const message =
        "The selected question is hidden by the current map filters. Clear the map filters to center it.";
      setText("problem-map-center-note", message);
      announce(message);
      return;
    }
    setText("problem-map-center-note", "");
    if (centerProblemMapOnPoint(id)) announce(`Centered the corpus map on ${id}.`);
  }

  function updateProblemMapCenterControl() {
    const id = state.problemSpace.anchorId;
    const selectedMapPoint = id ? problemMapPointById(id) : null;
    const selectedVisible = id
      ? problemMapPointById(id, { visibleOnly: true })
      : null;
    byId("problem-map-center-selected").disabled = !selectedMapPoint;
    setText(
      "problem-map-center-note",
      !id
        ? ""
        : !selectedMapPoint
          ? "Selected question is not mapped in this evidence view."
          : selectedVisible
            ? ""
            : "Selected question is hidden by the current map filters; clear filters to center it.",
    );
  }

  function focusProblemMapCluster(id, { announceChange = true } = {}) {
    const cluster = visibleProblemClusters().find((entry) => entry.id === id);
    if (!cluster) return false;
    hideProblemMapCandidates();
    state.problemSpace.focusedClusterId = cluster.id;
    const { width, height } = problemMapSize();
    if (state.problemSpace.scale < MAP_QUESTION_SCALE) {
      state.problemSpace.scale = MAP_QUESTION_SCALE;
    }
    const screen = problemMapScreenPoint(cluster, width, height);
    state.problemSpace.panX += width / 2 - screen.x;
    state.problemSpace.panY += height / 2 - screen.y;
    const firstPoint = state.problemSpace.visiblePoints.find(
      (point) => problemPointClusterId(point) === cluster.id,
    );
    if (firstPoint) state.problemSpace.focusedPointId = firstPoint.id;
    updateProblemMapMode();
    drawProblemMap();
    if (announceChange) {
      announce(`Zoomed to ${problemClusterCode(cluster.id)}, ${humanize(cluster.label)}.`);
    }
    return true;
  }

  function moveProblemMapClusterFocus(direction) {
    const clusters = visibleProblemClusters();
    if (!clusters.length) return;
    const current =
      clusters.find((cluster) => cluster.id === state.problemSpace.focusedClusterId) ||
      clusters[0];
    const { width, height } = problemMapSize();
    const origin = problemMapScreenPoint(current, width, height);
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    clusters.forEach((candidate) => {
      if (candidate.id === current.id) return;
      const screen = problemMapScreenPoint(candidate, width, height);
      const dx = screen.x - origin.x;
      const dy = screen.y - origin.y;
      const inDirection =
        (direction === "left" && dx < -1) ||
        (direction === "right" && dx > 1) ||
        (direction === "up" && dy < -1) ||
        (direction === "down" && dy > 1);
      if (!inDirection) return;
      const forward = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
      const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = forward + cross * 2.2;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    if (!best) return;
    state.problemSpace.focusedClusterId = best.id;
    setProblemMapClusterDetail(best.id, { announceChange: true });
    drawProblemMap();
  }

  function moveProblemMapFocus(direction) {
    const points = state.problemSpace.visiblePoints;
    if (!points.length) return;
    let current = problemMapPointById(state.problemSpace.focusedPointId, {
      visibleOnly: true,
    });
    if (!current) current = points[0];
    const { width, height } = problemMapSize();
    const origin = problemMapScreenPoint(current, width, height);
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    points.forEach((candidate) => {
      if (candidate.id === current.id) return;
      const screen = problemMapScreenPoint(candidate, width, height);
      const dx = screen.x - origin.x;
      const dy = screen.y - origin.y;
      const inDirection =
        (direction === "left" && dx < -1) ||
        (direction === "right" && dx > 1) ||
        (direction === "up" && dy < -1) ||
        (direction === "down" && dy > 1);
      if (!inDirection) return;
      const forward = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
      const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = forward + cross * 2.4;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    if (!best) return;
    state.problemSpace.focusedPointId = best.id;
    centerProblemMapOnPoint(best.id);
    setProblemMapPointDetail(best.id, { announceChange: true });
  }

  async function loadProblemMap({ force = false, preserveError = false } = {}) {
    if (
      !force &&
      state.problemSpace.mapPayload &&
      state.problemSpace.mapPayload.view === state.problemSpace.view
    ) {
      byId("problem-space-map-loading").hidden = true;
      byId("problem-space-workspace").hidden = false;
      window.requestAnimationFrame(drawProblemMap);
      return;
    }
    const token = ++state.problemSpace.mapRequestToken;
    byId("problem-space-map-loading").hidden = false;
    if (!preserveError) setInlineError("problem-space-error");
    const url = new URL(API.map, window.location.origin);
    url.searchParams.set("view", state.problemSpace.view);
    if (state.problemSpace.anchorId) {
      url.searchParams.set("item_id", state.problemSpace.anchorId);
    }
    try {
      const { payload } = await requestJson(url);
      if (token !== state.problemSpace.mapRequestToken) return;
      state.problemSpace.mapPayload = normalizeProblemMapPayload(payload);
      byId("problem-space-workspace").hidden = false;
      populateProblemMapFilters();
      applyProblemMapFilters();
      const method = state.problemSpace.mapPayload.projectionMethod;
      const version = state.problemSpace.mapPayload.mapVersion;
      const parameters = state.problemSpace.mapPayload.projectionParameters;
      const implementation = [
        parameters.implementation,
        parameters.implementationVersion,
      ]
        .filter(Boolean)
        .join(" ");
      const parameterLabels = [
        implementation,
        parameters.configuredNeighbors !== null &&
        parameters.effectiveNeighbors !== null
          ? `${parameters.effectiveNeighbors}/${parameters.configuredNeighbors} neighbors`
          : "",
        parameters.minDist !== null ? `min distance ${parameters.minDist}` : "",
        parameters.randomSeed !== null ? `seed ${parameters.randomSeed}` : "",
        parameters.inputMode ? `${humanize(parameters.inputMode)} input` : "",
        parameters.jobs !== null
          ? `${parameters.jobs} worker${parameters.jobs === 1 ? "" : "s"}`
          : "",
      ].filter(Boolean);
      const methodText = method
        ? `Method: ${method}${parameterLabels.length ? ` · ${parameterLabels.join(" · ")}` : ""} · ${humanize(state.problemSpace.view)} view${version ? ` · ${version}` : ""}`
        : `Projection method not reported · ${humanize(state.problemSpace.view)} view${version ? ` · ${version}` : ""}`;
      setText("problem-map-method", methodText);
      const quality = state.problemSpace.mapPayload.projectionQuality;
      let preservationSummary = "Neighborhood preservation quality not reported.";
      if (quality.knnOverlap !== null) {
        const sample = quality.sampleSize
          ? ` across ${formatNumber(quality.sampleSize)} sampled questions${quality.candidateCount ? ` of ${formatNumber(quality.candidateCount)} mapped` : ""}`
          : "";
        let comparison = "";
        if (quality.knnOverlapImprovement !== null) {
          const improvement = quality.knnOverlapImprovement;
          const percentagePoints =
            Math.abs(improvement) <= 1 ? improvement * 100 : improvement;
          comparison = ` (${percentagePoints >= 0 ? "+" : ""}${percentagePoints.toFixed(1)} points vs PCA)`;
        } else if (quality.pcaKnnOverlap !== null) {
          comparison = ` (PCA baseline ${qualityPercent(quality.pcaKnnOverlap)})`;
        }
        const sourceMetric =
          quality.sourceMetric || state.problemSpace.mapPayload.sourceMetric;
        const metricLabel = sourceMetric.includes("mean-bidirectional")
          ? "bidirectional anchor-renormalized similarity"
          : sourceMetric
            ? humanize(sourceMetric)
            : "source metric not reported";
        const configuredFacetCount = Object.keys(
          state.problemSpace.mapPayload.configuredWeights,
        ).length;
        const weightScope = state.problemSpace.mapPayload.configuredWeightScope;
        const weightLabel = configuredFacetCount
          ? `${configuredFacetCount} configured weights${weightScope.includes("not_pairwise") ? " (not pairwise)" : ""}`
          : "configured weights not reported";
        const missingPolicy = state.problemSpace.mapPayload.missingFacetPolicy;
        const missingLabel = missingPolicy.includes("renormalized_per_direction")
          ? "missing facets renormalized per direction"
          : missingPolicy.includes("without_selected_signal_are_unmapped")
            ? "items without selected-view signal are unmapped"
            : missingPolicy
              ? humanize(missingPolicy)
              : "missing-facet policy not reported";
        preservationSummary =
          `2D preservation: ${qualityPercent(quality.knnOverlap)} of ${quality.neighborK || "k"}-neighbor links${sample}${comparison}. ` +
          `Source: ${metricLabel}; ${weightLabel}; ${missingLabel}.`;
      }
      setText("problem-map-quality", preservationSummary);
      const hasProjectionWarnings = Boolean(
        state.problemSpace.mapPayload.warnings.length ||
          ((quality.exactDuplicateCandidateCount || quality.tieAtCutoffAnchorCount) &&
            quality.qualityCaveat),
      );
      setText(
        "problem-map-warnings",
        hasProjectionWarnings
          ? [
              ...state.problemSpace.mapPayload.warnings.map(humanize),
              quality.exactDuplicateCandidateCount || quality.tieAtCutoffAnchorCount
                ? quality.qualityCaveat
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : "No projection warnings reported.",
      );
      byId("problem-map-warnings").classList.toggle(
        "is-warning",
        hasProjectionWarnings,
      );
      byId("problem-space-map-loading").hidden = true;
      window.requestAnimationFrame(drawProblemMap);
      announce(
        `Loaded ${formatNumber(state.problemSpace.mapPayload.points.length)} mapped corpus questions; ${formatNumber(state.problemSpace.mapPayload.unmappedCount)} are unmapped in this evidence view.`,
      );
    } catch (error) {
      if (token !== state.problemSpace.mapRequestToken) return;
      byId("problem-space-map-loading").hidden = true;
      setInlineError("problem-space-error", `Corpus map could not be loaded: ${error.message}`);
    }
  }

  function score01(value) {
    const score = finiteNumber(value, 0);
    if (score > 1 && score <= 100) return score / 100;
    return Math.min(1, Math.max(0, score));
  }

  function qualityPercent(value) {
    const percentage = score01(value) * 100;
    return `${percentage.toFixed(1).replace(/\.0$/, "")}%`;
  }

  function normalizeComparable(value) {
    const record = asRecord(value);
    const proposed = asRecord(firstDefined(record.proposal, record.classification_proposal));
    const facets = asRecord(
      firstDefined(record.facet_coordinates, record.facets, proposed.facet_coordinates),
    );
    const tags = normalizeTagList(
      firstDefined(
        record.classification_tags,
        record.proposed_tags,
        record.tags,
        proposed.skill_ids,
        proposed.tags,
      ),
    );
    return {
      id: itemId(record),
      prompt: stringValue(
        firstDefined(record.prompt_excerpt, record.prompt, record.question_text, record.title),
        "Prompt excerpt not returned.",
      ),
      source: sourceLabel(firstDefined(record.source, record.source_label)),
      grade: gradeRangeValue(firstDefined(record.grade, record.grade_band)),
      pointTier: pointTierValue(
        firstDefined(
          record.published_point_tier,
          record.point_tier,
          record.points,
          asRecord(record.source).published_point_tier,
        ),
      ),
      domain: stringValue(
        firstDefined(record.primary_domain, facets.primary_domain, proposed.primary_domain),
      ),
      questionType: stringValue(
        firstDefined(record.question_type, facets.question_type, proposed.question_type),
      ),
      skills: normalizeTagList(
        firstDefined(record.skill_ids, facets.skill_ids, proposed.skill_ids),
      ),
      representations: normalizeTagList(
        firstDefined(
          record.representation_ids,
          facets.representation_ids,
          proposed.representation_ids,
          proposed.representation_tags,
        ),
      ),
      cognitiveDemand: stringValue(
        firstDefined(
          record.cognitive_demand,
          facets.cognitive_demand,
          proposed.cognitive_demand,
          proposed.cognitive_demand_tag,
        ),
      ),
      reviewState: stringValue(
        firstDefined(record.review_state, record.teacher_review_state, record.disposition),
      ),
      classificationSource: stringValue(
        firstDefined(
          record.classification_source,
          record.proposal_state,
          proposed.provenance,
        ),
      ),
      classificationContentVersion: stringValue(
        firstDefined(
          record.classification_content_version,
          proposed.classification_content_version,
          proposed.content_version,
        ),
      ),
      tags,
    };
  }

  function normalizeNeighbor(value, index) {
    const record = asRecord(value);
    const comparable = normalizeComparable(record);
    const scores = asRecord(
      firstDefined(record.score_components, record.scores, record.score_breakdown),
    );
    const review = asRecord(firstDefined(record.existing_review, record.review));
    return {
      ...comparable,
      rank: integer(firstDefined(record.rank, index + 1), index + 1),
      score: score01(firstDefined(record.score, record.total_score, record.similarity)),
      scores: Object.fromEntries(
        Object.entries(scores)
          .filter(
            ([, score]) =>
              score !== null && score !== "" && Number.isFinite(Number(score)),
          )
          .map(([key, score]) => [key, score01(score)]),
      ),
      sharedTags: normalizeTagList(firstDefined(record.shared_tags, record.overlap_tags)),
      proposedTags: normalizeTagList(firstDefined(record.proposed_tags, record.tags, comparable.tags)),
      reasons: textList(firstDefined(record.reasons, record.explanations, record.evidence)),
      rating: stringValue(firstDefined(review.rating, record.rating)),
      etag: stringValue(firstDefined(review.etag, record.etag)),
    };
  }

  function normalizeNeighborsPayload(payload) {
    const root = asRecord(payload);
    return {
      anchor: normalizeComparable(firstDefined(root.anchor, root.anchor_item, { item_id: state.similarity.anchorId })),
      view: stringValue(root.view, state.similarity.view),
      retrievalVersion: stringValue(firstDefined(root.retrieval_version, root.algorithm_version)),
      effectiveWeights: asRecord(root.effective_weights),
      warnings: textList(root.warnings),
      neighbors: asArray(firstDefined(root.neighbors, root.items, root.results)).map(normalizeNeighbor),
    };
  }

  function normalizeProblemNeighborhoodPayload(payload, fallbackId = "") {
    const root = asRecord(payload);
    const anchorValue = firstDefined(
      root.anchor,
      root.anchor_item,
      root.selected,
      fallbackId ? { item_id: fallbackId } : null,
    );
    const neighborValues = firstDefined(root.neighbors, root.items, root.results, []);
    return {
      anchor: normalizeComparable(anchorValue),
      view: stringValue(root.view, state.problemSpace.view),
      retrievalVersion: stringValue(
        firstDefined(root.retrieval_version, root.algorithm_version),
      ),
      effectiveWeights: asRecord(root.effective_weights),
      warnings: textList(root.warnings),
      neighbors: asArray(neighborValues).map(normalizeNeighbor),
    };
  }

  function renderProblemSearchMatches(values, { matchType = "", warnings = [] } = {}) {
    const matches = values.map(normalizeNeighbor).filter((match) => match.id);
    const list = byId("problem-search-match-list");
    list.replaceChildren();
    matches.forEach((match) => {
      const item = node("li", { className: "problem-search-match" });
      const button = node("button", {
        className: "problem-search-match-button",
        attrs: {
          type: "button",
          "data-problem-item-id": match.id,
          "aria-label": `Explore match ${match.rank}, ${match.id}, retrieval score ${match.score.toFixed(2)}`,
        },
      });
      const heading = node("span", { className: "problem-search-match-heading" });
      const identity = node("span");
      const metadata = [
        match.source,
        match.grade && humanize(match.grade),
        match.pointTier && `${match.pointTier} points`,
        match.domain && humanize(match.domain),
        match.questionType && humanize(match.questionType),
      ]
        .filter(Boolean)
        .join(" · ");
      identity.append(
        node("strong", { text: `#${match.rank} · ${match.id}` }),
        node("small", { text: metadata || "Source and proposed facets not reported" }),
      );
      heading.append(
        identity,
        node("span", {
          className: "score-badge",
          text: `Score ${match.score.toFixed(2)}`,
        }),
      );
      const componentEvidence = Object.entries(match.scores)
        .map(([label, score]) => `${humanize(label)} ${score.toFixed(2)}`)
        .join(" · ");
      const facetEvidence = [
        match.representations.length &&
          `Representations: ${match.representations.map(humanize).join(", ")}`,
        match.cognitiveDemand && `Demand: ${humanize(match.cognitiveDemand)}`,
        match.classificationSource &&
          `Classification: ${humanize(match.classificationSource)}`,
        match.classificationContentVersion &&
          `Content version: ${match.classificationContentVersion}`,
      ].filter(Boolean);
      const retrievalEvidence = [
        ...match.sharedTags.map((tag) => `Shared: ${humanize(tag)}`),
        ...match.reasons.slice(0, 2).map(humanize),
      ];
      button.append(
        heading,
        node("span", {
          className: "problem-search-match-prompt",
          text: match.prompt,
        }),
      );
      if (componentEvidence) {
        button.append(
          node("span", {
            className: "problem-search-match-components",
            text: `Score components: ${componentEvidence}`,
          }),
        );
      }
      if (facetEvidence.length || retrievalEvidence.length) {
        button.append(
          node("span", {
            className: "problem-search-match-evidence",
            text: [...facetEvidence, ...retrievalEvidence].join(" · "),
          }),
        );
      }
      button.append(
        node("span", { className: "problem-search-match-action", text: "Start trail →" }),
      );
      item.append(button);
      list.append(item);
    });
    if (!matches.length) {
      list.append(
        node("li", {
          className: "problem-search-no-match",
          text: "No matching question was returned. Try a stable ID or a more distinctive phrase.",
        }),
      );
    }
    const summaryParts = [
      `${formatNumber(matches.length)} ${matches.length === 1 ? "match" : "matches"}`,
      matchType && humanize(matchType),
      ...warnings.map((warning) => `Warning: ${humanize(warning)}`),
    ].filter(Boolean);
    setText("problem-search-results-summary", summaryParts.join(" · "));
    byId("problem-space-search-results").hidden = false;
  }

  function renderProblemTrail() {
    const list = byId("problem-trail-list");
    list.replaceChildren();
    state.problemSpace.trail.forEach((entry, index) => {
      const item = node("li");
      const button = node("button", {
        className: `problem-trail-step${index === state.problemSpace.trailIndex ? " is-current" : ""}`,
        attrs: {
          type: "button",
          "data-problem-trail-index": index,
          "aria-current": index === state.problemSpace.trailIndex ? "step" : undefined,
          "aria-label": `Open trail step ${index + 1}: ${entry.id}`,
        },
      });
      button.append(
        node("span", { className: "problem-trail-number", text: index + 1 }),
        node("code", { text: entry.id }),
      );
      item.append(button);
      list.append(item);
    });
    const hasCurrent = state.problemSpace.trailIndex >= 0;
    byId("problem-trail-back").disabled = state.problemSpace.trailIndex <= 0;
    byId("problem-trail-forward").disabled =
      !hasCurrent || state.problemSpace.trailIndex >= state.problemSpace.trail.length - 1;
    setText(
      "problem-trail-position",
      hasCurrent
        ? `Step ${state.problemSpace.trailIndex + 1} of ${state.problemSpace.trail.length}`
        : "No question selected",
    );
  }

  function renderProblemSelectedQuestionDetail(detail) {
    const englishHelper = detail.englishHelper;
    setText("problem-selected-source", detail.sourceLine || "Source metadata not reported");
    setText(
      "problem-selected-prompt-heading",
      englishHelper ? "English helper prompt" : "Complete prompt",
    );
    setText(
      "problem-selected-choices-heading",
      englishHelper ? "English helper choices" : "Answer choices",
    );
    setText(
      "problem-selected-prompt",
      englishHelper?.englishPrompt ||
        detail.prompt ||
        "No complete parsed prompt is available for this record.",
    );

    const assetList = byId("problem-selected-assets");
    assetList.replaceChildren();
    const assetSection = byId("problem-selected-assets-section");
    assetSection.hidden = false;
    if (!detail.assets.length) {
      assetList.append(
        node("p", {
          className: "problem-selected-asset-missing",
          text: "No audited question-scoped image is available for this record.",
        }),
      );
    } else {
      detail.assets.forEach((asset, index) => {
        const ordinal = asset.ordinal || index + 1;
        const figure = node("figure", { className: "problem-selected-asset" });
        if (asset.url && asset.status === "available") {
          const image = node("img", {
            attrs: {
              src: asset.url,
              alt:
                asset.alt ||
                `Complete question-scoped source image ${ordinal} of ${detail.assets.length} for ${detail.id}. It may contain visual prompt information or answer choices.`,
              loading: "eager",
              decoding: "async",
              width: asset.width || undefined,
              height: asset.height || undefined,
            },
          });
          image.addEventListener("error", () => {
            image.hidden = true;
            let missing = figure.querySelector(".problem-selected-asset-missing");
            if (!missing) {
              missing = node("p", {
                className: "problem-selected-asset-missing",
                text: `Question image ${ordinal} could not be displayed from its audited local file.`,
              });
              figure.insertBefore(missing, figure.firstChild);
            }
          });
          figure.append(image);
        } else {
          figure.append(
            node("p", {
              className: "problem-selected-asset-missing",
              text: `Question image ${ordinal} was unavailable when this catalogue snapshot was built.`,
            }),
          );
        }
        figure.append(
          node("figcaption", {
            text:
              asset.caption ||
              `Audited question-scoped image ${ordinal} of ${detail.assets.length}, shown in source order.`,
          }),
        );
        assetList.append(figure);
      });
    }

    const choices = byId("problem-selected-choices");
    const choicesNote = byId("problem-selected-choices-note");
    choices.replaceChildren();
    const renderableChoices = englishHelper
      ? englishHelper.englishChoices
      : detail.renderableChoices || [];
    renderableChoices.forEach((choice, index) => {
      const item = node("li");
      if (choice.text) {
        item.append(node("span", { text: choice.text }));
      } else if (!choice.imageUrl) {
        item.append(
          node("span", {
            className: "problem-selected-choice-unparsed",
            text: "No separately extracted text; inspect the source image.",
          }),
        );
      }
      if (choice.imageUrl) {
        item.append(
          node("img", {
            className: "problem-selected-choice-image",
            attrs: {
              src: choice.imageUrl,
              alt: choice.imageAlt || `Visual content for choice ${String.fromCharCode(65 + index)}`,
              loading: "eager",
              decoding: "async",
            },
          }),
        );
      }
      choices.append(item);
    });
    choices.hidden = renderableChoices.length === 0;
    choicesNote.hidden = renderableChoices.length !== 0;
    choicesNote.textContent = renderableChoices.length
      ? ""
      : "No structured choice text was extracted. Inspect the complete source image above for visual answer choices as they appeared in the original question.";

    const languageSection = byId("problem-selected-language-helper");
    languageSection.hidden = !englishHelper;
    if (englishHelper) {
      const displayLanguage = languageName(englishHelper.sourceLanguage);
      setText("problem-selected-language-label", displayLanguage);
      setText(
        "problem-selected-source-prompt",
        englishHelper.sourcePrompt ||
          "No separate source-language prompt transcription is available.",
      );
      const languageCode = englishHelper.sourceLanguage;
      const validLanguageCode = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(languageCode);
      const sourcePrompt = byId("problem-selected-source-prompt");
      const sourceChoices = byId("problem-selected-source-choices");
      if (validLanguageCode) {
        sourcePrompt.setAttribute("lang", languageCode);
        sourceChoices.setAttribute("lang", languageCode);
      } else {
        sourcePrompt.removeAttribute("lang");
        sourceChoices.removeAttribute("lang");
      }
      sourceChoices.replaceChildren();
      englishHelper.sourceChoices.forEach((choice) => {
        const item = node("li");
        item.append(
          node("span", {
            text:
              choice.text ||
              "No separately extracted source-language text; inspect the source image.",
          }),
        );
        if (choice.imageUrl) {
          item.append(
            node("img", {
              className: "problem-selected-choice-image",
              attrs: {
                src: choice.imageUrl,
                alt: choice.imageAlt,
                loading: "eager",
                decoding: "async",
              },
            }),
          );
        }
        sourceChoices.append(item);
      });
      const sourceChoicesNote = byId("problem-selected-source-choices-note");
      sourceChoices.hidden = englishHelper.sourceChoices.length === 0;
      sourceChoicesNote.hidden = englishHelper.sourceChoices.length !== 0;
      sourceChoicesNote.textContent = englishHelper.sourceChoices.length
        ? ""
        : englishHelper.choicesStatus === "graphical"
          ? "The source answer choices are graphical. Inspect the audited source image above."
          : "No structured source-language choice transcription is available; inspect the audited source image above.";
      renderDefinitionList("problem-selected-language-status", [
        ["English prompt", humanize(englishHelper.promptStatus)],
        ["English choices", humanize(englishHelper.choicesStatus)],
        ["Translation method", humanize(englishHelper.translationMethod)],
        ["Translation review", humanize(englishHelper.reviewStatus)],
      ]);
    }

    const sourcePdf = byId("problem-selected-source-pdf");
    sourcePdf.hidden = !detail.pdfUrl;
    if (detail.pdfUrl) sourcePdf.href = detail.pdfUrl;
    else sourcePdf.removeAttribute("href");

    byId("problem-selected-question-loading").hidden = true;
    setInlineError("problem-selected-question-error");
    byId("problem-selected-question").hidden = false;
  }

  async function loadProblemSelectedQuestionDetail(entry) {
    const token = ++state.problemSpace.detailRequestToken;
    byId("problem-selected-question").hidden = true;
    setInlineError("problem-selected-question-error");
    byId("problem-selected-question-loading").hidden = false;
    try {
      const { payload, response } = await requestJson(
        `${API.items}/${encodeURIComponent(entry.id)}`,
      );
      const detail = normalizeDetail(payload, response);
      entry.detail = detail;
      const current = state.problemSpace.trail[state.problemSpace.trailIndex];
      if (token !== state.problemSpace.detailRequestToken || current !== entry) return;
      renderProblemSelectedQuestionDetail(detail);
    } catch (error) {
      const current = state.problemSpace.trail[state.problemSpace.trailIndex];
      if (token !== state.problemSpace.detailRequestToken || current !== entry) return;
      byId("problem-selected-question-loading").hidden = true;
      byId("problem-selected-question").hidden = true;
      setInlineError(
        "problem-selected-question-error",
        `The complete question could not be loaded: ${error.message}`,
      );
    }
  }

  function renderProblemSelectedQuestion(entry) {
    state.problemSpace.detailRequestToken += 1;
    if (entry.detail) {
      renderProblemSelectedQuestionDetail(entry.detail);
      return;
    }
    loadProblemSelectedQuestionDetail(entry);
  }

  function renderProblemNeighborhood() {
    const entry = state.problemSpace.trail[state.problemSpace.trailIndex];
    if (!entry) {
      byId("problem-selected-empty").hidden = false;
      byId("problem-neighborhood-content").hidden = true;
      renderProblemTrail();
      return;
    }
    const payload = entry.payload;
    const anchor = payload.anchor;
    state.problemSpace.anchorId = anchor.id || entry.id;
    setText("problem-selected-reference", state.problemSpace.anchorId);
    renderProblemSelectedQuestion(entry);
    renderDefinitionList("problem-selected-metadata", [
      ["Grade", anchor.grade ? humanize(anchor.grade) : "Not reported"],
      ["Published points", anchor.pointTier ? String(anchor.pointTier) : "Not reported"],
      ["Primary domain", anchor.domain ? humanize(anchor.domain) : "Not proposed"],
      ["Question type", anchor.questionType ? humanize(anchor.questionType) : "Not proposed"],
      [
        "Required skills",
        anchor.skills.length ? anchor.skills.map(humanize).join(", ") : "Not proposed",
      ],
      [
        "Representations",
        anchor.representations.length
          ? anchor.representations.map(humanize).join(", ")
          : "Not proposed",
      ],
      [
        "Cognitive demand",
        anchor.cognitiveDemand ? humanize(anchor.cognitiveDemand) : "Not proposed",
      ],
      ["Teacher review", anchor.reviewState ? humanize(anchor.reviewState) : "Unreviewed"],
      [
        "Classification evidence",
        anchor.classificationSource
          ? humanize(anchor.classificationSource)
          : "Proposal provenance not reported",
      ],
      [
        "Classification content version",
        anchor.classificationContentVersion || "Not reported",
      ],
      ["Retrieval version", payload.retrievalVersion || "Not reported"],
    ]);
    const selectedTags = [
      ...anchor.tags,
      ...anchor.skills.map((value) => `Skill: ${value}`),
      ...anchor.representations.map((value) => `Representation: ${value}`),
      ...payload.warnings.map((warning) => `Warning: ${warning}`),
    ];
    renderTags(
      byId("problem-selected-tags"),
      [...new Set(selectedTags)],
      "No proposed facet tags returned",
    );

    const list = byId("problem-neighbor-list");
    list.replaceChildren();
    payload.neighbors.forEach((neighbor) => {
      const item = node("li", { className: "problem-neighbor-item" });
      const button = node("button", {
        className: "problem-neighbor-button",
        attrs: {
          type: "button",
          "data-problem-item-id": neighbor.id,
          "aria-label": `Continue trail to ${neighbor.id}, retrieval score ${neighbor.score.toFixed(2)}`,
        },
      });
      const header = node("span", { className: "problem-neighbor-header" });
      const identity = node("span");
      identity.append(
        node("strong", { text: `#${neighbor.rank} · ${neighbor.id}` }),
        node("small", {
          text: [
            neighbor.source,
            neighbor.grade && humanize(neighbor.grade),
            neighbor.pointTier && `${neighbor.pointTier} points`,
            neighbor.domain && humanize(neighbor.domain),
            neighbor.questionType && humanize(neighbor.questionType),
          ]
            .filter(Boolean)
            .join(" · "),
        }),
      );
      header.append(
        identity,
        node("span", {
          className: "score-badge",
          text: `Score ${neighbor.score.toFixed(2)}`,
        }),
      );
      const componentEvidence = Object.entries(neighbor.scores)
        .map(([label, score]) => `${humanize(label)} ${score.toFixed(2)}`)
        .join(" · ");
      const evidence = [
        ...neighbor.sharedTags.map((value) => `Shared: ${humanize(value)}`),
        ...neighbor.reasons.slice(0, 2).map(humanize),
        neighbor.representations.length &&
          `Representations: ${neighbor.representations.map(humanize).join(", ")}`,
        neighbor.cognitiveDemand && `Demand: ${humanize(neighbor.cognitiveDemand)}`,
        neighbor.classificationSource &&
          `Classification: ${humanize(neighbor.classificationSource)}`,
        neighbor.classificationContentVersion &&
          `Content version: ${neighbor.classificationContentVersion}`,
      ]
        .filter(Boolean)
        .join(" · ");
      button.append(
        header,
        node("span", { className: "problem-neighbor-prompt", text: neighbor.prompt }),
      );
      if (componentEvidence) {
        button.append(
          node("span", {
            className: "problem-neighbor-components",
            text: `Score components: ${componentEvidence}`,
          }),
        );
      }
      if (evidence) {
        button.append(node("span", { className: "problem-neighbor-evidence", text: evidence }));
      }
      button.append(node("span", { className: "problem-neighbor-action", text: "Continue trail →" }));
      item.append(button);
      list.append(item);
    });
    setText(
      "problem-neighbors-summary",
      `${formatNumber(payload.neighbors.length)} candidates · ${humanize(payload.view)} view`,
    );
    byId("problem-neighbor-loading").hidden = true;
    byId("problem-selected-empty").hidden = true;
    byId("problem-neighborhood-content").hidden = false;
    updateProblemMapCenterControl();
    state.problemSpace.focusedPointId = state.problemSpace.anchorId;
    setProblemMapPointDetail(state.problemSpace.anchorId);
    centerProblemMapOnPoint(state.problemSpace.anchorId);
    renderProblemTrail();
    updateUrl();
  }

  function commitProblemNeighborhood(payload, { replaceCurrent = false } = {}) {
    const id = payload.anchor.id || state.problemSpace.anchorId;
    if (!id) return;
    payload.anchor.id = id;
    const current = state.problemSpace.trail[state.problemSpace.trailIndex];
    const entry = {
      id,
      payload,
      detail: current?.id === id ? current.detail : null,
    };
    if (state.problemSpace.trailIndex >= 0 && (replaceCurrent || current?.id === id)) {
      state.problemSpace.trail[state.problemSpace.trailIndex] = entry;
    } else {
      state.problemSpace.trail = state.problemSpace.trail.slice(
        0,
        state.problemSpace.trailIndex + 1,
      );
      state.problemSpace.trail.push(entry);
      state.problemSpace.trailIndex = state.problemSpace.trail.length - 1;
    }
    renderProblemNeighborhood();
    announce(`Exploring ${id} with ${payload.neighbors.length} nearby questions.`);
  }

  function cancelProblemSearchRequest() {
    state.problemSpace.searchRequestToken += 1;
    byId("problem-space-search-loading").hidden = true;
    byId("problem-space-submit").disabled = false;
  }

  function restoreCommittedProblemNeighborhood() {
    byId("problem-neighbor-loading").hidden = true;
    const entry = state.problemSpace.trail[state.problemSpace.trailIndex];
    if (entry?.payload?.view === state.problemSpace.view) {
      renderProblemNeighborhood();
      return;
    }
    byId("problem-neighborhood-content").hidden = true;
    byId("problem-selected-empty").hidden = false;
    renderProblemTrail();
    updateUrl();
  }

  function navigateProblemTrail(index) {
    if (index < 0 || index >= state.problemSpace.trail.length) return;
    cancelProblemSearchRequest();
    state.problemSpace.neighborhoodRequestToken += 1;
    const entry = state.problemSpace.trail[index];
    if (entry.payload?.view !== state.problemSpace.view) {
      exploreProblemQuestion(entry.id, {
        replaceCurrent: true,
        targetTrailIndex: index,
      });
      return;
    }
    state.problemSpace.trailIndex = index;
    renderProblemNeighborhood();
    byId("problem-selected-heading").focus?.();
  }

  async function exploreProblemQuestion(
    id,
    { replaceCurrent = false, targetTrailIndex = null, fromSearch = false } = {},
  ) {
    const item = stringValue(id).trim();
    if (!item) return false;
    if (state.activeView === "world" && window.CatalogueWorldQA?.openItem) {
      return window.CatalogueWorldQA.openItem(item);
    }
    hideProblemMapCandidates();
    if (!fromSearch) cancelProblemSearchRequest();
    const committedIndex = state.problemSpace.trailIndex;
    const committedAnchorId = state.problemSpace.anchorId;
    const committedEntry = state.problemSpace.trail[committedIndex];
    const requestedView = byId("problem-space-view-select").value;
    state.problemSpace.view = requestedView;
    updateUrl();
    setInlineError("problem-space-error");
    byId("problem-space-search-results").hidden = true;
    byId("problem-selected-empty").hidden = true;
    byId("problem-neighborhood-content").hidden = true;
    byId("problem-neighbor-loading").hidden = false;
    const token = ++state.problemSpace.neighborhoodRequestToken;
    const url = new URL(
      `${API.items}/${encodeURIComponent(item)}/neighbors`,
      window.location.origin,
    );
    url.searchParams.set("view", requestedView);
    url.searchParams.set("limit", "8");
    try {
      const { payload } = await requestJson(url);
      if (token !== state.problemSpace.neighborhoodRequestToken) return null;
      const normalized = normalizeProblemNeighborhoodPayload(payload, item);
      if (!normalized.anchor.id) normalized.anchor.id = item;
      if (normalized.view !== requestedView) {
        throw new Error(
          `The service returned ${humanize(normalized.view)} evidence instead of ${humanize(requestedView)} evidence.`,
        );
      }
      if (Number.isInteger(targetTrailIndex)) {
        state.problemSpace.trailIndex = targetTrailIndex;
      }
      commitProblemNeighborhood(normalized, {
        replaceCurrent: replaceCurrent || Number.isInteger(targetTrailIndex),
      });
      if (!state.problemSpace.mapPayload) loadProblemMap();
      return true;
    } catch (error) {
      if (token !== state.problemSpace.neighborhoodRequestToken) return null;
      state.problemSpace.trailIndex = committedIndex;
      state.problemSpace.anchorId = committedAnchorId;
      const committedView = committedEntry?.payload?.view;
      if (
        committedView &&
        committedView !== requestedView &&
        state.problemSpace.view === requestedView
      ) {
        state.problemSpace.view = committedView;
        byId("problem-space-view-select").value = committedView;
        state.problemSpace.mapPayload = null;
        updateUrl();
        await loadProblemMap({ force: true, preserveError: true });
      }
      byId("problem-neighbor-loading").hidden = true;
      restoreCommittedProblemNeighborhood();
      setInlineError(
        "problem-space-error",
        `This question’s neighborhood could not be loaded: ${error.message}`,
      );
      return false;
    }
  }

  function looksLikeStableQuestionId(value) {
    return (
      value.length >= 6 &&
      value.length <= 180 &&
      /[-:]/.test(value) &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:-]+$/.test(value)
    );
  }

  async function exploreProblemQuery() {
    const query = byId("problem-space-query").value.trim();
    if (!query) {
      setInlineError(
        "problem-space-error",
        "Enter a stable question ID or paste question text, or choose Random question.",
      );
      return;
    }
    const stableQuestionId = looksLikeStableQuestionId(query);
    let requestedView = byId("problem-space-view-select").value;
    if (requestedView === "tag" && !stableQuestionId) {
      requestedView = "surface";
      byId("problem-space-view-select").value = requestedView;
      state.problemSpace.mapPayload = null;
      setText(
        "problem-space-query-note",
        "Pasted text has no stable proposed tags, so this search and map use Surface similarity.",
      );
      announce("Using Surface similarity because pasted text has no stable proposed tags.");
    } else {
      setText(
        "problem-space-query-note",
        "Pasted text can use Surface or Hybrid evidence. Proposed-tag evidence requires a stable question ID.",
      );
    }
    state.problemSpace.query = query;
    state.problemSpace.view = requestedView;
    updateUrl();
    setInlineError("problem-space-error");
    state.problemSpace.neighborhoodRequestToken += 1;
    restoreCommittedProblemNeighborhood();
    byId("problem-space-search-results").hidden = true;
    byId("problem-space-search-loading").hidden = false;
    byId("problem-space-submit").disabled = true;
    const token = ++state.problemSpace.searchRequestToken;
    if (
      !state.problemSpace.mapPayload ||
      state.problemSpace.mapPayload.view !== requestedView
    ) {
      loadProblemMap({ force: true });
    }
    try {
      const { payload } = await requestJson(API.explore, {
        method: "POST",
        body: JSON.stringify({ query, view: requestedView, limit: 8 }),
      });
      if (token !== state.problemSpace.searchRequestToken) return;
      const root = asRecord(payload);
      const resolvedItemId = stringValue(
        firstDefined(root.query_item_id, root.resolved_item_id),
      );
      const anchor = normalizeComparable(
        firstDefined(
          root.anchor,
          root.anchor_item,
          root.selected,
          resolvedItemId ? { item_id: resolvedItemId } : null,
        ),
      );
      if (anchor.id) {
        byId("problem-space-search-loading").hidden = true;
        byId("problem-space-submit").disabled = false;
        await exploreProblemQuestion(anchor.id, { fromSearch: true });
      } else {
        renderProblemSearchMatches(
          asArray(firstDefined(root.results, root.matches, root.items, root.neighbors)),
          {
            matchType: stringValue(firstDefined(root.match_type, root.query_kind)),
            warnings: textList(root.warnings),
          },
        );
      }
    } catch (error) {
      if (token !== state.problemSpace.searchRequestToken) return;
      setInlineError(
        "problem-space-error",
        `Question search could not be completed: ${error.message}`,
      );
    } finally {
      if (token === state.problemSpace.searchRequestToken) {
        byId("problem-space-search-loading").hidden = true;
        byId("problem-space-submit").disabled = false;
      }
    }
  }

  async function exploreRandomProblemQuestion() {
    setInlineError("problem-space-error");
    await loadProblemMap();
    const points = state.problemSpace.visiblePoints;
    if (!points.length) {
      setInlineError(
        "problem-space-error",
        "No questions match the current map filters. Clear a filter and try again.",
      );
      return;
    }
    let candidates = points.filter(
      (point) =>
        !state.problemSpace.randomSeenIds.has(point.id) &&
        (points.length === 1 || point.id !== state.problemSpace.anchorId),
    );
    let restartedCycle = false;
    if (!candidates.length) {
      points.forEach((point) => state.problemSpace.randomSeenIds.delete(point.id));
      candidates = points.filter(
        (point) => points.length === 1 || point.id !== state.problemSpace.anchorId,
      );
      if (!candidates.length) candidates = points;
      restartedCycle = true;
    }
    let randomValue = Math.floor(Math.random() * candidates.length);
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      randomValue = values[0] % candidates.length;
    }
    const point = candidates[randomValue];
    state.problemSpace.randomSeenIds.add(point.id);
    byId("problem-space-query").value = point.id;
    if (restartedCycle) {
      announce("Every visible question has been sampled once. Starting a new random cycle.");
    }
    await exploreProblemQuestion(point.id);
  }

  function similarityJudgementKey(anchorId, retrievalVersion, view, neighborId) {
    return JSON.stringify([anchorId, retrievalVersion, view, neighborId]);
  }

  function renderTags(container, values, emptyText) {
    container.replaceChildren();
    if (!values.length) {
      container.append(node("span", { className: "is-empty", text: emptyText }));
      return;
    }
    values.forEach((value) => container.append(node("span", { text: humanize(value) })));
  }

  function scoreBreakdown(scores, totalScore) {
    const container = node("dl", { className: "score-breakdown" });
    const entries = Object.entries(scores);
    if (!entries.length) entries.push(["total", totalScore]);
    entries.forEach(([label, value]) => {
      const row = node("div", { className: "score-row" });
      const progress = node("progress", {
        attrs: { min: "0", max: "1", value: score01(value), "aria-label": `${humanize(label)} score` },
      });
      row.append(
        node("span", { text: humanize(label) }),
        progress,
        node("strong", { text: score01(value).toFixed(2) }),
      );
      container.append(row);
    });
    return container;
  }

  function listSection(title, values, className = "reason-list") {
    const section = node("section", { className: "neighbor-section" });
    section.append(node("h5", { text: title }));
    const list = node("ul", { className });
    (values.length ? values : ["None reported."]).forEach((value) => list.append(node("li", { text: value })));
    section.append(list);
    return section;
  }

  function renderSimilarity() {
    const payload = state.similarity.payload;
    if (!payload) return;
    const anchor = payload.anchor;
    setText("similarity-anchor-reference", anchor.id || state.similarity.anchorId);
    setText("similarity-anchor-prompt", anchor.prompt);
    renderDefinitionList("similarity-anchor-metadata", [
      ["Source", anchor.source],
      ["Grade", anchor.grade ? humanize(anchor.grade) : "Not reported"],
      ["Primary domain", anchor.domain ? humanize(anchor.domain) : "Not proposed"],
      ["Question type", anchor.questionType ? humanize(anchor.questionType) : "Not proposed"],
      ["Retrieval version", payload.retrievalVersion || "Not reported"],
    ]);
    const anchorEvidence = [
      ...anchor.tags,
      ...Object.entries(payload.effectiveWeights).map(
        ([key, value]) => `${humanize(key)} weight ${finiteNumber(value).toFixed(2)}`,
      ),
      ...payload.warnings.map((warning) => `Warning: ${warning}`),
    ];
    renderTags(
      byId("similarity-anchor-tags"),
      anchorEvidence,
      "No proposed anchor tags or retrieval notes returned",
    );
    const cards = byId("neighbor-cards");
    cards.replaceChildren();
    payload.neighbors.forEach((neighbor) => {
      const judgementKey = similarityJudgementKey(
        anchor.id || state.similarity.anchorId,
        payload.retrievalVersion,
        payload.view,
        neighbor.id,
      );
      if (neighbor.rating) state.similarity.ratings.set(judgementKey, neighbor.rating);
      if (neighbor.etag) state.similarity.etags.set(judgementKey, neighbor.etag);
      const item = node("li", {
        className: "neighbor-card",
        attrs: { "data-neighbor-id": neighbor.id, "data-testid": "neighbor-card" },
      });
      const header = node("header", { className: "neighbor-card-header" });
      const identity = node("div");
      identity.append(node("h4", { text: `#${neighbor.rank} · ${neighbor.id || "Candidate"}` }));
      if (neighbor.source) identity.append(node("code", { text: neighbor.source }));
      header.append(
        identity,
        node("span", { className: "score-badge", text: `Score ${neighbor.score.toFixed(2)}` }),
      );
      const meta = [neighbor.grade && humanize(neighbor.grade), neighbor.domain && humanize(neighbor.domain), neighbor.questionType && humanize(neighbor.questionType)]
        .filter(Boolean)
        .join(" · ");
      item.append(header, node("p", { className: "neighbor-prompt", text: neighbor.prompt }));
      if (meta) item.append(node("p", { className: "neighbor-meta", text: meta }));
      item.append(scoreBreakdown(neighbor.scores, neighbor.score));

      const sharedSection = node("section", { className: "neighbor-section" });
      sharedSection.append(node("h5", { text: "Shared reviewed or proposed tags" }));
      const shared = node("div", { className: "shared-tags" });
      renderTags(shared, neighbor.sharedTags, "No shared tags reported");
      sharedSection.append(shared);
      item.append(sharedSection);
      if (neighbor.proposedTags.length) {
        const proposedSection = node("section", { className: "neighbor-section" });
        proposedSection.append(node("h5", { text: "Neighbor proposed tags" }));
        const proposed = node("div", { className: "tag-row" });
        renderTags(proposed, neighbor.proposedTags, "No tags");
        proposedSection.append(proposed);
        item.append(proposedSection);
      }
      if (neighbor.reasons.length) item.append(listSection("Retrieval evidence", neighbor.reasons));

      const ratings = node("div", { className: "neighbor-ratings" });
      const currentRating = state.similarity.ratings.get(judgementKey) || "";
      NEIGHBOR_RATINGS.forEach(([rating, label]) => {
        ratings.append(
          node("button", {
            className: "neighbor-rating-button",
            text: label,
            attrs: {
              type: "button",
              "data-neighbor-id": neighbor.id,
              "data-rating": rating,
              "aria-pressed": String(currentRating === rating),
            },
          }),
        );
      });
      ratings.append(
        node("p", {
          className: "neighbor-rating-status",
          text: currentRating ? `Saved judgment: ${humanize(currentRating)}` : "No teacher judgment saved.",
          attrs: { "data-rating-status": neighbor.id, role: "status", "aria-live": "polite" },
        }),
      );
      item.append(ratings);
      cards.append(item);
    });
    setText(
      "neighbor-results-summary",
      `${formatNumber(payload.neighbors.length)} candidates · ${humanize(payload.view)} view`,
    );
    byId("similarity-loading").hidden = true;
    byId("similarity-empty").hidden = true;
    byId("similarity-results").hidden = false;
    byId("neighbors-none").hidden = payload.neighbors.length !== 0;
  }

  async function loadNeighbors() {
    const anchorId = byId("similarity-anchor-id").value.trim();
    const view = byId("similarity-view-select").value;
    const limit = integer(byId("similarity-limit").value, 12);
    if (!anchorId) {
      state.similarity.payload = null;
      byId("similarity-results").hidden = true;
      byId("similarity-empty").hidden = false;
      setInlineError("similarity-error", "Choose or enter an anchor question ID first.");
      return;
    }
    state.similarity.anchorId = anchorId;
    state.similarity.view = view;
    state.similarity.limit = limit;
    updateUrl();
    setInlineError("similarity-error");
    byId("similarity-empty").hidden = true;
    byId("similarity-results").hidden = true;
    byId("similarity-loading").hidden = false;
    const token = ++state.similarity.requestToken;
    const url = new URL(`${API.items}/${encodeURIComponent(anchorId)}/neighbors`, window.location.origin);
    url.searchParams.set("view", view);
    url.searchParams.set("limit", String(limit));
    try {
      const { payload } = await requestJson(url);
      if (token !== state.similarity.requestToken) return;
      state.similarity.payload = normalizeNeighborsPayload(payload);
      if (!state.similarity.payload.anchor.id) state.similarity.payload.anchor.id = anchorId;
      renderSimilarity();
      announce(`Loaded ${state.similarity.payload.neighbors.length} candidate neighbors.`);
    } catch (error) {
      if (token !== state.similarity.requestToken) return;
      byId("similarity-loading").hidden = true;
      setInlineError("similarity-error", `Neighbors could not be loaded: ${error.message}`);
    }
  }

  async function saveNeighborRating(neighborId, rating) {
    if (!neighborId || !rating || !state.similarity.anchorId) return;
    const anchorId = state.similarity.anchorId;
    const view = state.similarity.view;
    const retrievalVersion = state.similarity.payload?.retrievalVersion || "";
    const judgementKey = similarityJudgementKey(
      anchorId,
      retrievalVersion,
      view,
      neighborId,
    );
    const card = document.querySelector(`[data-neighbor-id="${CSS.escape(neighborId)}"].neighbor-card`);
    if (!card) return;
    const buttons = [...card.querySelectorAll(".neighbor-rating-button")];
    const status = card.querySelector(".neighbor-rating-status");
    buttons.forEach((button) => (button.disabled = true));
    status.classList.remove("is-error");
    status.textContent = "Saving teacher judgment…";
    try {
      const { payload, response } = await requestJson(
        `${API.items}/${encodeURIComponent(anchorId)}/neighbors/${encodeURIComponent(neighborId)}/review`,
        {
          method: "PUT",
          headers: { "If-Match": state.similarity.etags.get(judgementKey) || "*" },
          body: JSON.stringify({ rating, view }),
        },
      );
      const returned = asRecord(payload);
      const savedRating = stringValue(firstDefined(returned.rating, asRecord(returned.review).rating), rating);
      state.similarity.ratings.set(judgementKey, savedRating);
      const etag = response.headers.get("ETag") || stringValue(firstDefined(returned.etag, asRecord(returned.review).etag));
      if (etag) state.similarity.etags.set(judgementKey, etag);
      buttons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.rating === savedRating));
      });
      status.textContent = `Saved judgment: ${humanize(savedRating)}`;
      announce(`Similarity judgment saved for ${neighborId}.`);
    } catch (error) {
      status.classList.add("is-error");
      status.textContent =
        error.status === 404 || error.status === 405
          ? "Not saved: the local service has not enabled similarity judgments yet."
          : `Not saved: ${error.message}`;
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  }

  function recentItemIds() {
    return [
      ...new Set(
        byId("recommendation-recent-items")
          .value.split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
  }

  function normalizeRecommendation(value, index) {
    const record = asRecord(value);
    const comparable = normalizeComparable(record);
    const componentAudit = Object.fromEntries(
      Object.entries(asRecord(record.components))
        .map(([key, rawComponent]) => {
          const component = asRecord(rawComponent);
          return [
            key,
            {
              value: finiteNumber(component.value),
              weight: finiteNumber(component.weight),
              contribution: finiteNumber(component.contribution),
            },
          ];
        })
        .filter(([, component]) => Number.isFinite(component.value)),
    );
    const scores = asRecord(
      firstDefined(record.score_breakdown, record.score_components, record.scores),
    );
    return {
      ...comparable,
      rank: integer(firstDefined(record.rank, index + 1), index + 1),
      eligible: Boolean(firstDefined(record.eligible, record.is_eligible, true)),
      score: score01(firstDefined(record.score, record.total_score, record.rank_score)),
      scores: Object.fromEntries(
        Object.entries(scores)
          .filter(([, score]) => Number.isFinite(Number(score)))
          .map(([key, score]) => [key, score01(score)]),
      ),
      reasons: textList(firstDefined(record.reasons, record.explanations, record.evidence)),
      blockers: textList(firstDefined(record.blockers, record.ineligibility_reasons)),
      componentAudit,
      predictedSuccess: finiteNumber(record.predicted_success, Number.NaN),
      evidenceStatus: stringValue(record.evidence_status),
    };
  }

  function normalizeRecommendationPayload(payload, requestBody) {
    const root = Array.isArray(payload) ? { slate: payload } : asRecord(payload);
    return {
      context: { ...requestBody, ...asRecord(firstDefined(root.context, root.request, root.inputs)) },
      policyVersion: stringValue(
        firstDefined(root.policy_version, asRecord(root.context).policy_version, root.version),
      ),
      summary: stringValue(firstDefined(root.summary, root.message)),
      excludedCount: integer(firstDefined(root.excluded_count, root.blocked_count)),
      exclusionReasonCounts: countMap(
        firstDefined(root.exclusion_reason_counts, root.exclusion_reasons),
      ),
      warnings: textList(root.warnings),
      slate: asArray(firstDefined(root.slate, root.recommendations, root.items, root.results)).map(
        normalizeRecommendation,
      ),
    };
  }

  function recommendationSection(title, values, className) {
    const section = node("section", { className: "recommendation-section" });
    section.append(node("h5", { text: title }));
    const list = node("ul", { className });
    (values.length ? values : ["None reported."]).forEach((value) => list.append(node("li", { text: value })));
    section.append(list);
    return section;
  }

  function policyScoreBreakdown(components, fallbackScores, totalScore) {
    const entries = Object.entries(components);
    if (!entries.length) return scoreBreakdown(fallbackScores, totalScore);
    const container = node("dl", { className: "score-breakdown policy-score-breakdown" });
    entries.forEach(([label, component]) => {
      const contribution = finiteNumber(component.contribution);
      const row = node("div", { className: "score-row policy-score-row" });
      row.append(
        node("span", { text: humanize(label) }),
        node("span", {
          className: "component-formula",
          text: `${finiteNumber(component.value).toFixed(2)} × ${finiteNumber(component.weight).toFixed(2)}`,
        }),
        node("strong", {
          text: `${contribution >= 0 ? "+" : ""}${contribution.toFixed(3)}`,
          attrs: {
            "aria-label": `${humanize(label)} contribution ${contribution.toFixed(3)}`,
          },
        }),
      );
      container.append(row);
    });
    return container;
  }

  function renderRecommendations() {
    const payload = state.recommendation.payload;
    if (!payload) return;
    const context = byId("recommendation-context");
    context.replaceChildren();
    [
      payload.policyVersion && `Policy ${payload.policyVersion}`,
      payload.context.target_skill_id && `Skill ${payload.context.target_skill_id}`,
      payload.context.target_item_id && `Target question ${payload.context.target_item_id}`,
      payload.context.grade && `Grade ${payload.context.grade}`,
      payload.context.mode && humanize(payload.context.mode),
      `Mastery ${finiteNumber(payload.context.mastery).toFixed(2)}`,
      `Uncertainty ${finiteNumber(payload.context.uncertainty).toFixed(2)}`,
      `${asArray(payload.context.recent_item_ids).length} recent IDs`,
      ...payload.warnings.map((warning) => `Warning: ${warning}`),
      ...Object.entries(payload.exclusionReasonCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([reason, count]) => `Excluded · ${humanize(reason)}: ${formatNumber(count)}`),
    ]
      .filter(Boolean)
      .forEach((value) => context.append(node("span", { text: value })));

    const cards = byId("recommendation-cards");
    cards.replaceChildren();
    payload.slate.forEach((recommendation) => {
      const item = node("li", {
        className: "recommendation-card",
        attrs: { "data-item-id": recommendation.id, "data-testid": "recommendation-card" },
      });
      const main = node("div", { className: "recommendation-card-main" });
      const header = node("header", { className: "recommendation-card-header" });
      const identity = node("div");
      identity.append(node("h4", { text: `#${recommendation.rank} · ${recommendation.id || "Candidate"}` }));
      if (recommendation.source) identity.append(node("code", { text: recommendation.source }));
      header.append(
        identity,
        node("span", {
          className: `eligibility-badge ${recommendation.eligible ? "is-eligible" : "is-blocked"}`,
          text: recommendation.eligible ? "✓ Eligible" : "× Blocked",
        }),
      );
      main.append(header, node("p", { className: "recommendation-prompt", text: recommendation.prompt }));
      const metadata = [recommendation.grade && humanize(recommendation.grade), recommendation.domain && humanize(recommendation.domain), recommendation.questionType && humanize(recommendation.questionType)]
        .filter(Boolean)
        .join(" · ");
      if (metadata) main.append(node("p", { className: "recommendation-meta", text: metadata }));
      const actions = node("div", { className: "recommendation-card-actions" });
      actions.append(
        node("button", {
          className: "button button-secondary inspect-recommendation",
          text: "Review question",
          attrs: { type: "button", "data-item-id": recommendation.id },
        }),
      );
      main.append(actions);

      const evidence = node("div", { className: "recommendation-card-evidence" });
      const auditBadges = node("div", { className: "recommendation-audit-badges" });
      auditBadges.append(
        node("span", {
          className: "score-badge",
          text: `Rank score ${recommendation.score.toFixed(2)}`,
        }),
      );
      if (Number.isFinite(recommendation.predictedSuccess)) {
        auditBadges.append(
          node("span", {
            className: "score-badge",
            text: `Predicted success ${recommendation.predictedSuccess.toFixed(2)}`,
          }),
        );
      }
      if (recommendation.evidenceStatus) {
        auditBadges.append(
          node("span", {
            className: "score-badge",
            text: `Evidence ${humanize(recommendation.evidenceStatus)}`,
          }),
        );
      }
      evidence.append(
        auditBadges,
        policyScoreBreakdown(
          recommendation.componentAudit,
          recommendation.scores,
          recommendation.score,
        ),
        recommendationSection("Why it ranked here", recommendation.reasons, "reason-list"),
      );
      if (recommendation.blockers.length || !recommendation.eligible) {
        evidence.append(
          recommendationSection("Eligibility blockers", recommendation.blockers, "blocker-list"),
        );
      }
      item.append(main, evidence);
      cards.append(item);
    });
    const eligible = payload.slate.filter((entry) => entry.eligible).length;
    setText(
      "recommendation-summary",
      payload.summary ||
        `${formatNumber(payload.slate.length)} ranked · ${formatNumber(eligible)} eligible${
          payload.excludedCount ? ` · ${formatNumber(payload.excludedCount)} excluded before ranking` : ""
        }`,
    );
    byId("recommendation-loading").hidden = true;
    byId("recommendation-empty").hidden = true;
    byId("recommendation-results").hidden = false;
    byId("recommendations-none").hidden = payload.slate.length !== 0;
  }

  async function previewRecommendations() {
    const targetSkillId = byId("recommendation-skill").value;
    if (!targetSkillId) {
      setInlineError("recommendation-error", "Choose a target skill before previewing a slate.");
      byId("recommendation-skill").focus();
      return;
    }
    const body = {
      target_skill_id: targetSkillId,
      target_item_id: byId("recommendation-target-item").value.trim() || undefined,
      grade: byId("recommendation-grade").value,
      recent_item_ids: recentItemIds(),
      mastery: finiteNumber(byId("recommendation-mastery").value, 0.5),
      uncertainty: finiteNumber(byId("recommendation-uncertainty").value, 0.5),
      mode: byId("recommendation-mode").value,
    };
    setInlineError("recommendation-error");
    byId("recommendation-empty").hidden = true;
    byId("recommendation-results").hidden = true;
    byId("recommendation-loading").hidden = false;
    byId("preview-recommendations").disabled = true;
    const token = ++state.recommendation.requestToken;
    try {
      const { payload } = await requestJson(API.recommendations, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (token !== state.recommendation.requestToken) return;
      state.recommendation.payload = normalizeRecommendationPayload(payload, body);
      renderRecommendations();
      announce(`Previewed ${state.recommendation.payload.slate.length} recommendation candidates.`);
    } catch (error) {
      if (token !== state.recommendation.requestToken) return;
      byId("recommendation-loading").hidden = true;
      byId("recommendation-empty").hidden = false;
      setInlineError(
        "recommendation-error",
        error.status === 404 || error.status === 405
          ? "The local service has not enabled recommendation previews yet. No learner state was changed."
          : `Recommendation preview failed: ${error.message}`,
      );
    } finally {
      byId("preview-recommendations").disabled = false;
    }
  }

  function inspectQuestion(id) {
    if (!id) return;
    FILTER_KEYS.forEach((key) => (state.filters[key] = ""));
    state.filters.q = id;
    state.items.offset = 0;
    state.items.detailId = id;
    state.items.loaded = false;
    syncControlsFromState();
    setActiveView("questions", { focus: true });
    loadItems({ preferredId: id, focusDetail: true });
  }

  function clearFilters() {
    FILTER_KEYS.forEach((key) => (state.filters[key] = ""));
    state.items.offset = 0;
    state.items.detailId = "";
    syncControlsFromState();
    loadItems();
  }

  function bindProblemMapEvents() {
    const canvas = byId("problem-map-canvas");
    if ("ResizeObserver" in window) {
      state.problemSpace.resizeObserver = new ResizeObserver(() => drawProblemMap());
      state.problemSpace.resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", drawProblemMap);
    }

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      hideProblemMapCandidates();
      canvas.setPointerCapture(event.pointerId);
      state.problemSpace.drag = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
    });
    canvas.addEventListener("pointermove", (event) => {
      const drag = state.problemSpace.drag;
      if (drag?.pointerId === event.pointerId) {
        const deltaX = event.clientX - drag.x;
        const deltaY = event.clientY - drag.y;
        state.problemSpace.panX += deltaX;
        state.problemSpace.panY += deltaY;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) > 6) {
          drag.moved = true;
        }
        drawProblemMap();
        return;
      }
      if (problemMapShowsQuestions()) {
        const point = nearestProblemMapPoint(event.clientX, event.clientY);
        const nextId = point?.id || "";
        if (
          state.problemSpace.hoveredPointId === nextId &&
          !state.problemSpace.hoveredClusterId
        ) {
          return;
        }
        state.problemSpace.hoveredClusterId = "";
        state.problemSpace.hoveredPointId = nextId;
        setProblemMapPointDetail(nextId || state.problemSpace.focusedPointId);
      } else {
        const cluster = nearestProblemMapCluster(event.clientX, event.clientY);
        const nextId = cluster?.id || "";
        if (
          state.problemSpace.hoveredClusterId === nextId &&
          !state.problemSpace.hoveredPointId
        ) {
          return;
        }
        state.problemSpace.hoveredPointId = "";
        state.problemSpace.hoveredClusterId = nextId;
        setProblemMapClusterDetail(nextId || state.problemSpace.focusedClusterId);
      }
      drawProblemMap();
    });
    canvas.addEventListener("pointerup", (event) => {
      const drag = state.problemSpace.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      state.problemSpace.drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (drag.moved) return;
      if (!problemMapShowsQuestions()) {
        const cluster = nearestProblemMapCluster(event.clientX, event.clientY);
        if (cluster) focusProblemMapCluster(cluster.id);
        return;
      }
      const candidates = problemMapPointsNear(event.clientX, event.clientY, 18);
      if (candidates.length > 1) {
        showProblemMapCandidates(candidates);
        return;
      }
      const point = candidates[0];
      if (!point) return;
      state.problemSpace.focusedPointId = point.id;
      centerProblemMapOnPoint(point.id);
      exploreProblemQuestion(point.id);
    });
    canvas.addEventListener("pointercancel", () => {
      state.problemSpace.drag = null;
    });
    canvas.addEventListener("pointerleave", () => {
      if (state.problemSpace.drag) return;
      state.problemSpace.hoveredPointId = "";
      state.problemSpace.hoveredClusterId = "";
      if (problemMapShowsQuestions()) {
        setProblemMapPointDetail(state.problemSpace.focusedPointId);
      } else {
        setProblemMapClusterDetail(state.problemSpace.focusedClusterId);
      }
      drawProblemMap();
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        zoomProblemMap(
          event.deltaY < 0 ? 1.16 : 1 / 1.16,
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      },
      { passive: false },
    );
    canvas.addEventListener("focus", () => {
      if (problemMapShowsQuestions()) {
        if (!state.problemSpace.focusedPointId) {
          state.problemSpace.focusedPointId = state.problemSpace.visiblePoints[0]?.id || "";
        }
        setProblemMapPointDetail(state.problemSpace.focusedPointId, {
          announceChange: true,
        });
      } else {
        const clusters = visibleProblemClusters();
        if (!clusters.some((cluster) => cluster.id === state.problemSpace.focusedClusterId)) {
          state.problemSpace.focusedClusterId = clusters[0]?.id || "";
        }
        setProblemMapClusterDetail(state.problemSpace.focusedClusterId, {
          announceChange: true,
        });
      }
      drawProblemMap();
    });
    canvas.addEventListener("keydown", (event) => {
      const directions = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      if (directions[event.key]) {
        event.preventDefault();
        if (problemMapShowsQuestions()) moveProblemMapFocus(directions[event.key]);
        else moveProblemMapClusterFocus(directions[event.key]);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!problemMapShowsQuestions() && state.problemSpace.focusedClusterId) {
          focusProblemMapCluster(state.problemSpace.focusedClusterId);
        } else if (state.problemSpace.focusedPointId) {
          exploreProblemQuestion(state.problemSpace.focusedPointId);
        }
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomProblemMap(1.2);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomProblemMap(1 / 1.2);
      } else if (event.key === "0") {
        event.preventDefault();
        resetProblemMap();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (problemMapShowsQuestions()) {
          const points = state.problemSpace.visiblePoints;
          const point = event.key === "Home" ? points[0] : points.at(-1);
          if (point) {
            state.problemSpace.focusedPointId = point.id;
            centerProblemMapOnPoint(point.id);
            setProblemMapPointDetail(point.id, { announceChange: true });
          }
        } else {
          const clusters = visibleProblemClusters();
          const cluster = event.key === "Home" ? clusters[0] : clusters.at(-1);
          if (cluster) {
            state.problemSpace.focusedClusterId = cluster.id;
            setProblemMapClusterDetail(cluster.id, { announceChange: true });
            drawProblemMap();
          }
        }
      }
    });
  }

  function bindEvents() {
    document.querySelectorAll(".view-tab").forEach((tab) => {
      tab.addEventListener("click", () => setActiveView(tab.dataset.view));
    });
    byId("overview-tab").parentElement.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = VIEWS.indexOf(state.activeView);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? VIEWS.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
      setActiveView(VIEWS[next], { focus: true });
    });
    byId("retry-request").addEventListener("click", () => state.retry?.());
    byId("continue-review").addEventListener("click", () => setActiveView("questions", { focus: true }));
    byId("open-promotion").addEventListener("click", () => setActiveView("promotion", { focus: true }));
    byId("source-crop").addEventListener("error", () => {
      byId("source-crop").hidden = true;
      byId("source-crop-missing").hidden = false;
    });
    byId("source-crop").addEventListener("load", () => {
      byId("source-crop").hidden = false;
      byId("source-crop-missing").hidden = true;
    });
    byId("open-similarity-item").addEventListener("click", () => {
      if (!state.items.detailId) return;
      state.similarity.anchorId = state.items.detailId;
      state.similarity.payload = null;
      byId("similarity-anchor-id").value = state.items.detailId;
      setActiveView("similarity", { focus: true });
    });
    byId("problem-space-search").addEventListener("submit", (event) => {
      event.preventDefault();
      exploreProblemQuery();
    });
    byId("problem-space-random").addEventListener("click", exploreRandomProblemQuestion);
    byId("problem-space-view-select").addEventListener("change", async (event) => {
      const requestedView = event.target.value;
      cancelProblemSearchRequest();
      state.problemSpace.neighborhoodRequestToken += 1;
      state.problemSpace.view = requestedView;
      state.problemSpace.mapPayload = null;
      setText(
        "problem-space-query-note",
        requestedView === "tag"
          ? "Proposed-tag evidence requires a stable question ID. Pasted text will fall back to Surface similarity."
          : "Pasted text can use Surface or Hybrid evidence. Proposed-tag evidence requires a stable question ID.",
      );
      if (state.problemSpace.anchorId) {
        byId("problem-neighborhood-content").hidden = true;
        byId("problem-selected-empty").hidden = true;
        byId("problem-neighbor-loading").hidden = false;
      }
      updateUrl();
      await loadProblemMap({ force: true });
      if (state.problemSpace.view !== requestedView) return;
      if (state.problemSpace.anchorId) {
        await exploreProblemQuestion(state.problemSpace.anchorId, {
          replaceCurrent: true,
        });
      } else {
        restoreCommittedProblemNeighborhood();
      }
    });
    [
      "problem-map-grade",
      "problem-map-points",
      "problem-map-domain",
      "problem-map-type",
    ].forEach((id) => {
      byId(id).addEventListener("change", () => {
        state.problemSpace.filters.grade = byId("problem-map-grade").value;
        state.problemSpace.filters.points = byId("problem-map-points").value;
        state.problemSpace.filters.domain = byId("problem-map-domain").value;
        state.problemSpace.filters.questionType = byId("problem-map-type").value;
        applyProblemMapFilters({ announceChange: true });
      });
    });
    byId("problem-map-clear-filters").addEventListener("click", () => {
      state.problemSpace.filters = {
        grade: "",
        points: "",
        domain: "",
        questionType: "",
      };
      byId("problem-map-grade").value = "";
      byId("problem-map-points").value = "";
      byId("problem-map-domain").value = "";
      byId("problem-map-type").value = "";
      applyProblemMapFilters({ announceChange: true });
    });
    byId("problem-space-view").addEventListener("click", (event) => {
      const mapCandidateButton = event.target.closest(
        "[data-problem-map-candidate-id]",
      );
      if (mapCandidateButton) {
        const id = mapCandidateButton.dataset.problemMapCandidateId;
        hideProblemMapCandidates();
        centerProblemMapOnPoint(id);
        exploreProblemQuestion(id);
        return;
      }
      const clusterButton = event.target.closest("[data-problem-cluster-id]");
      if (clusterButton) {
        focusProblemMapCluster(clusterButton.dataset.problemClusterId);
        return;
      }
      const itemButton = event.target.closest("[data-problem-item-id]");
      if (itemButton) {
        exploreProblemQuestion(itemButton.dataset.problemItemId);
        return;
      }
      const trailButton = event.target.closest("[data-problem-trail-index]");
      if (trailButton) navigateProblemTrail(integer(trailButton.dataset.problemTrailIndex));
    });
    byId("problem-trail-back").addEventListener("click", () => {
      navigateProblemTrail(state.problemSpace.trailIndex - 1);
    });
    byId("problem-trail-forward").addEventListener("click", () => {
      navigateProblemTrail(state.problemSpace.trailIndex + 1);
    });
    byId("problem-review-selected").addEventListener("click", () => {
      const selectedId =
        state.activeView === "world"
          ? window.CatalogueWorldQA?.currentItemId?.()
          : state.problemSpace.anchorId;
      if (selectedId) inspectQuestion(selectedId);
    });
    byId("problem-map-center-selected").addEventListener(
      "click",
      centerSelectedProblemMapPoint,
    );
    byId("problem-map-zoom-out").addEventListener("click", () => zoomProblemMap(1 / 1.2));
    byId("problem-map-zoom-in").addEventListener("click", () => zoomProblemMap(1.2));
    byId("problem-map-pan-left").addEventListener("click", () => {
      state.problemSpace.panX -= 70;
      drawProblemMap();
    });
    byId("problem-map-pan-right").addEventListener("click", () => {
      state.problemSpace.panX += 70;
      drawProblemMap();
    });
    byId("problem-map-pan-up").addEventListener("click", () => {
      state.problemSpace.panY -= 70;
      drawProblemMap();
    });
    byId("problem-map-pan-down").addEventListener("click", () => {
      state.problemSpace.panY += 70;
      drawProblemMap();
    });
    byId("problem-map-reset").addEventListener("click", resetProblemMap);
    bindProblemMapEvents();
    byId("use-curriculum-target").addEventListener("click", () => {
      if (!state.items.detailId) return;
      byId("recommendation-target-item").value = state.items.detailId;
      state.recommendation.payload = null;
      byId("recommendation-results").hidden = true;
      byId("recommendation-empty").hidden = false;
      setActiveView("curriculum", { focus: true });
      byId("recommendation-skill").focus();
    });
    byId("catalogue-filters").addEventListener("submit", (event) => event.preventDefault());
    let searchTimer = 0;
    byId("catalogue-filters").addEventListener("input", (event) => {
      if (event.target.name !== "q") return;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        readFilters();
        loadItems();
      }, 280);
    });
    byId("catalogue-filters").addEventListener("change", (event) => {
      if (event.target.name === "q") return;
      readFilters();
      loadItems();
    });
    byId("clear-filters").addEventListener("click", clearFilters);
    byId("page-previous").addEventListener("click", () => {
      state.items.offset = Math.max(0, state.items.offset - state.items.limit);
      state.items.detailId = "";
      loadItems({ focusDetail: true });
    });
    byId("page-next").addEventListener("click", () => {
      state.items.offset += state.items.limit;
      state.items.detailId = "";
      loadItems({ focusDetail: true });
    });
    byId("teacher-review-form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveReview(event.submitter?.dataset.advance === "true");
    });
    byId("teacher-review-form").addEventListener("input", () => {
      const saved = byId("review-saved-state");
      saved.textContent = "Unsaved changes";
      saved.classList.remove("is-saved");
    });
    byId("taxonomy-search").addEventListener("input", filterTaxonomy);
    byId("taxonomy-skill-select").addEventListener("change", (event) => {
      renderSkillInspector(event.target.value);
    });
    byId("selected-skill-examples").addEventListener("click", (event) => {
      const button = event.target.closest(".skill-example-button");
      if (button) inspectQuestion(button.dataset.itemId);
    });
    byId("taxonomy-skill-review").addEventListener("input", () => {
      const saved = byId("skill-review-saved-state");
      saved.textContent = "Unsaved changes";
      saved.classList.remove("is-saved");
    });
    byId("taxonomy-skill-review").addEventListener("submit", (event) => {
      event.preventDefault();
      saveSkillReview();
    });
    byId("review-blocked-items").addEventListener("click", () => {
      state.filters.promotion_state = "blocked";
      state.items.offset = 0;
      state.items.loaded = false;
      syncControlsFromState();
      setActiveView("questions", { focus: true });
    });
    byId("review-ready-items").addEventListener("click", () => {
      state.filters.promotion_state = "curriculum_ready";
      state.items.offset = 0;
      state.items.loaded = false;
      syncControlsFromState();
      setActiveView("questions", { focus: true });
    });
    byId("similarity-controls").addEventListener("submit", (event) => {
      event.preventDefault();
      loadNeighbors();
    });
    byId("neighbor-cards").addEventListener("click", (event) => {
      const button = event.target.closest(".neighbor-rating-button");
      if (button) saveNeighborRating(button.dataset.neighborId, button.dataset.rating);
    });
    byId("recommendation-form").addEventListener("submit", (event) => {
      event.preventDefault();
      previewRecommendations();
    });
    ["recommendation-mastery", "recommendation-uncertainty"].forEach((id) => {
      byId(id).addEventListener("input", () => {
        const outputId = id === "recommendation-mastery" ? "mastery-output" : "uncertainty-output";
        setText(outputId, finiteNumber(byId(id).value).toFixed(2));
      });
    });
    byId("recommendation-cards").addEventListener("click", (event) => {
      const button = event.target.closest(".inspect-recommendation");
      if (button) inspectQuestion(button.dataset.itemId);
    });
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if (event.key === "/" && !editable) {
        event.preventDefault();
        setActiveView("questions");
        byId("filter-q").focus();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
        if (state.activeView !== "questions" || !state.items.detail) return;
        event.preventDefault();
        saveReview(event.shiftKey);
      }
    });
  }

  async function initialize() {
    readUrlState();
    syncControlsFromState();
    bindEvents();
    setConnection("loading", "Connecting…");
    setActiveView(state.activeView);
    await Promise.allSettled([loadSummary(), loadTaxonomy()]);
  }

  initialize();
})();
