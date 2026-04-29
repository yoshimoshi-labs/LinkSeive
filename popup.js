/**
 * popup.js — LinkSieve popup UI
 *
 * Architecture
 * ────────────
 * DOM      — all element references in one object (easy to audit / rename)
 * state    — all mutable data in one object (no scattered globals)
 * Storage  — load() / save() are the only places that touch chrome.storage
 * Actions  — pure-ish mutations on `state` (addCompany, removeCompany, …)
 * Render   — functions that read `state` + `DOM` and update the DOM
 * Builders — functions that create DOM nodes (chips, empty states)
 * Events   — all addEventListener calls in init(), wired once at startup
 */

// ── DOM references ─────────────────────────────────────────────────────────
// Group every element the popup touches so the rest of the code never calls
// document.getElementById() directly.

var DOM = {
  enabledToggle:     document.getElementById('enabled-toggle'),
  hideAppliedToggle: document.getElementById('hide-applied-toggle'),
  statusCard:        document.getElementById('status-card'),
  statusSubtitle:    document.getElementById('status-subtitle'),
  filtersSection:    document.getElementById('filters-section'),
  companiesSection:  document.getElementById('companies-section'),
  countBadge:        document.getElementById('count-badge'),
  input:             document.getElementById('company-input'),
  blockBtn:          document.getElementById('block-btn'),
  clearBtn:          document.getElementById('clear-btn'),
  alreadyBadge:      document.getElementById('already-blocked-badge'),
  chipCloud:         document.getElementById('chip-cloud'),
  undoFooter:        document.getElementById('undo-footer'),
  undoText:          document.getElementById('undo-text'),
  undoBtn:           document.getElementById('undo-btn'),
  undoClose:         document.getElementById('undo-close'),
};

// ── State ──────────────────────────────────────────────────────────────────
// Single source of truth for all runtime data.  Render functions read this;
// action functions write to it then call the relevant render function(s).

var state = {
  blocklist:       [],    // array of company name strings (original casing)
  draft:           '',    // current value of the search/add input field
  recentlyRemoved: null,  // company name eligible for undo, or null
};

// ── Storage ────────────────────────────────────────────────────────────────

/** Reads persisted settings and initialises the UI on popup open. */
function load() {
  chrome.storage.sync.get(['blocklist', 'hideApplied', 'extensionEnabled'], function (data) {
    state.blocklist = data.blocklist || [];
    DOM.hideAppliedToggle.checked = !!data.hideApplied;
    DOM.enabledToggle.checked = data.extensionEnabled !== false;
    renderAll();
  });
}

/** Persists the current blocklist and refreshes the status card. */
function save() {
  chrome.storage.sync.set({ blocklist: state.blocklist });
  renderStatus();
}

// ── Actions ────────────────────────────────────────────────────────────────

/** Adds the current draft value to the blocklist (no-op on empty or duplicate). */
function addCompany() {
  var name = state.draft.trim();
  if (!name || isDuplicate(name)) return;

  state.blocklist.unshift(name);
  state.draft = '';
  DOM.input.value = '';

  save();
  renderChips();
  renderInputUI();
  DOM.input.focus();
}

/** Removes a company from the blocklist and queues it for one-step undo. */
function removeCompany(company) {
  state.blocklist = state.blocklist.filter(function (c) { return c !== company; });
  state.recentlyRemoved = company;
  save();
  renderChips();
  showUndo(company);
}

/** Restores the last removed company (used by the undo button). */
function undoRemove() {
  if (!state.recentlyRemoved) return;
  state.blocklist.unshift(state.recentlyRemoved);
  state.recentlyRemoved = null;
  save();
  hideUndo();
  renderChips();
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns true when `name` already exists in the blocklist (case-insensitive). */
function isDuplicate(name) {
  var lower = name.toLowerCase();
  return state.blocklist.some(function (c) { return c.toLowerCase() === lower; });
}

/** Escapes a string for safe insertion into innerHTML. */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Renderers ──────────────────────────────────────────────────────────────

/** Convenience: runs all render functions.  Called after the initial load. */
function renderAll() {
  renderStatus();
  renderChips();
  renderInputUI();
}

/**
 * Updates the status card gradient, subtitle text, and the "dimmed" state of
 * the filters and companies sections based on the enabled toggle.
 */
function renderStatus() {
  var enabled = DOM.enabledToggle.checked;
  var n = state.blocklist.length;

  DOM.statusCard.style.background = enabled
    ? 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)'
    : '#0f1419';

  DOM.statusSubtitle.textContent = enabled
    ? 'Blocking ' + n + ' compan' + (n === 1 ? 'y' : 'ies')
    : 'Filtering paused — all jobs visible';

  DOM.filtersSection.classList.toggle('dimmed', !enabled);
  DOM.companiesSection.classList.toggle('dimmed', !enabled);
}

/**
 * Re-renders the chip cloud.
 *
 * When a search query is active in `state.draft`, only matching companies are
 * shown and the matching substring is highlighted with <mark>.
 * When no query is active, all blocked companies are shown.
 */
function renderChips() {
  var q  = state.draft.trim();
  var ql = q.toLowerCase();

  var visible = q
    ? state.blocklist.filter(function (c) { return c.toLowerCase().includes(ql); })
    : state.blocklist;

  DOM.countBadge.textContent = state.blocklist.length;
  DOM.chipCloud.innerHTML = '';

  if (state.blocklist.length === 0) {
    DOM.chipCloud.appendChild(makeEmptyState('No companies blocked yet'));
    return;
  }

  if (visible.length === 0) {
    DOM.chipCloud.appendChild(makeNoMatchState(q, isDuplicate(q)));
    return;
  }

  visible.forEach(function (company) {
    DOM.chipCloud.appendChild(makeChip(company, q));
  });
}

/**
 * Updates the input row controls:
 *   - Clear (×) button     — visible when there is any input
 *   - "Already blocked"    — visible when the draft exactly matches an entry
 *   - Block button         — visible when the draft is new and non-empty
 */
function renderInputUI() {
  var q      = state.draft.trim();
  var exists = q.length > 0 && isDuplicate(q);
  var canAdd = q.length > 0 && !exists;

  DOM.clearBtn.classList.toggle('hidden', state.draft.length === 0);
  DOM.alreadyBadge.classList.toggle('hidden', !exists);

  if (canAdd) {
    var label = q.length > 14 ? q.slice(0, 14) + '…' : q;
    DOM.blockBtn.textContent = '+ Block "' + label + '"';
    DOM.blockBtn.classList.remove('hidden');
  } else {
    DOM.blockBtn.classList.add('hidden');
  }
}

// ── DOM node builders ──────────────────────────────────────────────────────

/**
 * Creates a chip element for one blocked company.
 * If `query` is non-empty, the matching substring is wrapped in <mark>.
 *
 * @param {string} company — original-casing company name
 * @param {string} query   — current search/add input value (may be empty)
 * @returns {HTMLElement}
 */
function makeChip(company, query) {
  var chip = document.createElement('span');
  chip.className = 'chip';

  // ── Name label (with optional match highlight) ──
  var nameSpan = document.createElement('span');
  nameSpan.className = 'chip-name';

  if (query) {
    var ql = query.toLowerCase();
    var i  = company.toLowerCase().indexOf(ql);
    if (i >= 0) {
      nameSpan.innerHTML =
        escapeHtml(company.slice(0, i)) +
        '<mark>' + escapeHtml(company.slice(i, i + query.length)) + '</mark>' +
        escapeHtml(company.slice(i + query.length));
    } else {
      nameSpan.textContent = company;
    }
  } else {
    nameSpan.textContent = company;
  }

  // ── Remove (×) button ──
  var removeBtn = document.createElement('button');
  removeBtn.className = 'chip-remove';
  removeBtn.title     = 'Unblock';
  removeBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  removeBtn.addEventListener('click', function () { removeCompany(company); });

  chip.appendChild(nameSpan);
  chip.appendChild(removeBtn);
  return chip;
}

/**
 * Creates the placeholder shown when the blocklist is completely empty.
 * @returns {HTMLElement}
 */
function makeEmptyState(message) {
  var el = document.createElement('div');
  el.className   = 'empty-state';
  el.textContent = message;
  return el;
}

/**
 * Creates the placeholder shown when a search query matches nothing.
 * When the query is new (not a duplicate), hints that Enter will add it.
 *
 * @param {string}  query — the current search query
 * @param {boolean} isDup — true if the query already exists in the blocklist
 * @returns {HTMLElement}
 */
function makeNoMatchState(query, isDup) {
  var el = document.createElement('div');
  el.className = 'no-match-state';
  if (!isDup) {
    el.innerHTML = 'No matches. Press Enter to block "<b>' + escapeHtml(query) + '</b>".';
  } else {
    el.textContent = 'No matches in your blocklist.';
  }
  return el;
}

// ── Undo banner ────────────────────────────────────────────────────────────

function showUndo(company) {
  DOM.undoText.innerHTML = 'Unblocked <b>' + escapeHtml(company) + '</b>';
  DOM.undoFooter.classList.remove('hidden');
}

function hideUndo() {
  DOM.undoFooter.classList.add('hidden');
}

// ── Event binding ──────────────────────────────────────────────────────────
// All addEventListener calls live here so event wiring is easy to audit.

function init() {

  // Toggle: enable / disable the entire extension
  DOM.enabledToggle.addEventListener('change', function () {
    chrome.storage.sync.set({ extensionEnabled: DOM.enabledToggle.checked });
    renderStatus();
  });

  // Toggle: hide jobs already applied to
  DOM.hideAppliedToggle.addEventListener('change', function () {
    chrome.storage.sync.set({ hideApplied: DOM.hideAppliedToggle.checked });
  });

  // Search / add input
  DOM.input.addEventListener('input', function () {
    state.draft = DOM.input.value;
    renderInputUI();
    renderChips();
  });

  DOM.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addCompany();
  });

  // Clear (×) button — resets the input field
  DOM.clearBtn.addEventListener('click', function () {
    DOM.input.value = '';
    state.draft = '';
    renderInputUI();
    renderChips();
    DOM.input.focus();
  });

  // Block button — adds the current draft to the blocklist
  DOM.blockBtn.addEventListener('click', addCompany);

  // Undo bar
  DOM.undoBtn.addEventListener('click', undoRemove);
  DOM.undoClose.addEventListener('click', function () {
    state.recentlyRemoved = null;
    hideUndo();
  });

  // Load persisted data and paint the initial UI
  load();
}

init();
