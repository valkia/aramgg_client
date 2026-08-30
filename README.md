<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="ARAMGG 助手：只读 LCU 选人建议、本地海克斯 OCR 与游戏内推荐浮窗" />
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/valkia/aramgg_client/releases/latest"><img src="https://img.shields.io/github/v/release/valkia/aramgg_client?style=flat-square&color=c8a96a&label=release" alt="最新版本" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-111923?style=flat-square&logo=windows11&logoColor=f4ecdc" alt="Windows x64" />
  <img src="https://img.shields.io/badge/LCU-read--only-54d884?style=flat-square" alt="LCU 只读" />
  <img src="https://img.shields.io/badge/UI-zh--CN%20%7C%20en--US%20%7C%20zh--TW-c29c6d?style=flat-square" alt="支持简体中文、英文与繁体中文" />
</p>

<p align="center">
  面向 Windows 的英雄联盟极地大乱斗桌面助手：选人阶段给出英雄与席位建议，对局中识别三张海克斯卡片，并把胜率、出装与技能建议放到游戏旁边。
</p>

<p align="center">
  <a href="https://github.com/valkia/aramgg_client/releases/latest"><strong>下载 Windows 安装包</strong></a>
  ·
  <a href="./docs/USER_GUIDE_AUTO_AUGMENT.md">使用指南</a>
  ·
  <a href="./docs/LCU_TROUBLESHOOTING.md">LCU 排障</a>
</p>

## 先看实际效果

<p align="center">
  <img src="./docs/aramgg-in-game-preview.png" width="100%" alt="ARAM 对局中的三卡海克斯识别浮窗和右侧推荐列表" />
</p>

<p align="center">
  <sub>顶部浮窗保持左、中、右卡位顺序；右侧列表继续展示海克斯胜率、推荐度和关联出装。</sub>
</p>

<p align="center">
  <img src="./docs/image.png" alt="ARAMGG 助手主控制台" width="380" />
  <img src="./docs/image0.png" alt="英雄详情与 ARAM 席位推荐" width="360" />
</p>

## 一局游戏里，它做什么

| 阶段 | ARAMGG 读取 | 你会看到 |
| --- | --- | --- |
| `ChampSelect` | 只读 LCU 选人、英雄与 bench 状态 | 当前英雄数据和所有可用席位英雄建议 |
| `InProgress` | 屏幕中的左 / 中 / 右海克斯标题区域 | 顶部三卡浮窗和右侧胜率、推荐列表 |
| 全程 | 当前语言的本地缓存或内置数据 | 英雄、海克斯、出装、召唤师技能与加点建议 |

> [!IMPORTANT]
> 推荐链路只读取状态和统计数据。它不会自动选英雄、交换 bench、锁定英雄或接受交易；最终操作始终由玩家完成。

## 为什么它不只是一个数据浮窗

- **先识别游戏阶段。** 应用通过 LCU gameflow 决定何时展示选人建议、何时运行游戏内 OCR，离开对局后会清理过期结果。
- **按真实卡位识别。** PaddleOCR 只读取左、中、右标题区域；某个位置读不到时保留空槽，不用宽区域结果打乱顺序。
- **本地优先展示。** 完整的内置或缓存数据会先渲染，远端版本检查与下载在后台进行，且只在必需文件完整后切换。
- **界面与数据同语言。** `zh-CN`、`en-US`、`zh-TW` 采用事务式切换，避免界面已经变更但数据仍停留在旧语言。

## 安装与使用

1. 从 [Releases](https://github.com/valkia/aramgg_client/releases/latest) 下载最新的 `aramgg_client Setup <version>.exe`。
2. 安装并启动 ARAMGG 助手，再启动 League Client。应用会优先从运行中的客户端自动发现 LCU。
3. 进入极地大乱斗：选人阶段查看英雄详情与席位建议；进入对局后等待海克斯界面出现。
4. 自动识别失败时可按 `F1` 手动截图分析。

「游戏目录」不是必填项。只有进程优先的 LCU 自动发现失败时，才需要把它作为读取 lockfile / 日志的高级兜底。

## 工作方式

```text
League Client ──只读 LCU──> 游戏阶段路由 ──ChampSelect──> 英雄详情 / 席位建议
                                          └─InProgress──> 屏幕截图
                                                            │
本地优先的同语言数据 <────────────── PaddleOCR 标题识别 <────┘
          │
          └──────────────> 顶部三卡浮窗 / 右侧推荐列表
```

Renderer 不拥有 Node 能力，只能通过 sandbox preload 暴露的业务 API 与主进程通信。Electron 窗口保持 `contextIsolation`、`sandbox` 和 `webSecurity` 开启。

## 本地开发

需要 Node `22.18.0` 与 npm 10。

```bash
git clone https://github.com/valkia/aramgg_client.git
cd aramgg_client
npm install
npm run prepare:client-data
npm run dev
```

提交前建议依次运行：

```bash
npm run test:unit
npm run test:augment-ocr
npm run lint
npm run type-check
npm run build
```

项目基于 Electron、Vue 3、electron-vite、TypeScript 和 PaddleOCR。源码按进程边界组织在 `src/main/`、`src/preload/`、`src/renderer/` 与 `src/shared/`；测试位于 `tests/unit/` 和 `tests/electron/`。

## 文档导航

- [完整架构](./COMPLETE_ARCHITECTURE.md)
- [自动海克斯检测使用指南](./docs/USER_GUIDE_AUTO_AUGMENT.md)
- [LCU 排障指南](./docs/LCU_TROUBLESHOOTING.md)
- [性能与发热排查](./docs/PERFORMANCE_DIAGNOSTICS.md)
- [大乱斗 LCU 只读推荐进度](./docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md)
- [客户端数据 API 分发策略](./docs/client-api-strategy.md)
- [Electron 客户端版本更新方案](./docs/ELECTRON_APP_UPDATE_STRATEGY.md)
- [TypeScript 开发约定](./docs/TYPESCRIPT_INTEGRATION.md)

客户端数据接口、API Key 申请和接入说明见 [ARAMGG 数据 API 开发者页面](https://data.dtodo.cn/developer.html)。

<details>
<summary><strong>维护者：发布与质量检查</strong></summary>

GitHub Actions 会在 Windows Runner 上执行 lint、type-check、unit tests 和打包。正式发布使用 `npm run release:patch|minor|major` 创建版本提交与 annotated tag，再运行 `npm run release:push`。

源码开发和普通本地打包不会向生产服上传战绩；只有该 GitHub 官方发布 workflow 会注入官方通道标记和生产写接口 origin。

依赖或 lockfile 变更后，发布前使用 npm 10 验证：

```bash
npx -p npm@10 npm ci --ignore-scripts
```

安装包发布后，还需要更新远端 `/api/client/v1/config` 中的 `client.latestVersion`、`client.downloadUrl` 和更新日志。自动更新链路未完整验证前保持 `client.autoUpdateEnabled` 关闭。

</details>

<details>
<summary><strong>Star 趋势</strong></summary>

<p align="center">
  <a href="https://www.star-history.com/?repos=valkia%2Faramgg_client&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=valkia/aramgg_client&type=date&theme=dark&legend=top-left&sealed_token=4WUaLyfHuhwVpa6CaVWxo9JwrU2ORlLI9dAYuWiPKDmieAkfPBMEhZVkaRE_Uh1S09rcn68ut9p3OTdv9g44qUeyk6rhtzkLF2KZ2_fbpLsIYVIxlwgpXj4aGR84y6dlAebI8UBtjKZlyxHepOvNbgHdzcQZqUinKSJCfAOSVoRjwL1xngr9YyeBPBBN" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=valkia/aramgg_client&type=date&legend=top-left&sealed_token=4WUaLyfHuhwVpa6CaVWxo9JwrU2ORlLI9dAYuWiPKDmieAkfPBMEhZVkaRE_Uh1S09rcn68ut9p3OTdv9g44qUeyk6rhtzkLF2KZ2_fbpLsIYVIxlwgpXj4aGR84y6dlAebI8UBtjKZlyxHepOvNbgHdzcQZqUinKSJCfAOSVoRjwL1xngr9YyeBPBBN" />
      <img src="https://api.star-history.com/chart?repos=valkia/aramgg_client&type=date&legend=top-left&sealed_token=4WUaLyfHuhwVpa6CaVWxo9JwrU2ORlLI9dAYuWiPKDmieAkfPBMEhZVkaRE_Uh1S09rcn68ut9p3OTdv9g44qUeyk6rhtzkLF2KZ2_fbpLsIYVIxlwgpXj4aGR84y6dlAebI8UBtjKZlyxHepOvNbgHdzcQZqUinKSJCfAOSVoRjwL1xngr9YyeBPBBN" alt="aramgg_client Star 趋势图" width="900" />
    </picture>
  </a>
</p>

</details>

<details>
<summary><strong>支持项目</strong></summary>

如果这个项目对你有帮助，欢迎支持后续开发与维护。

<p align="center">
  <img src="./docs/assets/support/wechat.jpg" alt="微信赞赏码" width="220" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./docs/assets/support/alipay.jpg" alt="支付宝收款码" width="220" />
</p>

</details>
