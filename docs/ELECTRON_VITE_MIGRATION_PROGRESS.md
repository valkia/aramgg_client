# Electron / electron-vite 架构整改进度

更新时间：2026-05-16

## 目标

把当前项目从“可运行的混合结构”整理为更接近 electron-vite 推荐实践的结构，同时降低 Electron 安全风险，并让构建、类型检查、依赖升级有明确顺序。

## 当前判断

- 项目已经使用 `electron-vite dev` 和 `electron-vite build`。
- 源码目录已迁移为 electron-vite 推荐的 `src/main`、`src/preload`、`src/renderer` 三段结构。
- 根目录旧入口 `main.js`、`preload.js`、`vite.config.js` 已清理，旧 React/BaseUI 代码已隔离到 `legacy/react/src/`。
- Electron 安全配置已收敛：renderer 不再拥有 Node 能力，preload 通过 `contextBridge` 暴露业务 API。
- `package.json#main`、electron-vite 输出目录、electron-builder `files` 已对齐。
- `npm run type-check`、`npm run lint`、`npm run build` 当前均通过。
- 依赖存在较多落后版本，其中 Electron、electron-builder、Vue Router、TypeScript、vue-tsc 属于需要单独验证的大版本升级。

## 优先级

### P0：构建和入口一致性

- [x] 确保 electron-builder 会打包 `dist-electron/**/*`。
- [x] 确认 `package.json#main`、electron-vite 输出目录、electron-builder `files` 三者一致。
- [x] 记录当前构建产物目录，避免把源码入口和构建产物混用。

完成标准：

- `package.json#main` 指向的文件会被打进安装包。
- `npm run build` 能生成 renderer、main、preload 产物。
- 不依赖根目录旧 `main.js` / `preload.js` 启动正式应用。

### P1：目录结构迁移

- [x] 新建或迁移为 `src/main`、`src/preload`、`src/renderer`。
- [x] 将当前 `electron/main.js`、`electron/modules/**`、`electron/services/**` 迁入 `src/main`。
- [x] 将当前 `electron/preload.js` 迁入 `src/preload`。
- [x] 将当前 Vue renderer 保持在 `src/renderer` 或逐步迁入。
- [x] 清理旧 React 入口和未使用的根配置。

完成标准：

- electron-vite 配置只描述 main/preload/renderer 三个入口。
- 根目录不再保留容易误导的旧 Electron 入口。
- 新人能从目录名直接判断进程边界。

### P2：Electron 安全模型

- [x] 将 `nodeIntegration` 改为 `false`。
- [x] 将 `contextIsolation` 改为 `true`。
- [x] 默认开启 `sandbox`。
- [x] 恢复 `webSecurity` 默认安全行为。
- [x] preload 使用 `contextBridge.exposeInMainWorld()` 暴露最小业务 API。
- [x] renderer 不再使用 `window.require`、`window.fs`、完整 `window.ipcRenderer`。

完成标准：

- renderer 无法直接访问 Node.js API。
- preload 只暴露业务级方法，例如 `store.get()`、`screenshot.capture()`、`lcu.getStatus()`。
- IPC channel 有集中白名单和参数校验。

### P3：类型检查和 lint

- [x] 补齐 JS/TS 混用的声明或逐步迁移 TS。
- [x] 修复会阻塞 type-check 的未使用变量和类型。
- [x] 更新 ESLint 配置到当前 `eslint-plugin-vue` 可识别的配置。
- [x] 将 main/preload/renderer 的类型检查边界拆清楚。
- [x] 清理当前 lint warning 中的未使用变量，并将 `no-unused-vars` 恢复为 error。
- [x] 清理旧 React 遗留文件，并移除 `.eslintignore` 中对应忽略项。

完成标准：

- `npm run type-check` 通过。
- `npm run lint` 通过，且 warning 清零。

### P4：依赖升级

- [x] 先升级 patch/minor 依赖。
- [ ] 单独验证 Electron 主版本升级。
- [ ] 单独验证 electron-builder 主版本升级。
- [x] 单独验证 vue-tsc 主版本升级。
- [ ] 单独验证 Vue Router、TypeScript 主版本升级。
- [ ] 每批升级后运行 build、type-check、lint 和关键功能验证。

完成标准：

- lockfile 与 `package.json` 一致。
- 每批升级都有可回退边界。
- 应用能开发启动、生产构建、关键 Electron 功能可用。

## 当前执行记录

### 2026-05-16

- [x] 完成初步架构审查。
- [x] 确认当前结构不是推荐的 electron-vite 三段目录。
- [x] 确认 electron-builder `files` 未包含 `dist-electron/**/*`。
- [x] 确认 Electron webPreferences 存在安全风险。
- [x] 运行 `npm outdated --json`，确认依赖存在落后版本。
- [x] 运行 `npm run type-check`，当前失败。
- [x] 运行 `npm run lint`，当前失败。
- [x] 开始 P0 构建和入口一致性修复。
- [x] 更新 `package.json`，将 `dist-electron/**/*` 加入 electron-builder `files`。
- [x] 验证当前 `package.json#main` 指向 `dist-electron/main.js`，本地文件存在。
- [x] 验证当前 preload 产物为 `dist-electron/preload.mjs`，本地文件存在。
- [x] 更新 `electron.vite.config.mjs`，显式输出 `preload.mjs`。
- [x] 运行 `npm run build`，构建通过。
- [x] 构建生成 `dist-electron/main.js`、`dist-electron/preload.mjs` 和 renderer 产物。
- [x] 处理构建警告：`window-manager.js` 同时被静态和动态导入。
- [x] 处理构建警告：Vue SFC 仍使用已废弃的 `>>>` / `/deep/` 深度选择器。
- [x] 再次运行 `npm run build`，构建通过且上述两个警告已消失。
- [x] 处理项目内 npm 配置 warning：`.npmrc` 不再使用 npm 11 不识别的 `electron_mirror`、`electron_builder_binaries_mirror`、`enable-pre-post-scripts`。
- [x] 新增 `.eslintrc.cjs`，绕开 `eslint-plugin-vue` v10 与旧 eslintrc extends 的兼容问题。
- [x] 新增 `.eslintignore`，暂时排除旧 React 遗留入口，避免它们阻塞当前 Vue 项目 lint。
- [x] 运行 `npm run lint`，当前通过，剩余 14 个 `no-unused-vars` warning。
- [x] 新增 `electron/modules/logger.d.ts`，补齐 TS 对 JS logger 模块的声明。
- [x] 清理 LCU TS 文件中阻塞 type-check 的未使用导入、解构变量和参数。
- [x] 运行 `npm run type-check`，当前通过。
- [x] 再次运行 `npm run build`，构建通过。
- [x] 清理当前 lint warning，并恢复 `no-unused-vars` 为 error。
- [x] 运行 `npm run lint`，当前通过且 warning 清零。
- [x] 再次运行 `npm run type-check` 和 `npm run build`，均通过。
- [x] 确认旧 React/BaseUI 文件未被当前 Vue 入口引用。
- [x] 将旧 React 入口、旧 `src/modules/**` 和旧 React 组件目录迁移到 `legacy/react/src/`。
- [x] 更新 `.eslintignore`，只忽略 `legacy/react/`。
- [x] 迁移后运行 `npm run lint`、`npm run type-check`、`npm run build`，均通过。
- [x] 新增 `tsconfig.base.json`、`tsconfig.renderer.json`、`tsconfig.electron.json`。
- [x] 更新 `type-check` 脚本，分别检查 renderer 和 Electron 代码。
- [x] 清理 `jsconfig.json` 中不存在的 `tsconfig.node.json` 引用。
- [x] 拆分后运行 `npm run type-check`、`npm run lint`、`npm run build`，均通过。
- [x] 升级 `vue-tsc` 后再恢复 Vue SFC 专用类型检查；旧 `vue-tsc@1.8.27` 与当前 TypeScript/Node 组合不兼容。
- [x] 升级 `vue-tsc` 到 `3.2.9`，并将 renderer 检查切回 `vue-tsc`。
- [x] 升级后运行 `npm run type-check`、`npm run lint`、`npm run build`，均通过。
- [x] 将 Electron 主进程迁移到 `src/main`，preload 迁移到 `src/preload`，renderer 迁移到 `src/renderer`。
- [x] 更新 `electron.vite.config.mjs`、`tsconfig*.json`、`jsconfig.json` 和相关测试脚本路径。
- [x] 清理根目录旧 Electron/Vite 入口，并将 Electron 测试脚本迁移到 `tests/electron/`。
- [x] 迁移后运行 `npm run lint`、`npm run type-check`、`npm run build`，均通过。
- [x] 将 BrowserWindow 安全配置切换为 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`。
- [x] 重写 preload，只通过 `contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露业务 API。
- [x] 将 renderer 中所有 `window.ipcRenderer`、`window.require`、`window.fs`、`window.fse`、`window.cheerio` 访问迁移或移除。
- [x] 补齐 LCU 业务 API 的主进程 IPC handler。
- [x] 安全改造后运行 `npm run lint`、`npm run type-check`、`npm run build`，均通过。
- [x] 升级 patch/minor 依赖：`@vueuse/core`、`axios`、`cheerio`、`element-plus`、`fs-extra`、`lodash-es`、`nanoid`、`reka-ui`、`vue`、Tailwind/PostCSS 相关包、`eslint-plugin-vue`、`shadcn-vue`。
- [x] patch/minor 升级后运行 `npm run lint`、`npm run type-check`、`npm run build`，均通过。
- [x] 运行 `npm audit --json`：剩余风险主要来自 Electron 39 与 electron-builder 24 链路，需要在对应大版本升级批次中处理。

## 下一步

1. 单独验证 Electron 主版本升级。
2. 单独验证 electron-builder 主版本升级。
3. 单独验证 Vue Router、TypeScript 及其他剩余大版本升级。
4. 处理用户级 npm 配置 warning：当前 warning 来自 `C:\Users\du\.npmrc`，不在项目仓库内。
