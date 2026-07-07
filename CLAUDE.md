# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Pulse Plus** (originally "Pulse Fix") is a Chrome extension (Manifest V3) that enhances the internal corporate web app at `pulse.stack-it.ru`. It intercepts and modifies API responses, injects scripts/styles, adds UI elements (dark theme, chat panel, header buttons), and embeds a Vue 3 event planning module into the host page.

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

- **`background.js`** — Service worker. Handles notification display and proxies HTTP requests to localhost (for IDE integration) via `chrome.runtime.onMessage`.
- **`content.js`** — Thin content script bootstrap. Dynamically imports `src/content-main.js` using `chrome.runtime.getURL`.
- **`popup/popup.html`** — Extension popup for settings management.

### Content script bootstrap (`src/content-main.js`)

`bootstrapContent()` is the main orchestrator. It:
1. Fetches `modules.json` to discover which scripts/styles to load.
2. Reads settings from `chrome.storage` (sync + local).
3. Injects `scripts/pageBridge.js` first (transfers settings from `window.name` to `window.PULSE_EXTENSION_SETTINGS`).
4. Conditionally injects scripts and styles based on feature flags from settings.

### Module registry (`modules.json`)

Declares which scripts and stylesheets to inject. Entries can be unconditional (string path) or conditional (object with `key`/`value` — the `key` must match an enabled setting).

### Settings flow

Settings are stored in two `chrome.storage` areas:
- **`sync`** — Feature toggles (dark theme, calendar, event planning, permissions, notifications, diagnostic flags). Defaults in `DEFAULT_SYNC_SETTINGS`.
- **`local`** — `enableFeatures` master switch, `advancedSettings`, `trickDebugLogging`. Defaults in `DEFAULT_LOCAL_SETTINGS`.

Settings are passed from the content script to the page context via `window.name` → `pageBridge.js` → `window.PULSE_EXTENSION_SETTINGS`. Page scripts read settings through `getPulseSettings()` (defined in `scripts/loadSettings.js`), which returns a Promise that resolves when the `PulseExtensionSettingsLoaded` custom event fires.

### Messaging layers

There are two distinct messaging channels:
1. **`chrome.runtime` messages** — between content script and background service worker (notification display, local HTTP requests for IDE integration).
2. **`window.postMessage`** — between content script and injected page scripts. The content script in `src/content-main.js` bridges both channels: page scripts send `WINDOW_*` messages, the content script relays them to `chrome.runtime`, and forwards responses back via `window.postMessage`.

Message type constants are in `src/shared-constants.js`.

### API interception (`scripts/rules.js`)

The core hooking mechanism. Overrides `JSON.parse`, `JSON.stringify`, and `Response.prototype.json` to:
- Grant additional permissions/roles (when `advancedSettings` is on).
- Intercept push notification payloads and forward them to `showLocalNotification()`.
- Highlight the active task in the sprint board.
- Log request/response pairs to `localStorage` (when `trickDebugLogging` is on).

### Event Planning module (`extension-src/event-planning/`)

A Vue 3 + TypeScript app built with Vite as an IIFE bundle (`assets/event-planning.js`). Uses `@tanstack/vue-query` for data fetching. Mounts into the host page DOM in two modes:
- **Route mode** — on custom path `/pulse/pplus/event-planning` (injected via history API patching in `scripts/eventPlanning.js`).
- **Calendar embedded mode** — as a "График" tab inside the existing `/pulse/owner/calendar` page.

The Vue app communicates with Pulse's backend through `window.postMessage` → content script bridge → `fetch` with Pulse session cookies. API translation from REST-like routes to KVPL tasks happens in `extension-src/event-planning/api/http.ts`.

The `@` path alias resolves to `extension-src/event-planning/`.

### IDE integration (`scripts/taskProjectGitWatcher.js`)

Discovers running JetBrains IDEs by scanning localhost ports (plugin: 37133-37143, IDE API: 63342-63352). Adds "Open in IDE" buttons next to task transfer buttons in the Pulse UI. Communicates with the IDE via the background service worker's local HTTP proxy.

### Header button system (`scripts/headerButtons.js`)

Provides a registration API (`window.PulsePlusHeaderButtons.register()`) for other scripts to add buttons to the Pulse header toolbar. Used by the dark theme toggle and event planning menu item.

### Dark theme (`scripts/darkTheme.js` + `styles/darkTheme*.css`)

Adds a theme toggle button via the header button system. Patches `CSSStyleDeclaration.prototype.setProperty` to fix dashboard widget height values.

### Chat panel (`scripts/chat.js`)

Embeds an iframe to `chat.sk-serv.ru` as a resizable, draggable side panel.

## Key Conventions

- Injected page scripts run in the **page context** (not the extension's isolated world). They cannot use `chrome.*` APIs directly — all extension API calls go through `window.postMessage` to the content script bridge.
- Feature flags in settings use `diagnostic*` prefix for granular on/off control of individual hooks and patches.
- The extension does not use a bundler for most of its code — only the event-planning Vue module uses Vite. Keep vanilla JS files ES-module-compatible (they use `type="module"` in the service worker and dynamic `import()` in the content script).
