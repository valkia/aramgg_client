# 大乱斗 LCU 只读推荐能力进度

更新时间：2026-05-29

## 目标

参考 LeagueAkari 的 LCU 选人状态建模方式，增强本项目在大乱斗选人阶段的只读推荐能力。重点是更稳定地读取选人会话、当前英雄、候选 bench 英雄和游戏阶段，并把这些信息用于推荐展示、浮窗状态和截图服务生命周期控制。

本功能只做辅助判断和展示，不做代替玩家操作。

## 明确边界

- 禁止自动选英雄、自动锁定英雄、自动换 bench 英雄。
- 禁止自动接受或拒绝英雄交换请求。
- 禁止调用会改变选人结果的 LCU 接口，例如 `pickOrBan`、`benchSwap`、`action`、`acceptTrade`、`declineTrade`。
- 推荐模块只能依赖只读 LCU 接口和本地/远端统计数据。
- 参考 LeagueAkari 的架构思路，不复制 GPL-3.0 源码实现。

## 参考来源

- LeagueAkari 仓库：https://github.com/LeagueAkari/LeagueAkari
- Akari LCU 状态聚合：`src/main/shards/league-client/lc-state/index.ts`
- Akari 选人状态：`src/main/shards/league-client/lc-state/champ-select.ts`
- Akari 大乱斗 bench 决策参考：`src/main/shards/auto-select/index.ts`
- Akari 游戏流程 reaction 参考：`src/main/shards/auto-gameflow/index.ts`

## 当前项目基础

- 主进程 LCU 服务：[src/main/services/lcu/lcu-service.ts](../src/main/services/lcu/lcu-service.ts)
- LCU IPC handlers：[src/main/services/lcu/ipc-handlers.ts](../src/main/services/lcu/ipc-handlers.ts)
- 渲染进程 LCU 代理：[src/renderer/services/lcu/lcu-client.ts](../src/renderer/services/lcu/lcu-client.ts)
- 游戏流程监控：[src/renderer/service/game-flow-monitor.ts](../src/renderer/service/game-flow-monitor.ts)
- 自动截图服务：[src/main/auto-screenshot-service.js](../src/main/auto-screenshot-service.js)
- 海克斯浮窗：[src/renderer/components/AugmentFloatingOverlay.vue](../src/renderer/components/AugmentFloatingOverlay.vue)
- 英雄洞察弹窗：[src/renderer/components/AugmentWinrateOverlay.vue](../src/renderer/components/AugmentWinrateOverlay.vue)
- 席位推荐组件：[src/renderer/components/AramBenchRecommendation.vue](../src/renderer/components/AramBenchRecommendation.vue)

## 当前判断

- 项目已有 LCU 读取能力，不需要重建 LCU 底座。
- 当前 LCU 仍保持轻量服务结构，不做 Akari 式完整 shard 迁移。
- gameflow 阶段已改为优先使用 LCU WebSocket `OnJsonApiEvent`，保留低频轮询作为断线和长时间无事件时的兜底。
- 最值得借鉴的是“主进程维护选人状态快照，再由业务层消费”的思路。
- 第一阶段应先做只读状态缓存和推荐计算，避免 UI 与 LCU 原始 session 直接耦合。

## 阶段计划

### P0：安全边界和接口审计

- [x] 明确本功能不提供自动选英雄能力。
- [x] 明确禁止调用会改变选人结果的 LCU 接口。
- [x] 审计现有 LCU 服务，标出只读接口和写入接口。
- [x] 为推荐模块建立只读调用入口，避免误用写入能力。

完成标准：

- 文档中列出禁止接口。
- 推荐模块依赖的 LCU 方法均为只读。
- 代码 review 时能快速确认没有 `benchSwap`、`pickOrBan` 等调用。

### P1：LCU 选人状态快照

- [x] 在主进程增加轻量状态快照，包含 `gameflowPhase`、`champSelectSession`、`localPlayerCellId`、`selfChampionId`、`benchEnabled`、`benchChampions`、`myTeam`、`actions`、`timer`。
- [x] 复用现有 `LCUService.getCurrentSession()` 和 `getGameflowPhase()` 完成第一版轮询同步。
- [x] 增加 IPC 查询当前只读快照，例如 `lcu-get-champ-select-snapshot`。
- [x] 在 preload 和 renderer LCU client 中补齐对应只读 API。

完成标准：

- 渲染进程可以一次性拿到标准化后的选人快照。
- 无 LCU、非选人阶段、session 404 时返回稳定空状态。
- 当前英雄 ID 不再需要在浮窗里重复拼装 session 逻辑。

### P2：大乱斗 bench 推荐计算

- [x] 新增推荐计算模块，输入为标准化选人快照和英雄统计数据。
- [x] 识别 `benchEnabled` 和 bench 英雄列表。
- [x] 对当前手上英雄和 bench 英雄做统一评分。
- [x] 输出推荐结果：当前英雄、推荐英雄、差异原因、可用统计字段、置信度。
- [x] 覆盖无 bench、无英雄、数据缺失、重复英雄、LCU 断开等边界。

完成标准：

- 推荐计算是纯逻辑，不直接访问 Electron、IPC 或 LCU。
- 推荐结果只包含展示信息，不包含任何执行动作。
- 数据缺失时可以降级展示，而不是报错中断。

### P3：选人阶段 UI 展示

- [x] 在英雄洞察顶部展示大乱斗选人阶段推荐，不占用主界面。
- [x] 选人阶段显示当前英雄和 bench 推荐；游戏内阶段继续显示海克斯推荐。
- [x] 展示完整候选列表，不做固定 top 5 截断。
- [x] 不提供“自动换英雄”按钮。
- [x] 如需要操作入口，只允许提供“刷新推荐”或“查看详情”这类只读动作。

完成标准：

- 用户能看出是否建议保留当前英雄或关注 bench 某英雄。
- UI 文案明确是建议，不暗示工具会代替玩家操作。
- LCU 不可用时显示温和的空状态。

### P4：游戏流程驱动截图服务

- [x] 基于 LCU phase 控制自动截图服务的启动、暂停或清空状态。
- [x] 优先通过 LCU WebSocket `OnJsonApiEvent` 订阅 gameflow phase，降低持续轮询压力。
- [x] WebSocket 断开、token 变化或事件长时间静默时，保留只读轮询兜底。
- [x] `InProgress` 时允许海克斯 OCR 分析。
- [x] `ChampSelect`、`Lobby`、`EndOfGame` 等阶段清空或暂停游戏内海克斯浮窗。
- [x] 保留手动配置开关，避免用户无法掌控截图行为。

完成标准：

- 截图服务不会在明显无效阶段长期空跑。
- 阶段切换不会导致浮窗展示过期海克斯结果。
- 手动设置优先级清晰。

### P5：测试和验证

- [x] 新增 `tests/electron/test-aram-bench-recommendation.js` 或等价测试脚本。
- [x] 增加 mock champ-select session 样例。
- [x] 验证普通模式、自定义模式、大乱斗 bench 模式、LCU 断开场景。
- [x] 运行 `npm run lint`。
- [x] 运行 `npm run type-check`。
- [x] 运行 `npm run build`。

完成标准：

- 关键逻辑有可重复测试。
- 构建、类型检查、lint 均通过。
- UI 变更附带截图或手动验证记录。

## 设计决策记录

### 2026-05-24

- 决定只借鉴 LeagueAkari 的 LCU 状态建模和大乱斗 bench 分析思路，不引入自动选英雄能力。
- 决定第一版使用现有 LCU 请求能力构建只读快照，WebSocket `OnJsonApiEvent` 作为后续优化。
- 决定推荐模块与 LCU 写入接口隔离，避免未来误接入自动操作。
- 决定截图/OCR 生命周期使用 `/lol-gameflow/v1/gameflow-phase` 的 `InProgress` 表示实际对局阶段；选人阶段统一使用 `ChampSelect`，不混用 champ-select session 内部 timer 状态。

### 2026-05-25

- 决定 ARAM 选人阶段推荐从主界面迁出，使用独立席位推荐弹窗承载。
- 决定席位推荐候选列表展示全部候选英雄，避免固定展示上限隐藏可用席位。
- 决定 gameflow 阶段从 1 秒固定轮询改为 `OnJsonApiEvent` WebSocket 优先、5 秒轮询兜底，减少 LCU 请求并改善连续对局的阶段恢复。

### 2026-05-29

- 决定移除独立席位推荐弹窗，进入 `ChampSelect` 时打开英雄洞察，并在顶部横向展示席位推荐。
- 决定英雄尚未选定时也显示英雄洞察空状态，让席位推荐可以先展示，不用整页等待英雄数据。

## LCU 接口审计

### 推荐链路只读入口

- `LCUService.getChampSelectSnapshot()`：只读取 `getGameflowPhase()` 和 `getCurrentSession()`，生成标准化选人快照。
- IPC `lcu-get-champ-select-snapshot`：只返回选人快照。
- IPC `lcu-get-aram-bench-recommendation`：只读取选人快照和本地/远端英雄统计，输出展示建议。
- Renderer `electronAPI.lcu.getChampSelectSnapshot()` 与 `getAramBenchRecommendation()`：只读代理。

### 现有只读 LCU 方法

- `getAuthToken()` / `getLcuStatus()`：连接与认证状态读取。
- `getCurrentSession()`：读取 `/lol-champ-select/v1/session`。
- `getGameflowPhase()`：读取 `/lol-gameflow/v1/gameflow-phase`。
- `getGameflowSession()`：读取 `/lol-gameflow/v1/session`。
- `getPerkList()` / `getCurPerk()`：读取符文页数据。

### 现有写入 LCU 方法，禁止推荐链路使用

- `deletePerk()`：删除符文页。
- `createPerk()`：创建符文页。
- `applyPerk()`：组合删除和创建符文页。

### 明确未接入的选人写入接口

- 未调用 `pickOrBan`、`benchSwap`、`action`、`acceptTrade`、`declineTrade`。
- 推荐结果不包含任何可执行 LCU 动作字段。

## 执行记录

### 2026-05-24

- [x] 定位 LeagueAkari 项目和相关源码路径。
- [x] 分析 Akari 的 LCU 状态同步、auto-select bench 逻辑和 auto-gameflow 思路。
- [x] 对照本项目现有 LCU、浮窗和截图服务能力。
- [x] 形成只读推荐方案。
- [x] 新增本进度追踪文档。
- [x] 新增主进程只读选人快照、IPC、preload 与 renderer LCU client API。
- [x] 新增纯逻辑大乱斗 bench 推荐模块和 `tests/electron/test-aram-bench-recommendation.js`。
- [x] 主界面接入 `AramBenchRecommendation.vue`，只展示建议和刷新入口。
- [x] `get-champion-id` 改为复用只读快照，减少 session 解析重复逻辑。
- [x] 自动截图服务按 gameflow phase 暂停 OCR 和清空过期海克斯浮窗；`InProgress` 指实际对局阶段。
- [x] 验证通过：`node tests/electron/test-aram-bench-recommendation.js`。
- [x] 验证通过：`npm run lint`。
- [x] 验证通过：`npm run type-check`。
- [x] 验证通过：`npm run build`。

### 2026-05-25

- [x] 新增 `BenchOverlayView.vue` 和 `/bench-overlay` 路由。
- [x] 主进程新增席位推荐窗口，进入 `ChampSelect` 时显示，离开选人阶段时隐藏。
- [x] 从主界面移除 `AramBenchRecommendation.vue`，避免选人推荐占用主界面。
- [x] 席位推荐候选列表取消 top 5 截断，展示完整候选。
- [x] 验证通过：`node tests/electron/test-aram-bench-recommendation.js`、`npm run lint`、`npm run type-check`、`npm run build`。
- [x] 新增 `src/main/services/lcu/lcu-wamp-socket.ts`，通过 WAMP `OnJsonApiEvent` 监听 `/lol-gameflow/v1/gameflow-phase`。
- [x] 主进程 gameflow 监控改为 WebSocket 优先、5 秒轮询兜底，并在 LCU token/端口变化时自动重连。

### 2026-05-29

- [x] 删除独立席位推荐窗口和 `/bench-overlay` 路由。
- [x] 英雄洞察顶部接入紧凑横向席位推荐。
- [x] `ChampSelect` 进入时直接显示英雄洞察空状态，并继续暂停游戏内海克斯 OCR。

## 后续注意事项

- LeagueAkari 为 GPL-3.0，后续实现只参考思路，不复制实现代码。
- 自动选英雄相关代码即使存在参考价值，也不进入本项目功能范围。
- WebSocket 订阅只用于减少轮询和提高状态实时性，不扩大自动化操作能力。
