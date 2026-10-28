# Rank Analysis 功能适配

参考项目：[wnzzer/rank-analysis](https://github.com/wnzzer/rank-analysis)，审阅版本 `3878348ed516252083d1fc3fde606affe0e2ce6c`（2026-10-28）。

本次将适合海克斯大乱斗战绩的交互适配到现有 Electron / Vue / i18n 结构：

| 功能 | 上游参考 | 本项目适配 |
| --- | --- | --- |
| 表现总览 | `components/record/RecentStatsTable.vue`、`UserRecord.vue` | 本页胜率、综合 KDA、场均 K/D/A、按时间排列的胜负走势和连续胜负标签；明确本页样本范围，排除重开 |
| 筛选工具栏 | `components/record/MatchHistory.vue` | 复用现有分页数据，按英雄和胜负组合筛选；明确只筛选当前页，成功加载页面后重置；失败保留原页与筛选，空结果仍可翻页；首次加载显示骨架 |
| 对局详情 | `components/record/MatchDetailModal.vue`、`RecordCard.vue`、`composables/useMatchDetailPlayers.ts` | 按需展开双方玩家、KDA、伤害及队内占比、参团率、承伤、经济、补兵、装备、海克斯和多杀标记；当前玩家高亮，不接入选禁、交换或其他 LCU 写入 |

保留现有深色金色主题，用本项目设计 token 和组件实现；不引入 Tauri、Naive UI 或新的服务依赖。AI 复盘需要模型服务与密钥，云同步需要后端，自动选禁不符合本项目 ARAM 推荐只读约定，均不在此迁移范围。

上游采用 MIT License，原许可保存在 `public/third-party/rank-analysis-LICENSE.txt`，随 renderer 静态资源打包。

## 数据与边界

- 继续查询当前登录账号的海克斯大乱斗（队列 2400），没有新增全模式、其他玩家搜索或历史全量扫描。
- 详情复用当前 SGP SUMMARY 响应，保留 8 个额外标量字段，不增加逐局网络请求；原有本地存储与上传 schema 不变，玩家 PUUID 不传给详情 UI。
- 缺失或非法数值保留为 `null`，显示为 `—`。队伍不足 5 人、伤害字段不全、分母为 0 时不生成误导性的百分比或队内最高伤害标记。此处没有模拟官方 MVP 评分。
- 玩家备注、好友/宿敌和开黑识别依赖玩家查询与跨对局身份追踪，未混入当前账号战绩页。

## 验证（2026-10-28，macOS）

- `npm run lint`、`npm run type-check`、`npm run build` 通过。
- 相关 6 个测试文件共 23 项通过，覆盖组合筛选、翻页失败与重试、重开排除、数据去重、双方分组、缺失统计、十人字段映射、按需展开与三语 key 一致性。
- 全量单测：245 通过，1 失败。失败为 `tests/unit/onnxruntime-native-path.test.ts:40` 的 Windows 路径断言；从修改前基准 `de7c881` 提取测试与实现，在独立临时目录复现同一失败，属于既有 macOS 环境差异。
- 浏览器实际挂载本次 Vue 组件，用合成数据验证简中、英文、繁中、472×752 主窗口尺寸和 360px 内容窄版；组合筛选、键盘展开、十人详情正常，无横向溢出或浏览器告警。截图和独立预览入口保存在本机忽略目录 `.runtime/rank-analysis-preview/`，不属于生产数据。
- 未进行 Windows 打包验收或连接真实 League 客户端验收；真实账号的 SGP 字段可用性仍需设备验证。本次未 push、merge、打包发布或部署。
