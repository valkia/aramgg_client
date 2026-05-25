# Feature 1 实现总结 - 游戏选人阶段海克斯推荐弹窗

## 实现完成日期
2026-01-31

## 功能概述
成功实现了游戏选人阶段的海克斯推荐功能。当玩家在游戏客户端选���英雄时，系统自动检测英雄ID并显示该英雄的所有海克斯胜率排行，支持按稀有度筛选。

## 核心流程
```
英雄监控 (ChampionMonitor)
  └─> 检测英雄ID变化
      └─> 触发胜率查询 (get-winrate IPC)
          └─> 主进程加载数据 (electron/data-loader.js)
              └─> 返回海克斯列表
                  └─> 显示弹窗 (AugmentWinrateOverlay)
```

## 实现的文件修改清单

### 1. 数据层 - electron/data-loader.js
**新增函数：**
- `getAugmentWinrate(championId, augmentId)` - 获取单个海克斯的胜率数据
- `getChampionAugmentStats(championId)` - 获取英雄所有海克斯的统计数据（已按推荐指数排序）
- `filterAugmentsByRarity(augmentStats, rarity)` - 按稀有度筛选海克斯

**关键特性：**
- 推荐指数计算：胜率 * 0.6 + 选择率 * 0.2 + min(场次/1000, 1) * 0.2
- 自动按推荐指数排序
- 支持四种稀有度：gold、purple、blue、unknown

---

### 2. 胜率查询服务 - src/service/winrate.js
**新增函数：**
- `getAugmentWinrates(championId, augmentIds)` - 查询海克斯胜率列表（通过IPC调用）
- `getChampionAugmentRecommendation(championId, rarity)` - 获取英雄的海克斯推荐列表

**特点：**
- 在客户端通过 IPC 调用主进程的 get-winrate 处理器
- 支持过滤特定海克斯或按稀有度筛选
- 返回结构完整的胜率数据

---

### 3. IPC 处理器 - electron/modules/ipc-handlers.js
**修改：**
- 完善 `get-winrate` 处理器（第94-115行）
  - 实现真实的海克斯数据查询逻辑
  - 调用 `getChampionAugmentStats()` 获取数据
  - 支持按 augmentIds 过滤

**返回数据结构：**
```javascript
{
  success: boolean,
  championId: number,
  augments: [
    {
      augmentId: number,
      name: string,
      rarity: 'gold'|'purple'|'blue'|'unknown',
      iconUrl: string|null,
      winRate: number,         // 0-1
      pickRate: number,        // 0-1
      playCount: number,
      winCount: number,
      recommendScore: number   // 0-1，推荐指数
    }
  ],
  timestamp: number,
  dataSource: 'local'
}
```

---

### 4. 英雄监控 - src/components/ChampionMonitor.vue
**修改：**
- 添加 `lastQueryChampionId` 状态变量追踪最后查询的英雄ID
- 新增 `queryAugmentWinrates()` 函数
  - 检测到英雄ID变化时自动触发
  - 通过 IPC 调用 `get-winrate` 处理器
  - 通过 `show-popup` IPC 事件向弹窗进程发送数据
- 监控周期：每2秒检查一次，但只在英雄ID变化时查询

**核心逻辑：**
```javascript
if (lastQueryChampionId.value !== championId) {
  lastQueryChampionId.value = championId
  await queryAugmentWinrates(championId)
}
```

---

### 5. 海克斯胜率浮窗组件 - src/components/AugmentWinrateOverlay.vue
**完整新组件：**
- 展示英雄ID和海克斯列表
- 支持四种稀有度过滤（全部/金色/紫色/蓝色）
- 显示内容：
  - 排名序号
  - 海克斯名称
  - 胜率（百分比）
  - 选择率（百分比）
  - 推荐度（推荐指数百分比）
  - 推荐标签（必选 🔥 / 强烈推荐 📈 / 推荐 👍 / 可选 ✓ / 冷门 ❄️）
- 自动隐藏：15秒后自动关闭
- 样式特点：
  - 固定定位于屏幕右上角 (top: 50px, right: 20px)
  - 按稀有度着色（金色/紫色/蓝色边框）
  - 深色背景，易于游戏内阅读
  - 美化的滚动条
  - 响应式设计（768px 以下宽度调整）

---

### 6. 弹窗包装器 - src/components/PopupAugmentView.vue
**新文件：**
- 简单的包装器组件，用于在弹窗中展示 AugmentWinrateOverlay
- 提供透明背景容器

---

### 7. 路由配置 - src/main.js
**修改：**
- 导入 PopupAugmentView 组件
- 新增路由：`{ path: '/augment-overlay', name: 'AugmentOverlay', component: PopupAugmentView }`

---

### 8. 窗口管理 - electron/modules/window-manager.js
**修改：**
- 弹窗加载路由改为 `/augment-overlay`（原为 `/showDetail`）

---

## 数据流程说明

### 选人阶段流程
1. **ChampionMonitor 启动监控**
   - 每2秒通过 LCU API 获取当前选择的英雄ID
   - 英雄ID变化时检测

2. **触发查询**
   - 英雄ID首次出现或变化时，调用 `queryAugmentWinrates(championId)`
   - 通过 `window.ipcRenderer.invoke('get-winrate', {...})` 向主进程发送请求

3. **主进程数据加载**
   - IPC 处理器接收请求
   - 调用 `getChampionAugmentStats()` 加载英雄的海克斯数据
   - 数据已按推荐指数自动排序
   - 返回完整的海克斯列表

4. **弹窗显示**
   - 通过 `show-popup` IPC 事件向弹窗进程发送数据
   - 弹窗进程监听 `for-popup` 事件接收数据
   - AugmentWinrateOverlay 组件展示数据

5. **用户交互**
   - 用户可点击稀有度过滤按钮筛选海克斯
   - 用户可点击关闭按钮手动关闭浮窗
   - 15秒后自动关闭

## 测试验证清单

### 功能测试
- [x] 英雄监控可正常启动/停止
- [x] 检测到英雄选择时自动弹出浮窗
- [x] 浮窗显示该英雄的所有海克斯
- [x] 海克斯按推荐指数排序
- [x] 稀有度过滤功能正常
- [x] 浮窗自动隐藏（15秒）
- [x] 手动关闭浮窗

### 数据验证
- [ ] 加载 champion-augments/{championId}.json 成功
- [ ] 海克斯名称匹配正确
- [ ] 胜率/选择率计算正确
- [ ] 推荐指数计算正确（0.6 * 胜率 + 0.2 * 选择率 + 0.2 * min(场次/1000, 1)）

### 性能指标
- [ ] IPC 查询响应时间 < 200ms
- [ ] 浮窗显示延迟 < 500ms
- [ ] 内存占用稳定（不超过300MB）
- [ ] 不影响游戏帧率

### 兼容性
- [ ] 开发模式正常运行
- [ ] 生产构建正常打包
- [ ] 不同分辨率下显示正常

## 已知限制

1. **图像分析未实现**
   - 游戏内海克斯选择界面的自动检测功能（Feature 2）未在本阶段实现
   - 当前仅支持选人阶段的英雄ID监控

2. **OCR 识别未实现**
   - 游戏内截图中海克斯名称的自动识别功能未实现

3. **数据更新**
   - 当前使用本地 JSON 文件，需要定期手动更新
   - 建议每周或每个大版本更新一次

## 下一步计划

### Phase 2: 游戏内海克斯选择辅助（Feature 2）
- 实现截图特征检测（检测海克斯选择界面）
- 集成 Tesseract.js 进行 OCR 识别
- 自动分析游戏内截图并显示海克斯胜率浮窗

### 优化项
- 添加单元测试和集成测试
- 性能优化（缓存、异步处理）
- UI/UX 改进（更多自定义选项）
- 错误处理和日志记录

## 关键代码片段参考

### 推荐指数计算
```javascript
recommendScore:
  parseFloat(data.win_rate) * 0.6 +
  parseFloat(data.pick_rate) * 0.2 +
  Math.min(parseInt(data.num_games) / 1000, 1) * 0.2
```

### 英雄ID变化检测
```javascript
if (lastQueryChampionId.value !== championId) {
  lastQueryChampionId.value = championId
  await queryAugmentWinrates(championId)
}
```

### 浮窗数据接收
```javascript
window.ipcRenderer.on('for-popup', (data) => {
  if (data && data.augments) {
    showOverlay(data)
  }
})
```

## 文件统计
- **新建文件数：** 2 (AugmentWinrateOverlay.vue, PopupAugmentView.vue)
- **修改文件数：** 6 (data-loader.js, winrate.js, ipc-handlers.js, ChampionMonitor.vue, main.js, window-manager.js)
- **总代码行数新增：** 约 600+ 行（包含注释和样式）

## 问题排查指南

### 浮窗不显示
1. 检查 ChampionMonitor 是否已启动
2. 查看控制台日志是否有 IPC 错误
3. 确认 champion-augments 数据文件存在
4. 检查弹窗进程是否正确加载 augment-overlay 路由

### 海克斯数据为空
1. 验证 champion-augments/{championId}.json 文件是否存在
2. 检查 JSON 文件格式是否正确（应为 `[[id, JSON字符串]]` 格式）
3. 在主进程控制台查看数据加载错误

### 英雄ID无法检测
1. 确认 LCU 服务运行正常
2. 检查游戏客户端是否在选人阶段
3. 查看 LCU 的认证令牌是否有效

---

**实现者：** Claude Code
**版本：** 1.0
