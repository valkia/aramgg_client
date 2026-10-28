# Rank Analysis 功能适配

参考项目：[wnzzer/rank-analysis](https://github.com/wnzzer/rank-analysis)，审阅版本 `3878348ed516252083d1fc3fde606affe0e2ce6c`（2026-10-28）。

本次将适合海克斯大乱斗战绩的交互适配到现有 Electron / Vue / i18n 结构：

| 功能 | 上游参考 | 本项目适配 |
| --- | --- | --- |
| 表现总览 | `components/record/RecentStatsTable.vue`、`UserRecord.vue` | 本页胜率、综合 KDA、场均 K/D/A、按时间排列的胜负走势和连续胜负标签；明确本页样本范围，排除重开 |
| 筛选工具栏 | `components/record/MatchHistory.vue` | 复用现有分页数据，按英雄和胜负筛选，保留分页与重置入口 |
| 对局详情 | `components/record/MatchDetailModal.vue`、`RecordCard.vue` | 基于只读战绩数据展示双方玩家和表现，不接入选禁、交换或其他 LCU 写入 |

保留现有深色金色主题，用本项目设计 token 和组件实现；不引入 Tauri、Naive UI 或新的服务依赖。AI 复盘需要模型服务与密钥，云同步需要后端，自动选禁不符合本项目 ARAM 推荐只读约定，均不在此迁移范围。

上游采用 MIT License，原许可保存在 `public/third-party/rank-analysis-LICENSE.txt`，随 renderer 静态资源打包。
