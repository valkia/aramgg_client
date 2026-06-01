# Electron 客户端版本更新方案

本文档记录 aramgg Electron 客户端的版本发布和后续自动更新方案。当前 GitHub Releases 发布链路已经验证可用；应用内 `electron-updater` 运行时代码仍未接入，应后续单独提交。

## 目标

- 使用 Electron 官方生态的应用更新方案，不把主界面改成远端加载 H5。
- 支持 Electron 应用本体更新，包含主进程、preload、renderer 页面、静态资源和依赖变更。
- 保持数据热更新和应用版本更新分离：数据变更走现有远程数据版本与本地缓存，代码和页面变更走安装包更新。
- Windows 首期优先；后续再补 macOS、Linux 的平台细节。

## 方案选择

推荐使用 `electron-builder` + `electron-updater`。

- `electron-builder` 已是当前项目打包工具。
- `electron-updater` 是 Electron 应用里最常用的自动更新运行时，能读取 `electron-builder` 生成的 `latest.yml`。
- Windows NSIS 包支持 blockmap 差分下载。也就是说，即使是 renderer 页面代码的小改动，也可以通过应用更新机制下发，实际下载量不一定等于完整安装包体积。
- 更新后的页面不是在线 H5，而是打进新版本安装包里的本地 renderer 产物。

不采用：

- 远端 `loadURL(https://...)` 作为主界面。
- 主界面在线 H5 化。
- 客户端运行时从公网拉 JS/CSS 替换已打包页面。

这些做法会扩大安全边界，也和当前 Electron 安全模型、离线能力、打包发布方式不一致。

## 已验证的发布链路

GitHub Actions 的 `Build Windows Release` workflow 已验证 Windows 安装包发布链路：

- `master` push 会构建 Actions artifact，便于检查安装包。
- `v*` tag push 会创建 GitHub Release，并上传 NSIS 安装包、`.blockmap` 和 `latest.yml`。
- workflow 使用 Node `22.18.0` 和 npm 10，安装依赖时执行 `npm ci --ignore-scripts`。
- workflow 会校验 tag 版本必须等于 `package.json` 版本。
- 已验证基线：`v0.1.4`，2026-06-02，GitHub Actions run `26766190598`。

改动依赖或 lockfile 后，发布前应使用 npm 10 复现 CI 安装：

```bash
npx -p npm@10 npm ci --ignore-scripts
```

这能提前发现本地 npm 版本差异造成的 `package.json` 和 `package-lock.json` 不同步问题。

## 发布产物

Windows NSIS 更新需要发布以下产物到 GitHub Releases 或其他静态文件服务：

```text
GitHub Release v0.2.0/
  latest.yml
  aramgg_client Setup 0.2.0.exe
  aramgg_client Setup 0.2.0.exe.blockmap
```

其中：

- `latest.yml` 描述最新版本、文件名、hash、大小和发布时间。
- `.exe` 是完整安装包。
- `.blockmap` 用于差分更新。

当前 GitHub Releases 已作为发布产物托管位置验证通过。EdgeOne、对象存储或自建静态目录仍可作为后续切换更新 feed 的备选。客户端只需要读取公开的更新 feed，不应该内置任何写入 token。

## 配置形态

后续实现时建议保持 feed URL 可配置：

```json
{
  "client": {
    "updateFeedUrl": "https://data.dtodo.cn/downloads/aramgg-electron/windows"
  }
}
```

本地开发和 CI 也可以用环境变量覆盖：

```text
ARAMGG_UPDATE_FEED_URL=https://example.com/releases/windows
ARAMGG_ALLOW_DEV_UPDATE_CHECK=1
```

默认行为：

- 开发模式不检查更新。
- 未配置 feed URL 时不检查更新。
- 打包后生产环境才自动检查。
- 用户主动点击检查更新时，可以触发一次显式检查。

## 客户端运行流程

计划实现的运行时流程：

1. 应用启动。
2. 读取远程客户端配置或环境变量中的 `updateFeedUrl`。
3. 生产环境配置 `autoUpdater.setFeedURL(...)`。
4. 注册更新事件：检查中、发现新版本、未发现更新、下载进度、下载完成、错误。
5. renderer 通过 preload 暴露的 IPC API 显示更新状态。
6. 下载完成后由用户确认重启安装，调用 `quitAndInstall()`。

Renderer 只接收受控状态和触发受控命令，不直接访问 Node 或更新库。

## 页面更新能力

Electron 的页面更新属于应用本体更新的一部分：

- Vue renderer 构建产物会被打进安装包。
- 页面组件、路由、样式、静态资源变更会随着新版本安装包发布。
- Windows blockmap 会尽量复用旧文件块，实现差分下载。
- 安装完成并重启后，用户看到的是新版本本地页面。

这和数据热更新不同。数据热更新只改变远程 JSON 数据与本地缓存，不改变应用代码、Vue 页面或 Electron 主进程逻辑。

## 与数据热更新的边界

| 能力 | 机制 | 是否需要重启 |
| --- | --- | --- |
| 英雄、海克斯、装备、胜率数据 | 远程 `config` + `manifest` + 本地缓存 | 不需要 |
| Vue 页面、样式、静态资源 | Electron 应用更新 | 需要安装并重启 |
| 主进程、preload、IPC、安全策略 | Electron 应用更新 | 需要安装并重启 |
| OCR 模型、二进制资源 | 原则上走应用更新；如要热更新需单独设计签名和校验 | 视实现而定 |

## 安全要求

- 更新源必须使用 HTTPS。
- 不在仓库或安装包内放上传凭证、CDN 写入 token 或管理员 token。
- Renderer 不直接访问 `electron-updater`。
- `contextIsolation`、`sandbox`、`webSecurity` 保持开启。
- 后续正式发布前应补代码签名；未签名安装包在 Windows 上会有信任提示。
- 更新包 hash 由 `latest.yml` 校验，发布端不能被未授权写入。

## 测试清单

发布链路已验证，接入应用内自动更新前仍需要完成端到端更新测试：

1. 安装旧版本，例如 `0.1.4`。
2. 修改版本号并重新发布新版本，例如 `0.1.5`。
3. 确认 GitHub Release 包含 `.exe`、`.blockmap`、`latest.yml`。
4. 启动旧版本，确认能发现新版本。
5. 验证下载进度、下载完成、重启安装和版本号变化。
6. 验证没有更新时的状态。
7. 验证网络失败、`latest.yml` 异常、hash 不匹配时的错误提示。
8. 验证开发模式默认不会误触发更新。
9. 验证 renderer 页面变更能随应用更新生效。

## 待定问题

- 是否长期使用 GitHub Releases 作为更新 feed，或切换到 EdgeOne、对象存储、自建静态目录。
- Windows 代码签名证书。
- 更新 UI 放在设置页、启动提示、还是右上角状态入口。
- 自动检查频率：启动时、每天一次、用户手动检查，或组合策略。
- 是否需要强制升级和最低可用版本。
- macOS、Linux 是否进入首期范围。

## 后续实现建议

建议更新功能单独提交，不和 Firebase、数据热更新或 UI 改动混在一起。

推荐拆分：

1. `chore: configure electron update artifacts`
2. `feat: add electron app update service`
3. `feat: expose update status in settings`

每个提交都先跑 `npm run type-check`、`npm run lint`、`npm run build`。涉及依赖或 lockfile 的提交额外跑 `npx -p npm@10 npm ci --ignore-scripts`。
