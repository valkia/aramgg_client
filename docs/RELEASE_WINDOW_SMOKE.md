# 打包窗口发布门禁

Windows 发布流水线在 `npm run pack` 后、上传安装包和创建 GitHub Release 前运行
`npm run test:packaged-windows`。失败或超时会阻止后续发布，检查报告和日志仍会上传为
`aramgg-client-window-smoke` artifact。

## 覆盖范围

- 启动本次构建的 `win-unpacked/aramgg_client.exe`，要求 `app.isPackaged === true`。
- 使用真实主进程窗口初始化、IPC 注册、ASAR 内的 preload、Vue 入口和路由；不模拟 BrowserWindow，
  不伪造 `renderer-ready`，不直接调用该通知来让测试通过。
- 验证 `/display`、`/augment-overlay`、`/floating-overlay`、`/augment-side-panel` 四个窗口
  自己发出就绪通知、Vue 已挂载且页面有内容、窗口可显示，并保存截图。
- 经主窗口的真实 `showPopup` / `diagnostics.testShowFloating` IPC 发送固定测试数据，验证浮窗显示
  测试海克斯。空闲浮窗本来无正文，不能只靠页面加载成功判断它能展示推荐内容。
- 每个窗口通过实际 preload 调用英雄监控初始状态和语言状态 IPC，检查返回值。
- preload 异常、页面加载失败、renderer 崩溃、JS console error、主进程未捕获异常及 45 秒
  启动超时均判失败。父进程另有 75 秒超时，缺失报告或应用非零退出同样判失败。

## 隔离与边界

测试复制整个打包目录到临时目录，用户数据和安装目录旁的数据均与真实安装隔离。
仅在同时设置 `ARAMGG_RELEASE_SMOKE_TEST=1` 和 `--release-smoke-test` 时启用检查。
应用仍执行正常的窗口、IPC 和托盘初始化；跳过启动诊断扫描、游戏轮询、截图、上传和自动更新。
Node HTTP/HTTPS/fetch 请求被禁用，Chromium 只允许本地 HTTP 页面。预期的网络阻断错误不作为
窗口失败，其余 renderer 错误仍会阻止发布。
测试数据中关闭自动装备配置；英雄详情读取打包自带数据，不依赖实时赛季接口。

这项检查验证打包应用启动及窗口链路，不代替真实 Windows 游戏内 OCR、推荐内容正确性、
置顶行为、安装器升级及签名验收。macOS 上运行相同检查只作为本地验证，Windows 验收由 CI 执行。

## 本地运行

```sh
npm run pack
npm run test:packaged-windows
```

也可传入打包目录和报告目录：

```sh
npm run test:packaged-windows -- build/win-unpacked build/release-smoke
# macOS 本地打包后
npm run test:packaged-windows -- build/mac-arm64/aramgg_client.app build/release-smoke-mac
```

## 与单元测试的区别

原 `window-manager-lazy.test.ts` 使用模拟 BrowserWindow，并由测试调用 `markRendererReady()`，
覆盖延迟加载、窗口复用和等待逻辑，无法验证 Vue 启动或真实 preload 是否可用。
0.2.17 增加的 `electron-api-bridge.test.ts` 使用真实转发对象和 preload 定义，但 Electron IPC
仍是 mock；它覆盖接口一致性与调用转发。打包窗口检查补上这两类单元测试未执行的运行链路。

关键桥接实现必须使用 `.ts` 并由共享 `ElectronAPI` 直接约束，不能再用手写同名 `.d.ts`
替未检查的 JS 实现声明完整接口。发布中的 `type-check` 和 `test:unit` 仍保留为前置门禁。

## 首次本地验证（2026-09-10）

macOS arm64 打包应用四个窗口通过，包含数据触发与截图，总耗时约 2.7 秒。
在独立打包副本中移除 renderer 的 `windows.ready` 实现后，四个窗口均报告原始 TypeError，
就绪数为 0，应用及外部检查进程均以退出码 1 失败。正常构建产物未修改。
Windows 执行结果由下一次运行本工作流产生；本地通过不代表已通过 Windows 游戏内验收。
