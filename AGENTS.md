# Repository Guidelines

## Project Structure & Module Organization

This is an Electron + Vue app built with `electron-vite`. Source code lives under `src/`:

- `src/main/`: Electron main process, window management, IPC handlers, data loading, screenshots, OCR, and LCU services.
- `src/preload/`: sandboxed preload bridge exposing `window.electronAPI`.
- `src/renderer/`: Vue renderer app, routes, services, shared utilities, UI components, styles, and assets.
- `public/`: static assets copied to the renderer build.
- `tests/electron/`: Node/Electron integration-style test scripts.
- `legacy/`: isolated legacy React code; do not extend it for new work.

Build output directories such as `dist/`, `dist-electron/`, and `build/` are generated artifacts and should not be committed.

## Build, Test, and Development Commands

- `npm run dev`: start the Electron app through `electron-vite dev`.
- `npm run build`: build main, preload, and renderer bundles.
- `npm run pack`: build and package with `electron-builder`.
- `npm run lint`: run ESLint on `src/**/*.js` and `src/**/*.vue`.
- `npm run type-check`: run Vue and Electron TypeScript checks.
- `npm run test:screenshots`: run screenshot/OCR analysis test script.

Use targeted test scripts in `tests/electron/` directly when debugging a feature, for example `node tests/electron/test-winrate-query.js`.

## Coding Style & Naming Conventions

Use Vue single-file components for renderer UI. Keep business logic in services where possible, not inside templates. Prefer existing UI primitives in `src/renderer/components/ui/` and project design tokens in `src/renderer/styles/index.css`.

Use JavaScript/TypeScript ES modules. Component files use `PascalCase.vue`; services and utilities use lowercase or kebab-case names. Keep comments short and only where they clarify non-obvious behavior.

## Testing Guidelines

There is no full unit test suite yet. Before submitting changes, run `npm run lint`, `npm run type-check`, and `npm run build`. For data, screenshot, OCR, or augment logic, also run the closest script under `tests/electron/`.

Name new test scripts with the existing pattern: `tests/electron/test-<feature>.js`.

## Commit & Pull Request Guidelines

Follow the repository’s conventional commit style: `feat:`, `fix:`, `chore:`, `docs:`, or `style:`. Examples: `fix: load sandbox preload in dev`, `style: refine app ui system`.

Pull requests should include a short summary, test results, screenshots or screen recordings for UI changes, and notes about Electron/main/preload security impact when relevant.

## Security & Configuration Tips

Renderer code must not assume Node access. Use the preload bridge and IPC APIs. Keep `contextIsolation`, `sandbox`, and `webSecurity` enabled unless a change explicitly justifies otherwise.

ARAM champ-select recommendation code must remain read-only. Do not connect `pickOrBan`, `benchSwap`, `action`, `acceptTrade`, or `declineTrade` to recommendation flows; keep executable LCU writes isolated to their existing feature areas such as rune pages.
