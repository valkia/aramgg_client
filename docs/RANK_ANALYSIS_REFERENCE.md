# Rank Analysis 功能适配

参考项目：[wnzzer/rank-analysis](https://github.com/wnzzer/rank-analysis)，审阅版本 `3878348ed516252083d1fc3fde606affe0e2ce6c`（2026-10-28）。

## 本轮确认范围与串行进度（2026-10-28）

用户确认：只做海克斯模式；此前清单中低优先级和后置项目、界面缩放、全部符文相关功能不做。继续使用 `codex/rank-analysis-features`。先记录文档，再逐项实现；使用 GPT-6.1 Sol、`xhigh`（极高）推理强度子代理串行开发，同一时间只推进一个功能。每项完成相关检查、审阅并独立中文 commit 后才开始下一项，在本表与下方记录结果。没有 push、merge 或发布授权。

| 顺序 | 功能 | 实现范围与验收要求 | 状态 | 提交 / 验证 |
| --- | --- | --- | --- | --- |
| 1 | 战绩装备、海克斯说明浮层 | 名称、说明、海克斯稀有度；复用本地数据，键盘可访问，缺少说明时降级；不引入符文 | 已完成并审阅 | `cf258aa`；针对性 23 项通过；全量 264 通过、1 项既有失败；lint / 类型 / 构建 / 隔离本地数据检查通过 |
| 2 | 本页表现扩充 | 场均伤害、参团率、经济贡献；明确当前页与有效样本口径，排除重开和缺失值 | 已完成并审阅 | `c43d2ee`；相关 28 项通过；全量 276 通过、1 项既有失败；lint / 类型 / 构建通过 |
| 3 | 推荐依据与数据不足提示 | 仅英雄详情窗内解释现有推荐，显示样本与数据缺失，保留全部候选；不连接 LCU 选禁或交换写入 | 已完成并审阅 | 原提交 `79b2825`；本轮相关 32 项通过；全量 366 通过、1 项既有失败；lint / 类型 / 构建 / 隔离三语索引→推荐链路通过 |
| 4 | 详情统计与对比条补全 | 治疗、推塔伤害、分均经济／补兵、召唤师技能；缺失显示 —，统计不改变海克斯队列范围 | 已完成并审阅 | `0ff9f54`；相关 50 项通过；全量 305 通过、1 项既有失败；lint / 类型 / 构建 / 隔离 SGP 检查通过 |
| 5 | 独立战绩详情窗口 | 点击打开／聚焦对应对局，宽屏表格、窄屏可读；受信任 IPC、窗口生命周期与显示器边界；不加入缩放功能 | 已完成并审阅 | `b60a862`；相关 41 项通过；全量 329 通过、1 项既有失败；lint / 类型 / 构建 / 隔离 SGP / macOS 真实 Electron 窗口验证通过 |
| 6 | 海克斯英雄排行榜与搜索 | 使用 ARAMGG 本地优先、按语言隔离的数据；按强度／胜率／登场率／场次排序并打开现有英雄详情；不引入排位分路或 Ban 率 | 已完成并审阅 | `da8eeed`；相关 39 项通过；全量 362 通过、1 项既有失败；lint / 类型 / 构建 / 隔离三语索引 / macOS 真实 Electron 手动详情入口验证通过 |
| 7 | 主窗口分区导航与连接状态 | 战绩、英雄、设置清晰分区；真实客户端连接／选人／游戏阶段；保留语言切换事务与原有设置能力 | 待开发 | — |
| 8 | 海克斯模式平衡说明 | 核验队列 2400 可用来源，展示造成／承受伤害、治疗、护盾等确有依据的修正；不能把队列 450 数据冒充海克斯修正 | 待开发 | — |
| 9 | 版本改动与强度趋势 | 分开展示可核验的补丁改动与历史统计趋势；版本／模式匹配、来源明确；无历史快照不伪造趋势 | 待开发 | — |

排除项：玩家备注、玩家颜色标签、备注备份；符文推荐／方案／应用；界面缩放；浅色主题；回放；其他玩家搜索；十人近期战绩扩展；AI 复盘／自然语言搜索；自动选禁、自动排队、自动接收及关系推断。

数据功能必须先核验现有数据和上游来源。若依赖确实缺失，记录证据、已完成的可用部分与具体缺口，不能用样例数据或永远为空的占位面板宣称完成；继续处理不依赖该缺口的已授权工作。共享模块只做当前功能必要改动，不提前开发后续项目。

### 执行记录

- 开始前：工作区干净，HEAD `721cebb`。现有全量单测 252 通过、1 项已知 macOS／Windows 路径断言失败（详见验证章节）；lint、类型检查、构建均通过。
- 第 1 项实现：参考上游 `AssetTooltipContent.vue` / `RecordCard.vue`，在战绩列表与十人详情共用说明浮层。现有查询 DTO 透传当前语言本地装备说明、海克斯说明及稀有度；固定一次标签加载使用的语言，兼容旧装备包装中内容相同的语言别名，不新增 IPC、逐项远端请求或符文内容，存储与上传 schema 不变。
- 第 1 项交互与安全：复用已安装的 Reka Tooltip，支持鼠标悬停、真实 DOM 键盘焦点、Escape 与失焦关闭；翻页加载、筛选移除、收起详情、窗口失焦、隐藏、窗口尺寸改变和组件卸载均关闭。浮层使用视口碰撞定位、宽高上限、长词换行与内容滚动。说明先转为纯文本，再通过 Vue 插值显示，不使用上游 `v-html`；名称、说明和稀有度缺失时显示三语降级文案。
- 第 1 项验证：5 个针对性单测文件 23 项通过，覆盖列表与十人详情映射、三语稀有度、恶意 HTML 仅作文本、真实 `HTMLElement.focus()`、悬停与关闭生命周期。全量 `npm run test:unit` 为 264 通过、1 项同一既有 `onnxruntime-native-path.test.ts:40` 失败；`npm run lint`、`npm run type-check`、`npm run build`、`git diff --check` 通过。新增 `node --experimental-transform-types tests/electron/test-match-history-assets.js`，使用临时数据目录、合成 SGP、禁止网络的真实 data-loader 检查三语指针、装备包装、海克斯稀有度与缺失资源降级，通过且未触真实用户数据或 LCU。
- 第 1 项浏览器边界：主代理在后台浏览器合成预览确认 472×752 入口无横向溢出、无警告或错误；后台窗口失焦会关闭浮层，因此该检查不计为浮层视觉验收。实际浮层视觉、Windows 打包及真实 League 客户端未实测；代码经主代理审阅，随本功能提交；未 push、merge 或发布。第 1 项完成时，其余八项尚未开始。
- 第 2 项实现：参考上游 `RecentStatsTable.vue`，在现有本页表现中增加四项紧凑指标：场均对英雄伤害、场均参团率、场均金币、场均队内经济占比。每项独立显示有效场数，计算口径可展开；使用现有 token 与双列布局，三语齐全。总览始终使用原始当前页，筛选仅改变列表；重复对局仅统计一次，重开不进入新增指标。
- 第 2 项统计口径：参团率 =（个人击杀 + 助攻）÷ 同队总击杀；经济占比 = 个人金币 ÷ 同队总金币，均先逐场计算有效百分比再取算术平均，不把不同场的分母合并。个人伤害、金币可在队伍缺失时独立计样本；占比要求同队 5 个唯一且结果一致的玩家、已知队伍和非零分母，拒绝重复身份、当前玩家不明确、英雄／结果冲突及参团率大于 100% 的矛盾记录。无有效样本显示 `—`，真实 0 保留。
- 第 2 项数据边界：`normalizeGame` 已把缺失的显示用 K/D/A 补为 0，因此只在查询 DTO 添加可选 `participationStats`，从本次原始 SGP／LCU 统计保留可空 kills／assists，参团率不读取补零值。未改存储或上传 schema，未新增 IPC 方法、网络请求、其他队列或 LCU 写入。
- 第 2 项验证：四个相关单测文件 28 项均在全量运行中通过，覆盖逐场百分比均值、独立有效样本、真实零与零分母、缺失和非法字段、当前玩家及队伍身份歧义、真实 SGP 输入经 normalizeGame 后的原始击杀／助攻缺失、三语呈现和筛选前后总览一致。`npm run test:unit` 为 276 通过、1 项同一既有 `onnxruntime-native-path.test.ts:40` 失败；`npm run lint`、`npm run type-check`、`npm run build`、`git diff --check` 通过。构建有依赖 `@vueuse/core` 的 PURE 注释位置警告，无构建错误。
- 第 2 项浏览器边界：主代理以合成数据实际挂载组件，确认英文 360px 内容宽度／384×752 视口下四项数值与样本数、展开统计口径、英雄筛选后总览不变，无横向溢出或 warn/error；截图 `.runtime/rank-analysis-preview/page-performance-en-360.jpg`。该 fixture 包含刻意的英雄不一致样本以验证排除边界，并非线上数据。Windows 打包、真实 League 客户端及真实账号 SGP 字段可用性未验收；代码经主代理审阅，随本功能提交，未 push、merge 或发布。
- 第 3 项实现：参考上游 `BpDecisionBar.vue` 的决策短句和 `BuildRecommendBar.vue` 的统计依据，只适配信息展示。在英雄详情窗原有 `AramBenchRecommendation` 内解释当前最高、差距很小建议保留、席位评分更高、队友持有需沟通、缺少当前英雄／其他候选等原有分支。主进程添加稳定 `decisionReason`，renderer 通过三语 i18n 解释，不直接展示后端中文 `reasons`。仍列出全部候选，没有新增选禁、交换、交易、符文、其他模式或主窗口推荐入口，没有新增 IPC 方法、远端请求或依赖。
- 第 3 项数据口径：每个候选显示当前数据集的英雄统计场次、胜率、选取率和梯队；缺失或非法字段逐项标出，真实 0 保留，0 场单独提示无对局样本。全部缺失时仅展示候选，不宣称强度；当前英雄或最高分候选缺字段／无样本时明确比较仅供参考。可展开说明统计场次不是个人战绩、少样本可能波动，未设任意低样本阈值或“样本充分”标签。既有 `confidence` 只反映字段可用程度，不展示为统计置信度或胜率概率；综合评分的权重、排序和 `0.015` 差异分支不变。
- 第 3 项归一化边界：拒绝负数／超界比例、非有限值、布尔或对象伪数值、负数／非整数／超安全整数场次和非正整数梯队，防止负场次进入 `log10` 后产生 NaN。有效的百分数／小数比例、数值字符串、snake_case 和 `games` 等既有别名继续支持；`availableStatsFields` 与归一化结果对齐，不将合法别名误报缺失。无效字段仍沿用既有缺省值降级，不另改推荐权重策略。
- 第 3 项验证：新增服务／组件两个文件 18 项测试通过，覆盖原权重、差异阈值两侧、当前／席位／队友和空状态、全部候选保留、零与缺失、别名、非法数据、三语 key 与文案、既有只读刷新及卸载解绑。`npm run test:unit` 为 294 通过、1 项同一既有 `onnxruntime-native-path.test.ts:40` 失败；`npm run lint`、`npm run type-check`、`npm run build` 和 `node --experimental-transform-types tests/electron/test-aram-bench-recommendation.js` 通过。构建仅有既有 `@vueuse/core` PURE 注释位置警告。
- 第 3 项浏览器边界：主代理用合成数据挂载组件，确认 360px 内容宽／384×752 视口的 8 个候选均保留、决策与样本说明正确、说明可展开且无横向溢出；截图 `.runtime/rank-analysis-preview/bench-evidence-zh-360.jpg`。根据观察为紧凑候选卡增加顶部对齐，避免缺失字段较多的卡片拉大其他卡片图标与姓名的间距；将左右导航移到列表下方独立控制行，避免覆盖统计，并验证滚动两端的按钮禁用与滚动行为。样式调整后相关组件 9 项与构建通过，最终导航调整后组件 9 项及差异检查通过。未进行 Windows 打包或真实 League 客户端验收；代码经主代理审阅，随本功能提交，未 push、merge 或发布。导航调整经浏览器复核位于列表下方，不遮挡统计。第 3 项完成时，第 4–9 项仍未开始。
- 第 3 项源字段映射补修（第 6 项后）：真实三语 bundled 索引各 173 个英雄的 `stats.games` 均为 null，但旧 `loadChampionStats` / `mapPublicChampionStats` 将缺失胜率、选取率和场次提前补成 0，导致此前推荐 UI 把缺样本显示成“0 场”。本轮只修推荐取数：`loadChampionStatsForRecommendation` 固定一次当前语言，复用第 6 项 `loadChampionRankings(locale)` 的同版本 nullable 索引，按候选 ID 批量读取名称和统计。缺失／非法值保持 null，真实 0 保留；不改变旧英雄详情消费语义、评分权重、排序或差异阈值。未知／无名称英雄使用编号，整个索引失败时也保留全部候选和空统计，避免英文界面出现中文兜底；不逐英雄加载详情，不新增网络服务、LCU 写入、符文或第 7–9 项功能。
- 第 3 项映射补修验证：新增 4 项加载适配单测，覆盖一次批量读取、异步期间固定语言／本地化名称、零与缺失、非法字段、未知英雄、索引失败和空候选不取数；加上现有推荐服务、组件和榜单 mapper 共 4 文件 32 项通过。扩展 `node --experimental-transform-types tests/electron/test-champion-rankings.js`，把真实三语索引复制到临时目录，直接断言源 `games:null` 经真实 data-loader → 推荐适配 → `candidate.games:null`；在不改 173 条真实源记录的情况下附加合成边界行，验证真实数值 0、非法／缺失字段及未知英雄的降级。禁止网络时通过，仅允许既有后台 config 尝试，无逐英雄／详情网络，未接触真实 LCU 或用户数据。全量 `npm run test:unit` 为 366 通过、1 项同一既有 `onnxruntime-native-path.test.ts:40` 失败；lint、类型、构建和差异检查通过，构建仅有既有 `@vueuse/core` PURE 注释警告。本轮未重跑真实 popup、Windows 打包或设备验收；映射补修经主代理审阅，随独立 fix 提交，未 push、merge 或发布。
- 第 3 项映射补修的显示降级：所有候选均无统计时，抑制启发式平分所产生的金色 `recommended` 标记，继续保留当前英雄和队友身份标记，避免与“不作强度判断／仅展示列表”的说明矛盾。扩充现有无统计组件用例，验证候选、身份样式和缺当前状态；此最后局部调整后组件 9 项及差异检查通过，未重复全量或真实窗口验收。
- 第 4 项实现：参考上游 `MatchDetailModal.vue` / `RecordCard.vue` 的输出／承伤／治疗对比条和技能槽，在现有十人详情增加总治疗、对防御塔伤害、分均金币、分均补兵、两个有序召唤师技能槽，并扩充承伤与治疗的队内占比条。继续使用暗金 token 与双列窄版布局，三语齐全；未提前开发独立详情窗口或符文功能。
- 第 4 项数据口径：治疗仅取 `totalHeal`，标为“总治疗（含自身）”，不把 `totalHealsOnTeammates` 当总治疗；推塔仅取 `damageDealtToTurrets`，不以 `damageDealtToBuildings` 代替。分均值 = 原始非负标量 ÷ `gameDuration` 秒 × 60，时长非有限或不大于 0、统计缺失或无效时显示 `—`，真实 0 保留。三个占比各自要求该指标的全队有效值、五个唯一且结果一致的队员和非零分母；重复身份、缺失／无效／溢出总计不生成对应占比或最高伤害。详情参团率也使用原始可空 K/A，矛盾的大于 100% 值不截断伪装为有效数据。
- 第 4 项技能来源：本地没有召唤师技能名称字典。仅将 9 个已核验的稳定 ID 名称写入三语 i18n，来源为 Riot Data Dragon `15.24.1` 的 [en_US](https://ddragon.leagueoflegends.com/cdn/15.24.1/data/en_US/summoner.json)、[zh_CN](https://ddragon.leagueoflegends.com/cdn/15.24.1/data/zh_CN/summoner.json)、[zh_TW](https://ddragon.leagueoflegends.com/cdn/15.24.1/data/zh_TW/summoner.json)，核验日期 2026-10-28。这仅映射终局 ID，不推断该版本或模式能否选取技能；未知 ID 显示“技能 #编号”，缺失槽保留 `—`。图标复用现有 `getSpellIconUrl` 的 `cdn.dtodo.cn/hextech/summoner-spell-icons/{id}.png`，只读检查 `32.png` 返回 HTTP 200 / image/png；图标失败时保留名称。没有新增运行时数据服务或说明请求。
- 第 4 项数据边界：现有 SGP SUMMARY 仅多保留治疗、推塔和技能 ID 标量，查询 DTO 同时支持 SGP `summoner1Id`／`summoner2Id` 与 LCU `spell1Id`／`spell2Id`、flat／nested stats；两个技能槽不重排。继续只查队列 2400，不增加逐局请求，存储与上传 schema、IPC 方法和 LCU 写入均未改变。
- 第 4 项验证：7 个相关测试文件 50 项通过，覆盖真实 flat SGP／nested LCU 映射、原始与显示值边界、治疗／推塔字段不混用、分均秒制、零／缺失／无效／溢出、分母为零及队伍身份冲突、三语数值／技能名／顺序、未知技能与图标失败、原有展开和装备浮层关闭。`npm run test:unit` 为 305 通过、1 项同一既有 `onnxruntime-native-path.test.ts:40` 失败；`npm run lint`、`npm run type-check`、`npm run build`、`git diff --check` 通过。构建仅有既有 `@vueuse/core` PURE 注释位置警告。`node --experimental-transform-types tests/electron/test-match-history-assets.js` 已改为在 axios 边界注入合成响应，验证真实 SGP 压缩 → 查询映射 → 十人统计、三语本地资源且每页仅一次 `q_2400` SUMMARY 请求；未接触真实 LCU、用户数据或素材网络。
- 第 4 项浏览器边界：主代理以合成数据验证繁中 360px 内容宽／384×752 视口，十人详情、伤害／承伤／总治疗条、分均金币 685.4／补兵 2.5、技能 4／32 顺序正确；真实 0 治疗显示 0／0%，缺失推塔 `—`，未知技能 999 保留编号，无横向溢出或 warn/error。截图 `.runtime/rank-analysis-preview/scoreboard-metrics-tw-360.jpg`。未进行 Windows 打包或真实 League 客户端验收；真实账号的 SGP 新增字段可用性仍待设备验证。第 4 项经主代理审阅，随本功能提交，未 push、merge 或发布；第 4 项完成时第 5–9 项仍未开始。
- 第 5 项实现：参考上游 `detailWindow.ts` / `MatchDetailModal.vue` 的独立窗口与隐藏就绪流程，使用本项目 Electron 原生窗口、typed preload 和 Vue 路由。战绩卡新增三语“在独立窗口查看”入口；原内联详情和相遇定位继续可用。提取 `MatchScoreboardContent.vue`，两种详情共用十人统计、技能、资产说明浮层与三语格式。独立窗默认 1200×840，显示器 workArea 钳制位置、尺寸和最小尺寸；内容宽度达到 1000px 时按玩家／六项统计／技能／资产对齐为行，窄窗自动恢复卡片布局，没有界面缩放、符文或备注功能。
- 第 5 项数据与授权：主进程仅在成功查询后缓存最新一页 DTO（最多 20 局），不写磁盘；随机 `snapshotId` 与 gameId 只能由主窗口选择，不接受任意 URL、窗口选项或 renderer 提供的对局内容。缓存绑定匿名账号 key、区服和数据语言，查询结束再次核对当前账号／语言，清理代次阻止切换前的慢查询重新注册快照。新开窗先只读核验当前 LCU 身份；同上下文刷新失败保留原页，成功翻页替换旧页选择能力。打开详情不增加 SGP 请求，存储／上传 schema 与生产上传策略不变。
- 第 5 项窗口与失效：每局并发打开复用同一 Promise，已有窗口恢复并聚焦；最多 4 个详情窗，各自保留独立静态快照，翻页不打断阅读。`getDetailSnapshot()` 不接受索引参数，只按实际 WebContents 对象授权自身快照，其他本地窗、主窗和伪造 ID 不能读取。关闭／加载失败／主窗关闭／应用退出清理窗口及所有权；成功切换语言清空缓存并关闭详情，再由主列表重查，失败的语言准备不清理。查询、打开或读取时发现账号变化即失效并关闭详情；没有新增持续账号轮询，已显示快照在下一次核验前仍为原查询的静态记录。快照不按墙钟自动关闭。安全的 contextIsolation、sandbox、webSecurity、导航／重定向／window.open 拒绝及顶层本地来源校验均保留。
- 第 5 项验证：8 个相关测试文件 41 项通过，覆盖快照复制与最新页替换、边界容量、账号／区服／语言及并发失效、真实 trusted IPC 的子帧／远端／无主／销毁／非主窗拒绝、WebContents 所有权、typed preload 与 renderer facade、就绪前隐藏、重复打开／恢复聚焦／关闭重开／失败重试／全窗清理、负坐标和小显示器、切语言事务及失败保留、三语详情与 DOM 就绪信号，原内联详情及浮层测试继续通过。全量 `npm run test:unit` 为 329 通过、1 项同一既有 `onnxruntime-native-path.test.ts:40` 失败。`npm run lint`、`npm run type-check`、`npm run build`、`git diff --check` 和隔离 `test-match-history-assets.js` 通过；构建仅有既有 `@vueuse/core` PURE 注释位置警告。
- 第 5 项真实窗口验收：`node tests/electron/test-match-detail-window.js` 使用独立临时 userData、合成 LCU 身份／SGP／本地资产，禁用真实 LCU 发现、背景服务与外网；没有模拟 renderer-ready。项目本机未安装 Electron 二进制，因此将官方锁定 `42.2.0` macOS arm64 包下载到临时目录，核对包内官方 SHA256 后通过 `ARAMGG_ELECTRON_BINARY` 指定运行，未改 package／lock。这是源码构建产物在 macOS 真实 Electron 中的验收（`packaged: false`），不是 Windows 打包验收。实际 preload → trusted IPC → 查询 DTO → Vue 挂载及真实 ready、并发去重、窗口恢复、安全选项、workArea、window.open 拒绝、跨窗／不可信源拒绝、翻页后已开快照读取、账号失效、关闭／重开与主窗退出清理全部通过；3 次查询恰好 3 次合成 SGP 调用，开详情无额外请求。报告、日志与真实截图位于 `.runtime/match-detail-smoke-xJbpoW/`。
- 第 5 项浏览器边界：主代理实际挂载 `MatchDetailView`，确认英文 1200×840 宽表的十人、四大列及六项统计子列，384×752 自动卡片布局，均无横向溢出或 warn/error；截图 `.runtime/rank-analysis-preview/detail-window-en-1200.jpg`、`detail-window-en-384.jpg`。尚未进行 Windows 打包或真实 League 账号设备验收。第 5 项已完成并审阅，随本功能提交，未 push、merge 或发布；第 5 项完成时，第 6–9 项仍未开始。

- 第 6 项实现：参考上游 `Champions.vue` / `ChampionTierTable.vue` 的单次索引、前端搜索与表头排序交互，在主窗口战绩前加入独立海克斯英雄榜面板。搜索当前语言的英雄名称、英文别名与称号，支持大小写、全角和多词组合；梯队／胜率／登场率／统计场次均可双向排序，原生按钮和 `aria-sort` 提供键盘及排序语义。缺失指标始终排在最后，真实零值保留，并列按英雄 ID 稳定排序。加载、失败、重试、空数据、搜索为空及已载入数据可离线查看均有三语状态，重读失败保留同语言原数据和搜索；语言成功提交后立即清空旧列表，使用请求代次及响应语言核验防止旧响应覆盖。
- 第 6 项数据：实际核验三语 bundled `16.15.2/champions.json` 的 client-v1 envelope，`data[]` 已含 173 个英雄及嵌套 `stats`，无需逐英雄取数。现有 `loadChampionRoster` / `loadChampionStats` 会把缺失场次等补零，因此新增独立 nullable mapper，不改既有消费语义。`loadChampionRankings` 固定一次 ActiveDataSet，按同一语言和版本单次读取索引及其元数据；继续使用完整本地缓存／打包数据优先、远端版本后台检查，不请求全量详情或新增第三方统计 API。榜单显示数据版本、游戏补丁，展开来源、区域、统计日期、生成时间与统计口径；逐行保留源信息供可访问说明读取。当前打包三语数据均为腾讯 CN、统计日期 `2026-07-30`、补丁 `16.15`，173 个英雄的 `games` 均为 null，全部显示 `—` 并明确不推算样本量；不声称这是最新线上数据。
- 第 6 项详情与安全：新增 shared 契约 → preload → renderer facade → trusted IPC 的无参数榜单读取和仅英雄 ID 的手动详情入口。只有主窗口可以打开已知正整数英雄 ID，名称由本地索引取得，不接受任意 URL、详情内容或窗口参数；语言准备或窗口准备期间变更会拒绝该次打开。复用原有 popup 和实际 Vue 就绪流程，不新增英雄窗口或 LCU 操作。手动打开独立于自动显示偏好，隐藏／关闭清理本次手动状态，延迟 hide 不清除已重新显示的状态；后续进入 GameStart／InProgress 仍遵守游戏开始隐藏偏好，当前游戏阶段可再次手动打开。最小化窗口先恢复，置顶仍使用原偏好。打开动作使用独立代次，刷新数据、切语言及卸载不会锁死按钮或被旧结果覆盖。推荐仍仅在英雄详情窗内。
- 第 6 项验证：5 个相关单测文件 39 项通过，覆盖真实三语索引映射、零／缺失／非法值、ID 去重、搜索、四列双向稳定排序、加载／空／失败降级、异步语言响应及打开竞态、三语键、typed preload 与 renderer facade、主窗与已知英雄授权、手动窗口偏好和延迟 hide。全量 `npm run test:unit` 为 362 通过、1 项同一既有 `onnxruntime-native-path.test.ts:40` 失败；最终局部窗口恢复变更后相关 16 项、`npm run lint`、`npm run type-check`、`npm run build` 通过。构建仅有既有 `@vueuse/core` PURE 注释位置警告。`node --experimental-transform-types tests/electron/test-champion-rankings.js` 把真实三语打包索引复制到隔离临时缓存，在禁止网络时通过；仅允许后台 config 尝试，无逐英雄／详情网络、真实 LCU 或真实用户数据。
- 第 6 项真实窗口与平台边界：新增 `test-champion-rankings-window.js`，复用第 5 项已核验的 Electron `42.2.0` 临时 macOS arm64 二进制、独立 userData 和合成本地英雄数据，禁用外网与应用后台启动；未模拟 renderer-ready。真实 preload → trusted IPC → 本地榜单／英雄详情数据 → Vue 指标渲染、自动显示关闭仍可见、重复打开复用同一 popup、最小化恢复、后续游戏阶段隐藏／当前阶段手动重开、hide 清理及置顶偏好、无效／未知 ID、非主窗与不可信来源拒绝、`window.open` 拒绝全部通过。最终报告、日志与截图在 `.runtime/champion-rankings-smoke-aWSq1f/`，该验收 `packaged: false`。主代理已用真实 bundled 英文索引和合成桥接验证 360px 内容／384×752 视口的 173 英雄、胜率排序、AHRI 搜索、点击 ID、来源口径和缺失场次，无横向溢出或 warn/error；截图 `.runtime/rank-analysis-preview/champion-rankings-en-360.jpg`、`champion-rankings-list-en-360.jpg`。未进行 Windows 打包或真实 League 设备验收。第 6 项已完成并审阅，随本功能提交，未 push、merge 或发布；第 6 项完成时第 7–9 项未开始。

本次将适合海克斯大乱斗战绩的交互适配到现有 Electron / Vue / i18n 结构：

| 功能 | 上游参考 | 本项目适配 |
| --- | --- | --- |
| 表现总览 | `components/record/RecentStatsTable.vue`、`UserRecord.vue` | 本页胜率、综合 KDA、场均 K/D/A、伤害／参团率／金币／队内经济占比及各自有效样本、按时间排列的胜负走势和连续胜负标签；明确本页样本范围，排除重开 |
| 筛选工具栏 | `components/record/MatchHistory.vue` | 复用现有分页数据，按英雄和胜负组合筛选；明确只筛选当前页，成功加载页面后重置；失败保留原页与筛选，空结果仍可翻页；首次加载显示骨架 |
| 对局详情 | `components/record/MatchDetailModal.vue`、`RecordCard.vue`、`composables/useMatchDetailPlayers.ts` | 按需展开双方玩家、KDA、伤害／承伤／总治疗及队内占比、参团率、推塔、经济／补兵及分均值、召唤师技能、装备、海克斯和多杀标记；当前玩家高亮，不接入选禁、交换或其他 LCU 写入 |
| 再次遇见 | `components/gaming/MettingPlayersCard.vue` | 按玩家与区服聚合本页重复相遇，显示同队／对手次数、我的胜负与重开、该玩家逐局英雄及 K/D/A；点击可清除筛选并展开对应对局详情 |

保留现有深色金色主题，用本项目设计 token 和组件实现；不引入 Tauri、Naive UI 或新的服务依赖。玩家备注、颜色标签及备注 JSON 导入导出已按要求移除。AI 复盘需要模型服务与密钥，云同步需要后端，自动选禁不符合本项目 ARAM 推荐只读约定，均不在此迁移范围。

上游采用 MIT License，原许可保存在 `public/third-party/rank-analysis-LICENSE.txt`，随 renderer 静态资源打包。

## 数据与边界

- 继续查询当前登录账号的海克斯大乱斗（队列 2400），没有新增全模式、其他玩家搜索或历史全量扫描。
- 详情复用当前 SGP SUMMARY 响应，仅保留所需的身份、装备／海克斯和统计／技能 ID 标量，不增加逐局网络请求；原有战绩存储与上传 schema 不变。主进程生成 `区服:SHA256(PUUID)` 匿名玩家标识供相遇统计使用，原始 PUUID 不传给详情 UI；缺少稳定标识的玩家不计入相遇统计。
- 缺失或非法数值保留为 `null`，显示为 `—`。队伍不足 5 人、伤害字段不全、分母为 0 时不生成误导性的百分比或队内最高伤害标记。此处没有模拟官方 MVP 评分。
- 好友/宿敌与开黑推断仍未接入。
- 相遇只统计当前已加载页，不新增请求或全历史扫描；忽略缺失标识、无法确认当前队伍或身份冲突的记录，明确显示可识别场数；同名不合并，重复对局与重复玩家条目不重复计数。

## 验证（2026-10-28，macOS）

- `npm run lint`、`npm run type-check`、`npm run build` 通过。
- 相关行为测试通过，覆盖组合筛选、翻页失败与重试、重开排除、数据去重、双方分组、缺失统计、十人字段映射、按需展开与三语 key 一致性、重复相遇身份与队伍判定、清除筛选后定位详情。
- 全量单测：252 通过，1 失败。失败为 `tests/unit/onnxruntime-native-path.test.ts:40` 的 Windows 路径断言；从修改前基准 `de7c881` 提取测试与实现，在独立临时目录复现同一失败，属于既有 macOS 环境差异。
- 浏览器实际挂载本次 Vue 组件，用合成数据验证简中、英文、繁中、472×752 主窗口尺寸和 360px 内容窄版；组合筛选、键盘展开、十人详情、相遇跳转正常，无横向溢出或浏览器告警。截图和独立预览入口保存在本机忽略目录 `.runtime/rank-analysis-preview/`，不属于生产数据。
- 未进行 Windows 打包验收或连接真实 League 客户端验收；真实账号的 SGP 字段可用性仍需设备验证。本次未 push、merge、打包发布或部署。
