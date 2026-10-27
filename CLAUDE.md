# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Trick Plus** (formerly "Pulse Plus", originally "Pulse Fix") is a Chrome extension (Manifest V3) that enhances the internal corporate web app at `pulse.stack-it.ru`. It intercepts and modifies API responses, injects scripts/styles, adds UI elements (dark theme, chat panel, header buttons), and embeds a Vue 3 event planning module into the host page.

The codebase is bilingual: UI labels, variable names in API payloads, and comments are in Russian. Pulse's backend uses a JSON-RPC-like "KVPL" protocol where task objects have Russian field names (e.g. `objectName: 'Бэклог'`, `methodName: 'ПолучитьЗадачиСпринта'`).

## Build Commands

```bash
# Build the event-planning Vue module (outputs IIFE bundle to assets/)
npm run build:event-planning

# Type-check the event-planning module
npm run typecheck:event-planning
```

There is no build step for the rest of the extension — vanilla JS files in `scripts/`, `src/`, and `popup/` are loaded directly by Chrome. Only `extension-src/event-planning/` goes through Vite.

## Architecture

### Extension entry points (MV3)

- **`background.js`** — Service worker. Handles notification display, proxies HTTP requests to localhost (for IDE integration) via `chrome.runtime.onMessage`, and kicks off the settings migration on `onInstalled` / `onStartup`.
- **`content.js`** — Thin content script bootstrap. Dynamically imports `src/content-main.js` using `chrome.runtime.getURL`.
- **`popup/popup.html`** — Extension popup for settings management. Dark, gradient-accented drill-down UI; its own design tokens live at the top of `popup/popup.css`. `popup/ui.js` owns the animated page router (measured stage height + slide/fade crossfade), `popup/actions.js` wires controls to the settings store, and `popup/picker.js` is the custom dropdown used instead of `<select>` (Chrome draws the native list outside the page, so it ignores the popup's palette). The dropdown opens in the top layer via the popover API because both `.stage` and `.page-body` clip their content; `picker.js` positions it from the trigger and reports the choice as a `change` event on the trigger button (`event.detail.value`).

### Content script bootstrap (`src/content-main.js`)

`bootstrapContent()` is the main orchestrator. It:
1. Fetches `modules.json` to discover which scripts/styles to load.
2. Reads settings from `chrome.storage` (sync + local).
3. Injects `scripts/pageBridge.js` first (transfers settings from `window.name` to `window.PULSE_EXTENSION_SETTINGS`).
4. Conditionally injects scripts and styles based on feature flags from settings.

### Module registry (`modules.json`)

Declares which scripts and stylesheets to inject. Entries can be unconditional (string path) or conditional (object with `key`/`value` — the `key` must match an enabled setting).

### Settings flow

**All settings live in a single `chrome.storage.local` key**, `trickPlus.settings` (`SETTINGS_STORAGE_KEY`). Defaults are in `DEFAULT_SETTINGS` (`src/shared-constants.js`); the stored object carries an internal `__schemaVersion` field that `src/shared-settings.js` strips before handing settings to anyone else.

Read with `getExtensionSettings()`, write with `setSetting(key, value)` / `updateSettings(patch)`. Writes are serialised through a queue and re-read storage first, so concurrent edits do not clobber each other. Each context caches the settings it read and refreshes that cache from `chrome.storage.onChanged`, so a service worker that outlives a popup edit does not act on stale settings.

Before version 5 settings were spread across ~22 keys in `chrome.storage.sync` plus 4 in `local`. `migrateLegacyStorage()` consolidates them on first read from any context (popup, content script, service worker). Migration is two-phase on purpose: the run that writes the consolidated key does **not** delete the old ones — `cleanupLegacyStorage()` removes them only on a later run, once the consolidated key is known to exist. This makes a race between two contexts harmless instead of destructive. The `sync` area is read and cleaned wholesale, because the old popup wrote arbitrary checkbox ids there.

The consolidation must happen **before** `bootstrapContent()` checks `enableFeatures` — otherwise the first post-update load would read the absent key, see the `false` default, and disable the extension for every existing user without ever migrating.

Settings are passed from the content script to the page context via `window.name` → `pageBridge.js` → `window.PULSE_EXTENSION_SETTINGS`. Page scripts read settings through `getPulseSettings()` (defined in `scripts/loadSettings.js`), which returns a Promise that resolves when the `PulseExtensionSettingsLoaded` custom event fires.

### Page localStorage keys

Everything the extension persists in the Pulse page's `localStorage` uses the `trickPlus.*` prefix (`WEB_STORAGE_KEYS`). Page-context scripts cannot import modules, so they duplicate these literals — keep them in sync. `src/legacy-storage.js` renames the old `PulsePlus_*` / `PULSE_FIXES_*` / `pulsePlus.*` keys on content-script boot, before any page script runs, and splits the old `TRICK_DEBUG_LOGGING` key (which stored both the enable flag and the log payload) into `trickPlus.debug.enabled` and `trickPlus.debug.log`.

### Messaging layers

There are two distinct messaging channels:
1. **`chrome.runtime` messages** — between content script and background service worker (notification display, local HTTP requests for IDE integration).
2. **`window.postMessage`** — between content script and injected page scripts. The content script in `src/content-main.js` bridges both channels: page scripts send `WINDOW_*` messages, the content script relays them to `chrome.runtime`, and forwards responses back via `window.postMessage`.

Message type constants are in `src/shared-constants.js`.

### Push notifications (`background.js`)

`scripts/rules.js` picks Pulse's push payloads out of `JSON.parse`, `scripts/notifications.js`
posts them to the content script, and the service worker turns each one into a
`chrome.notifications` entry with two buttons — «Перейти к заявке» and «Закрыть».

The target URL is parsed out of the payload's `subtitle` and stored in
`chrome.storage.session` under `NOTIFICATION_STATE_KEY`, **not** in a worker variable:
notifications are created with `requireInteraction`, so they wait for a click indefinitely
while the worker is torn down after ~30 s of idling. A module-level map is therefore empty
by the time `onButtonClicked` fires, which used to break *both* buttons.

For the same reason `handleNotificationButton()` clears the notification in a `finally` —
«Закрыть» must not depend on the target being known or on the navigation succeeding.
«Перейти к заявке» reuses the tab the notification came from (if it is still open and still
on Pulse), otherwise any other Pulse tab, and only opens a new one when Pulse is not open at
all; it then activates that tab and focuses its window.

### Calendar sync (`src/calendar-sync.js`, `src/calendar-schedule.js`)

Uploads the user's Pulse events as an `.ics` file to `calendar.sk-serv.ru`, so phones and mail
clients can subscribe to a permanent URL. Turned on by the `calendarSync` setting; the schedule
(`calendarSyncFrequency`, `calendarSyncTime`) is only reachable in the popup once it is on.

- **`src/calendar-sync.js`** — collects events, builds the ICS, uploads it. Events must be
  fetched from the page context (the Pulse session lives in the tab's cookies), so the sync
  finds an open Pulse tab via `chrome.tabs.query` and goes through the content script. Without
  such a tab the sync fails by design.
  The upload response carries a ready-made URL per subscribe button — `apple_url`, `google_url`
  and the `subscribe_url` page — plus the `.ics` file itself; `normalizeCalendarResult()` reads
  them (field names have changed over the years, hence the fallbacks).
  A successful run replaces the whole link set (`EMPTY_CALENDAR_LINKS` spread first in
  `buildSyncedState()`) instead of patching field by field: the service re-issues those URLs
  every time, so anything missing from the fresh answer must disappear from storage too, or a
  button keeps pointing at an address the service no longer serves. A *failed* run deliberately
  patches only the error fields — a working subscription must not vanish because of one outage.
  `getCalendarLinks()` is what the popup renders: it falls back to a `webcal://` link and a
  Google `cid=` link built from `fileUrl`, so states remembered before the service returned its
  own URLs still produce working buttons.
- **`src/calendar-schedule.js`** — pure schedule math, shared by the service worker and the
  popup so the "next run" hint names exactly the moment the alarm is set to.
- **`background.js`** — owns the single `chrome.alarms` alarm (`trickPlus.calendarSync`). The
  alarm always sits on the next occurrence of the configured time of day; longer frequencies
  skip firings via `isSyncDue`. A failed run is retried in 30 minutes, at most 12 times, and
  never past the next scheduled slot. Manual runs from the popup go through the worker too
  (`MESSAGE_TYPES.CALENDAR_SYNC_RUN`), so closing the popup does not abort the upload.
- The service's answer is remembered in its own `chrome.storage.local` key
  (`trickPlus.calendarSync`), **not** in the settings object: the popup compares page settings
  against stored settings, and a background write there would ask the user to reload Pulse.
  The same three settings keys are listed in `RELOAD_IGNORED_KEYS` (`popup/state.js`) for that
  reason — calendar sync never touches the page.
  `bindPopupEvents()` watches that key through `chrome.storage.onChanged`, so a popup that is
  open while a scheduled run finishes re-renders the new links instead of showing the ones it
  read when it opened.

`getFrequencyDays() === 0` (`Только вручную`) means no automatic sync at all: the alarm is
cleared and only the "Синхронизировать сейчас" button uploads.

Switching the toggle on runs the first upload immediately (through the same worker message as
the button), so there is something to subscribe to before the first scheduled slot. The popup
guards that with `state.calendarSyncBusy` — the button disables itself while busy, the toggle
does not.

### API interception (`scripts/rules.js`)

The core hooking mechanism. Overrides `JSON.parse`, `JSON.stringify`, and `Response.prototype.json` to:
- Grant additional permissions/roles (when `advancedSettings` is on).
- Intercept push notification payloads and forward them to `showLocalNotification()`.
- Highlight the active task in the sprint board.
- Log request/response pairs to `localStorage` under `trickPlus.debug.log` (when `trickDebugLogging` is on).

### Note reply button (`scripts/noteReply.js`)

Pulse hid the «Ответить» button on task comments behind a server flag: the notes tab asks
`РеестрЗаметок.ПолучитьОграничения` and renders the button only when the result has `ответ: true`
(`"can-reply": limits.ответ` in `IssuePage`). The rest of the reply flow is still in Pulse — the
«Ответить *Автор*» header above the editor and the `заметки-ответ` field sent with
`Заметки.вставить` — so the script only flips that flag and Pulse draws its own button.

It patches the `responseText` / `response` getters of the one XHR whose request body asks for the
limits, so it does not depend on listener order. It must stay **before `rules.js`** in
`modules.json`: `rules.js` replaces `JSON.parse`/`JSON.stringify` and, in debug mode, writes ids into
task payloads, so other responses must not go through them (if the order breaks, the script falls
back to a clean `JSON` from a throwaway iframe). Controlled by the `noteReplyButton` setting
(default on).

### Event Planning module (`extension-src/event-planning/`)

A Vue 3 + TypeScript app built with Vite as an IIFE bundle (`assets/event-planning.js`). Uses `@tanstack/vue-query` for data fetching. Mounts into the host page DOM in two modes:
- **Route mode** — on custom path `/pulse/pplus/event-planning` (injected via history API patching in `scripts/eventPlanning.js`).
- **Calendar embedded mode** — as a "График" tab inside the existing `/pulse/owner/calendar` page.

The Vue app communicates with Pulse's backend through `window.postMessage` → content script bridge → `fetch` with Pulse session cookies. API translation from REST-like routes to KVPL tasks happens in `extension-src/event-planning/api/http.ts`.

The `@` path alias resolves to `extension-src/event-planning/`.

### IDE integration (`scripts/taskProjectGitWatcher.js`)

Discovers running JetBrains IDEs by scanning localhost ports (plugin: 37133-37143, IDE API: 63342-63352). Adds "Open in IDE" buttons next to task transfer buttons in the Pulse UI. Communicates with the IDE via the background service worker's local HTTP proxy.

### Header button system (`scripts/headerButtons.js`)

Provides a registration API (`window.TrickPlusHeaderButtons.register()`) for other scripts to add buttons to the Pulse header toolbar. Used by the dark theme toggle and event planning menu item.

### Dark theme (`scripts/darkTheme.js` + `styles/darkTheme*.css`)

Adds a theme toggle button via the header button system. Patches `CSSStyleDeclaration.prototype.setProperty` to fix dashboard widget height values.

### Chat panel (`scripts/chat.js`)

Embeds an iframe to `chat.sk-serv.ru` as a resizable, draggable side panel.

## Key Conventions

- Injected page scripts run in the **page context** (not the extension's isolated world). They cannot use `chrome.*` APIs directly — all extension API calls go through `window.postMessage` to the content script bridge.
- Feature flags in settings use `diagnostic*` prefix for granular on/off control of individual hooks and patches.
- The extension does not use a bundler for most of its code — only the event-planning Vue module uses Vite. Keep vanilla JS files ES-module-compatible (they use `type="module"` in the service worker and dynamic `import()` in the content script).
