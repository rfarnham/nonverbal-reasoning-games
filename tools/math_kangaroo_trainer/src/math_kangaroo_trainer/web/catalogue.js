(() => {
  "use strict";

  const API = Object.freeze({
    summary: "/api/catalogue/summary",
    items: "/api/catalogue/items",
    taxonomy: "/api/catalogue/taxonomy",
    export: "/api/catalogue/export",
    recommendations: "/api/catalogue/recommendations/preview",
  });

  const VIEWS = Object.freeze([
    "overview",
    "taxonomy",
    "similarity",
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
  const gradeRangeValue = (value) => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    const range = asRecord(value);
    const minimum = firstDefined(range.min, range.minimum, range.from);
    const maximum = firstDefined(range.max, range.maximum, range.to);
    if (minimum !== undefined && maximum !== undefined) return `${minimum}–${maximum}`;
    return "";
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
    window.history.replaceState(null, "", url);
  }

  function readUrlState() {
    const params = new URL(window.location.href).searchParams;
    const view = params.get("view");
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
  }

  function setActiveView(view, { focus = false } = {}) {
    if (!VIEWS.includes(view)) return;
    state.activeView = view;
    document.querySelectorAll(".view-tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    VIEWS.forEach((name) => {
      byId(`${name}-view`).hidden = name !== view;
    });
    updateUrl();
    if (focus) byId(`${view}-tab`).focus();
    if (view === "questions" && !state.items.loaded) loadItems();
    if (view === "similarity") {
      if (state.similarity.anchorId && !state.similarity.payload) loadNeighbors();
      else if (!state.similarity.anchorId) byId("similarity-empty").hidden = false;
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
    return {
      id: itemId(merged),
      contentVersion: stringValue(firstDefined(merged.content_version, merged.version)),
      source,
      sourceLine: sourceLabel(Object.keys(source).length ? source : merged.source_label),
      prompt: stringValue(firstDefined(merged.prompt, merged.prompt_text, merged.question_text)),
      choices: normalizeChoices(firstDefined(merged.choices, merged.answer_choices, merged.options)),
      answer,
      warnings: textList(firstDefined(merged.warnings, merged.source_warnings, merged.review_flags)),
      gaps: textList(firstDefined(merged.gaps, merged.content_gaps, merged.missing_content)),
      proposal,
      promotion,
      blockers: textList(firstDefined(merged.blockers, promotion.blockers)),
      review,
      cropUrl: safeSameOriginUrl(
        firstDefined(merged.source_crop_url, source.crop_url, source.source_crop_url),
      ),
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
        return stringValue(firstDefined(record.label, record.name, record.id, record.value, record.tag_id));
      })
      .filter(Boolean);
  }

  function score01(value) {
    const score = finiteNumber(value, 0);
    if (score > 1 && score <= 100) return score / 100;
    return Math.min(1, Math.max(0, score));
  }

  function normalizeComparable(value) {
    const record = asRecord(value);
    const proposed = asRecord(firstDefined(record.proposal, record.classification_proposal));
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
      grade: stringValue(firstDefined(record.grade, record.grade_band)),
      domain: stringValue(firstDefined(record.primary_domain, proposed.primary_domain)),
      questionType: stringValue(firstDefined(record.question_type, proposed.question_type)),
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
    state.filters.q = id;
    state.items.offset = 0;
    state.items.detailId = id;
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
