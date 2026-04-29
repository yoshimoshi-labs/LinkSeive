/**
 * background.js — LinkSieve service worker
 *
 * Sole responsibility: keep the toolbar icon in sync with the
 * `extensionEnabled` setting stored in chrome.storage.sync.
 *
 *   enabled  → blue icon  (icons/icon*.png)
 *   disabled → gray icon  (icons/icon*_paused.png)
 *
 * The icon is updated:
 *   1. On service-worker startup (handles browser launch / extension install).
 *   2. Whenever `extensionEnabled` changes in storage (popup toggle).
 */

/** Swaps the action icon based on the enabled state. */
function updateIcon(enabled) {
  var suffix = enabled ? '' : '_paused';
  chrome.action.setIcon({
    path: {
      16:  'icons/icon16'  + suffix + '.png',
      48:  'icons/icon48'  + suffix + '.png',
      128: 'icons/icon128' + suffix + '.png',
    },
  });
}

// ── Startup ────────────────────────────────────────────────────────────────
// Set the correct icon as soon as the service worker starts.

chrome.storage.sync.get('extensionEnabled', function (data) {
  updateIcon(data.extensionEnabled !== false);
});

// ── Live updates ───────────────────────────────────────────────────────────
// React immediately when the popup (or any other context) flips the toggle.

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'sync' && 'extensionEnabled' in changes) {
    updateIcon(!!changes.extensionEnabled.newValue);
  }
});
