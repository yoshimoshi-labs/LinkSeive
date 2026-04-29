/**
 * content.js — LinkedIn Job Filter (content script)
 *
 * Architecture
 * ────────────
 * - `settings`  Single object holding all current filter values read from
 *               chrome.storage.sync.  Passed to every filter so they each
 *               have one predictable argument.
 *
 * - `FILTERS`   Registry of pluggable filter objects.  Each entry has:
 *                 name  — human-readable label used for debugging
 *                 test(card, settings) → boolean
 *                         return true to hide the card
 *
 * - filterAll() Iterates every job card and applies every registered filter.
 *               A card is hidden when ANY filter returns true.
 *
 * ── Adding a new filter ──────────────────────────────────────────────────────
 * 1. Add a storage key for its config value (if needed) to the `settings`
 *    object below and to the chrome.storage.sync.get() call in init().
 * 2. Append one object to FILTERS with a `name` and a `test` function.
 * That's it — no other code needs to change.
 * ────────────────────────────────────────────────────────────────────────────
 */

(function () {

  // ── Settings ───────────────────────────────────────────────────────────────
  // Single source of truth for all configurable filter values.
  // Updated by applyStorageData() on load and on every storage change.

  var settings = {
    extensionEnabled: true,
    blocklist:        [],    // lowercase company-name strings
    hideApplied:      false,
  };

  // ── Filter registry ────────────────────────────────────────────────────────
  // To add a new filter, append an object here.  Nothing else needs to change.

  var FILTERS = [

    {
      name: 'blocklist',
      /**
       * Hides cards whose company name matches any entry in the blocklist.
       * Comparison is case-insensitive and supports partial matches, so that
       * e.g. "acme" will also block "Acme Corp" or "Acme International".
       */
      test: function (card, s) {
        var company = getCompany(card);
        return company !== null &&
               s.blocklist.some(function (b) { return company.includes(b); });
      },
    },

    {
      name: 'hideApplied',
      /**
       * Hides cards that LinkedIn marks as already applied.
       * Detected via a footer <p> whose trimmed text is exactly "Applied".
       * Exact-match avoids false positives like "Applied Materials".
       */
      test: function (card, s) {
        return s.hideApplied && isApplied(card);
      },
    },

    // ── Add new filters below this line ──────────────────────────────────────
    //
    // Example — hide remote-only jobs:
    //
    // {
    //   name: 'hideRemote',
    //   test: function (card, s) {
    //     return s.hideRemote && isRemote(card);
    //   },
    // },

  ];

  // ── DOM helpers ────────────────────────────────────────────────────────────

  /**
   * Returns the wrapper element to show/hide.
   *
   * Each job card (div[role="button"][componentkey="job-card-component-ref-…"])
   * is nested 3 levels deep inside the outer list item we actually want to hide.
   * Walking up avoids relying on fragile class names.
   */
  function getHideTarget(card) {
    var el = card.parentElement &&
             card.parentElement.parentElement &&
             card.parentElement.parentElement.parentElement;
    return el || card;
  }

  /**
   * Extracts the company name from a job card without relying on CSS classes.
   *
   * LinkedIn job cards follow a consistent structural pattern:
   *   - Job title <p> always contains one or more <span> children.
   *   - Company name <p> is the first <p> *after* the title <p> that has
   *     no <span> children and contains non-empty text.
   *
   * Returns the name as a lowercased string, or null if not found.
   */
  function getCompany(card) {
    var ps = card.querySelectorAll('p');
    var foundTitle = false;

    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];

      if (!foundTitle) {
        // The title <p> is identified by having <span> children.
        if (p.querySelector('span')) foundTitle = true;
      } else {
        // The first span-free, non-empty <p> after the title is the company.
        if (!p.querySelector('span') && p.textContent.trim()) {
          return p.textContent.trim().toLowerCase();
        }
      }
    }

    return null;
  }

  /**
   * Returns true when LinkedIn shows "Applied" on the card footer.
   * Uses an exact text match to avoid false positives.
   */
  function isApplied(card) {
    var ps = card.querySelectorAll('p');
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].textContent.trim() === 'Applied') return true;
    }
    return false;
  }

  // ── Core filter loop ───────────────────────────────────────────────────────

  /**
   * Evaluates all FILTERS for every job card currently in the DOM and
   * shows/hides each card accordingly.  Safe to call multiple times —
   * each call is a full idempotent recompute.
   */
  function filterAll() {
    var cards = document.querySelectorAll('[componentkey^="job-card-component-ref"]');

    cards.forEach(function (card) {
      var target = getHideTarget(card);

      if (!settings.extensionEnabled) {
        // Extension is off — restore all cards to visible.
        target.style.display = '';
        return;
      }

      // Hide the card if ANY registered filter matches it.
      var shouldHide = FILTERS.some(function (filter) {
        return filter.test(card, settings);
      });

      target.style.display = shouldHide ? 'none' : '';
    });
  }

  // ── Storage sync ───────────────────────────────────────────────────────────

  /**
   * Merges raw storage key-value pairs into the `settings` object.
   * Called both on initial load and whenever storage changes, so all
   * storage → settings mapping lives in exactly one place.
   */
  function applyStorageData(data) {
    if (data.blocklist !== undefined) {
      // Normalise to lowercase once here so filters don't have to.
      settings.blocklist = data.blocklist.map(function (c) { return c.toLowerCase(); });
    }
    if (data.hideApplied !== undefined) {
      settings.hideApplied = !!data.hideApplied;
    }
    if (data.extensionEnabled !== undefined) {
      settings.extensionEnabled = !!data.extensionEnabled;
    }
  }

  /**
   * Loads settings from storage, runs the first filter pass, then starts
   * watching for DOM mutations (LinkedIn is a SPA — cards load dynamically).
   */
  function init() {
    chrome.storage.sync.get(
      ['blocklist', 'hideApplied', 'extensionEnabled'],
      function (data) {
        applyStorageData(data);
        filterAll();
        observe();
      }
    );
  }

  // Re-apply settings and re-filter whenever the popup changes something.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync') return;

    // StorageChange objects have { oldValue, newValue } — unwrap to a plain map
    // so applyStorageData() can handle them identically to the initial load.
    var patch = {};
    Object.keys(changes).forEach(function (key) {
      patch[key] = changes[key].newValue;
    });

    applyStorageData(patch);
    filterAll();
  });

  // ── Mutation observer ──────────────────────────────────────────────────────

  /**
   * Re-runs filterAll() whenever LinkedIn injects new job cards into the DOM.
   * This handles infinite scroll, tab switches, and SPA navigation.
   */
  function observe() {
    new MutationObserver(function () {
      filterAll();
    }).observe(document.body, { childList: true, subtree: true });
  }

  init();

})();
