# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A League of Legends companion application built with Electron + Vue 3. The app provides champion statistics, rune recommendations, and an auto-screenshot feature with winrate overlay. The architecture separates the Electron main process (Node.js) from the Vue renderer process.

# 任何项目都务必遵守的规则（极其重要！！！）

# 使用中文对话、注释和记录文档

## Documentation

- 正式文档写到项目的 docs/ 目录下
- 用于讨论和评审的计划、方案等文档，写到项目的 discuss/ 目录下

## Code Architecture

- 编写代码的硬性指标，包括以下原则：
  （1）对于 Python、JavaScript、TypeScript 等动态语言，尽可能确保每个代码文件不要超过 300 行
  （2）对于 Java、Go、Rust 等静态语言，尽可能确保每个代码文件不要超过 400 行
  （3）每层文件夹中的文件，尽可能不超过 8 个。如有超过，需要规划为多层子文件夹
- 除了硬性指标以外，还需要时刻关注优雅的架构设计，避免出现以下可能侵蚀我们代码质量的「坏味道」：
  （1）僵化 (Rigidity): 系统难以变更，任何微小的改动都会引发一连串的连锁修改。
  （2）冗余 (Redundancy): 同样的代码逻辑在多处重复出现，导致维护困难且容易产生不一致。
  （3）循环依赖 (Circular Dependency): 两个或多个模块互相纠缠，形成无法解耦的“死结”，导致难以测试与复用。
  （4）脆弱性 (Fragility): 对代码一处的修改，导致了系统中其他看似无关部分功能的意外损坏。
  （5）晦涩性 (Obscurity): 代码意图不明，结构混乱，导致阅读者难以理解其功能和设计。
  （6）数据泥团 (Data Clump): 多个数据项总是一起出现在不同方法的参数中，暗示着它们应该被组合成一个独立的对象。
  （7）不必要的复杂性 (Needless Complexity): 用“杀牛刀”去解决“杀鸡”的问题，过度设计使系统变得臃肿且难以理解。
- 【非常重要！！】无论是你自己编写代码，还是阅读或审核他人代码时，都要严格遵守上述硬性指标，以及时刻关注优雅的架构设计。
- 【非常重要！！】无论何时，一旦你识别出那些可能侵蚀我们代码质量的「坏味道」，都应当立即询问用户是否需要优化，并给出合理的优化建议。


## Key Development Commands

### Setup & Installation
```bash
npm install
```

### Development
```bash
npm run dev
```
Runs Electron in development mode with Vite dev server on localhost:5173. Hot reload is active for both main and renderer processes.

### Building
```bash
npm run build
```
Builds the Vue renderer (to `dist/`) and Electron main/preload (to `dist-electron/`) using electron-vite.

### Packaging
```bash
npm run pack
```
Builds and packages the application for distribution using electron-builder.

### Linting
```bash
npm lint
```
Runs ESLint with Vue 3 plugin. Checks `src/` directory. Console logging is permitted.

## Architecture Overview

### Directory Structure
```
src/
├── main.js                 # Vue 3 app entry point, router setup
├── App.vue                 # Root Vue component
├── components/             # Vue components
│   ├── Display.vue         # Main display page with rune/build showcase
│   ├── WinrateOverlay.vue  # Floating overlay for winrate data (Feature 2)
│   ├── ShowDetail.vue      # Champion detail view
│   ├── ChampionStats.vue   # Statistics page
│   └── [other components]
├── router/
│   └── index.js            # Vue Router configuration
├── request/
│   └── api/                # API client layer
├── src/                    # Legacy folder structure (partially migrated)
│   ├── service/
│   │   ├── winrate.js      # Winrate data querying (Feature 2)
│   │   └── [data sources]
│   └── components/         # Older components
├── index.html              # HTML template for Vite
└── [other Vue assets]

electron/
├── main.js                 # Electron main process (app lifecycle, windows, IPC)
├── preload.js              # IPC bridge to renderer
├── screenshot.js           # Screenshot capture functionality (Feature 1)
├── image-analyzer.js       # Image analysis framework (Feature 2)
├── auto-screenshot-service.js  # Auto-screenshot service
└── data/                   # JSON data files for champions, builds, augments
```

### Process Architecture
- **Main Process** (electron/main.js): Window management, global shortcuts (F1), IPC handlers
- **Renderer Process** (src/): Vue 3 UI, communicates with main via IPC
- **Build Setup**: electron-vite handles separate bundling for main (CommonJS) and renderer (ESM/bundled)

## Core Features & Implementation

### Feature 1: F1 Screenshot (Completed)
**Files**: `electron/screenshot.js`, `electron/main.js`

- Registers F1 global shortcut in main process
- Captures full screen using `screenshot-desktop` library
- Saves to `~/.lol-tips-client/screenshots/`
- Sends `screenshot-taken` IPC event to renderer with filepath/timestamp
- Auto-cleans old screenshots (keeps most recent)

**Key Functions**:
- `captureScreenshot()` - Performs screenshot capture
- `cleanupOldScreenshots(keepCount)` - Removes old files

### Feature 2: Winrate Overlay (Framework Complete, Implementation Pending)
**Files**: `src/components/WinrateOverlay.vue`, `electron/image-analyzer.js`, `src/src/service/winrate.js`

**Data Flow**:
1. F1 screenshot → main process
2. `image-analyzer.js` analyzes screenshot (extracts champions, position, phase)
3. `winrate.js` queries winrate data for extracted champions
4. `winrate-updated` IPC event sent to renderer
5. `WinrateOverlay` component displays floating window
6. Auto-hides after 10 seconds

**Pending Implementation**:
- Image analysis logic (OCR/feature detection for champion extraction)
- Winrate query logic (API/web scraping for OP.GG or other sources)
- Data source integration

## IPC Communication

### Main → Renderer Events
- `screenshot-taken`: `{ success, filepath, filename, timestamp }`
- `winrate-updated`: `{ champions, stats, position, phase, ... }`

### Renderer → Main Handlers (via `invoke`)
- `screenshot-capture`: No args → screenshot result
- `analyze-screenshot(imagePath)`: Analyzes image
- `get-winrate(champions, position)`: Queries winrate data

## Build Configuration

### electron-vite Config
- **Main**: Builds `electron/main.js` to CommonJS in `dist-electron/main.js`
- **Preload**: Builds `electron/preload.js` to CommonJS in `dist-electron/preload.js`
- **Renderer**: Bundles `src/` with Vue 3 plugin to `dist/` (ESM with fallback)
- **Aliases**: `@` → `src/`, `src` → `src/src/`

### Development Server
- Vite dev server runs on `http://localhost:5173`
- Main process loads from dev server in dev mode
- Hot module reload enabled for Vue components

### Environment
- `NODE_ENV=development` triggers dev server connection
- Electron runs with `--ignore-certificate-errors` to bypass HTTPS validation for scraping

## Important Notes

1. **IPC Security**: Context isolation is disabled (`contextIsolation: false`) for easier IPC access. This is acceptable for a local desktop app but be cautious with untrusted content.

2. **Data Files**: Champion/build data stored as JSON in `electron/data/` directory. These are included in the packaged app via `extraResources`.

3. **API Layer**: `src/request/api/` provides HTTP client. Uses Axios for external API calls.

4. **Vue 3 Setup**: Uses Composition API, ElementPlus UI library for components.

5. **Dual Code Paths**: Repository has both legacy (`src/src/`) and modern (`src/`) structure—new components should use `src/components/`.

6. **Screenshot Storage**: Local filesystem storage in user's home directory. No cloud sync implemented.

## Testing and Debugging

- Dev mode opens DevTools by default
- IPC communication can be tested via renderer console: `window.ipcRenderer.invoke('...')`
- Screenshot functionality can be tested with F1 key during dev
- Check `~/.lol-tips-client/screenshots/` for captured files

## Common Workflows

**Adding a new Vue component**:
1. Create file in `src/components/`
2. Add route in `src/router/index.js` if needed
3. Import and use in parent components

**Modifying main process logic**:
1. Edit `electron/main.js`
2. Restart Electron (or use hot reload if configured)
3. Test IPC handlers in renderer console

**Integrating image analysis**:
1. Implement logic in `electron/image-analyzer.js`
2. Add test screenshots to verify accuracy
3. Return structured data (champions, position, phase)

**Adding winrate data source**:
1. Implement API calls in `src/src/service/winrate.js`
2. Handle caching and rate limiting
3. Format response for `WinrateOverlay` component
