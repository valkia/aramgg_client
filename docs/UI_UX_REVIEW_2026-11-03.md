# 界面与交互审查（2026-11-03）

从实用性、美观、交互、专业性四个维度审查主界面 `/display` 及其设置卡片，本文记录已完成的整改和待处理事项。

## 已完成

### 实用性

- 模拟海报、浮窗预览、英雄详情预览、数据探测等测试/诊断按钮收进主页底部默认折叠的「开发者工具」`<details>`，按钮和文案仍保留在 DOM 中，原有单测断言不变。
- 操作反馈 `testStatus` 移出诊断面板，任何入口（如打开日志目录）都能看到结果；成功/进行中提示 6 秒后自动消失，错误提示保留到下一次操作，并使用 `role="alert"` / `role="status"`。
- 修复「数据探测」失败提示把 `\n` 当字面量显示、不换行的问题。

### 美观

- `ItemSetInstaller`、`OverlayPreferences`、`ChampionMonitor` 重复的卡片和开关样式合并到 `src/renderer/styles/index.css` 的 `@layer components`（`.config-card`、`.setting-row`、`.switch-control` 等）。
- `Display.vue` 中散落的硬编码颜色基本替换为 `--lol-*` 主题变量，新增红色提示色 `--lol-danger`。
- 10px 及以下字号提升到 11–12px，800/900 字重统一降到 700。

### 交互

- 退出确认和更新日志弹窗支持 Esc 关闭；打开时焦点移入弹窗按钮，关闭后归还给触发元素。
- 窗口控制按钮从 24px 放大到 32px；设置开关视觉尺寸不变，点击热区扩大到 42×40。
- 窗口控制、游戏目录开关、页脚链接和开发者工具折叠标题补充 `:focus-visible` 金色焦点框。
- 主界面和开关在 `prefers-reduced-motion: reduce` 下关闭动画与过渡。

### 专业性

- 删除 `App.vue` 中空的初始化函数和无效样式。
- 删除 `Display.vue` 中不再使用的样式：`.status-row`、`.version-download`、`.lcu-status-card`、`.test-btn.danger` 相关规则，以及 460px 媒体查询里与基础规则重复的 `.test-controls`。
- 新增文案 `display.devTools` 已同步 `zh-CN`、`en-US`、`zh-TW`。

## 待处理

| 优先级 | 事项 | 位置 | 说明 |
| --- | --- | --- | --- |
| 高 | 弹窗焦点锁定 | `Display.vue` 退出确认 / 更新日志弹窗 | 目前只做了 Esc 和焦点移入/归还，Tab 仍可跳出弹窗；可改用 reka-ui `Dialog` 或补 focus trap。 |
| 中 | 连接状态小字 | `MainNavigation.vue` `.connection-status` | 仍为 10px，需按 11–12px 下限调整。 |
| 中 | 其他面板统一规范 | `MatchHistoryPanel`、`ChampionRankingsPanel` 及游戏内浮窗组件 | 按本轮标准检查硬编码颜色、过小字号、过粗字重、焦点样式和减弱动效。 |
| 低 | 赛后海报按钮配色 | `Display.vue` `.post-game-share-button` | 青金渐变与暗金主题不够统一，需重新设计。 |
| 低 | 背景深色硬编码 | `Display.vue` `.hex-shell` / `.hex-window` 的 `#08151e`，按钮文字 `#061116` | 需新增或复用背景/反色文字 token 后替换。 |

## 已知问题

- `tests/unit/onnxruntime-native-path.test.ts` 的「adds the app.asar.unpacked native dir for packaged installs」在 macOS 上失败（断言 Windows 路径候选）。它只涉及 `src/main/modules/onnxruntime-native-path.ts`，与本轮 renderer 改动无关，尚未在改动前代码上复跑确认，需单独排查。

## 验证

- `npm run type-check`、`npm run lint`、`npm run build` 通过。
- `npm run test:unit`：448/449 通过，唯一失败见「已知问题」。
