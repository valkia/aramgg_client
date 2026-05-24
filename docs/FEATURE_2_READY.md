# Feature 2 准备阶段完成总结

## 📌 已实现的内容

### 1. LCU Service 扩展 ✅
**文件：** `src/service/lcu.js`

新增 4 个关键方法：
```javascript
// 获取当前游戏阶段
getGameflowPhase()

// 获取游戏会话信息
getGameflowSession()

// 轮询游戏阶段变化
pollGameflowPhase(callback, interval)

// 停止轮询
stopPollGameflowPhase(timerId)
```

### 2. 游戏流程监控服务 ✅
**文件：** `src/service/game-flow-monitor.js`（新建）

完整的事件系统：
```javascript
new GameFlowMonitor(lcuService)
  .on('game-started', () => {})      // 游戏开始加载
  .on('augment-ready', () => {})     // 海克斯选择即将开始
  .on('phase-change', () => {})      // 任何阶段变化
  .start()  // 启动监控
```

### 3. 完整的测试和集成文档 ✅
- `docs/FEATURE_2_PLAN.md` - 详细实现方案
- `docs/GAMEFLOW_DETECTION_GUIDE.md` - 快速测试指南

---

## 🎯 关键发现：游戏阶段时间线

```
大厅 Lobby
  ↓ (用户点击匹配)
匹配中 Matchmaking (可能 1-5 分钟)
  ↓
准备确认 ReadyCheck (30秒)
  ↓
选人阶段 ChampSelect (30-45秒)
  ↓
游戏加载 GameStart (30-60秒) ← 【推荐：在此启动自动截图】
  ↓
游戏进行 InProgress (开始) ← 【推荐：在此启动高频率截图】
  ├─ 前30秒：海克斯选择阶段 ⭐ 【关键时段】
  └─ 30秒后：正常游戏
  ↓
游戏结束 WaitingForStats / EndOfGame
```

---

## 🚀 下一步实现顺序（建议）

### Phase 1: 验证集成（1-2 天）
**目标：** 确认游戏流程检测完全工作

```bash
# 1. 启动应用
npm run dev

# 2. 测试游戏阶段检测
# 在开发工具控制台运行 docs/GAMEFLOW_DETECTION_GUIDE.md 中的测试代码

# 3. 进入不同游戏阶段，验证输出正确
```

✅ 验证标准：
- [ ] 能获取当前游戏阶段
- [ ] 轮询能检测到阶段变化
- [ ] GameStart → InProgress 的转换能正确触发

### Phase 2: 自动截图集成（3-5 天）
**目标：** 在游戏特定阶段自动启动截图

修改：`electron/auto-screenshot-service.js` 或创建新的定时截图配置

关键点：
```javascript
gameFlowMonitor.on('game-started', () => {
  // 启动截图，频率：每 500ms
  autoScreenshotService.start({ interval: 500 })
})

gameFlowMonitor.on('augment-ready', () => {
  // 提高频率到 100ms
  autoScreenshotService.setConfig({ interval: 100 })
})

gameFlowMonitor.on('game-ended', () => {
  // 停止截图
  autoScreenshotService.stop()
})
```

### Phase 3: 图像分析（1-2 周）
**目标：** 检测海克斯选择界面并识别海克斯名称

需要实现：
1. **特征检测**（`electron/modules/image-detector.js`）
   - 颜色阈值检测海克斯卡片
   - 识别三个卡片的位置
   - 提取名称区域

2. **OCR 识别**（`electron/modules/augment-ocr.js`）
   - 集成 Tesseract.js
   - 识别卡片上的海克斯名称
   - 模糊匹配到本地数据库

3. **浮窗显示**
   - 复用 Feature 1 的浮窗组件
   - 或创建新的游戏内浮窗

---

## 📊 技术栈对比

### 当前已有
| 技术 | 文件 | 状态 |
|------|------|------|
| LCU 游戏流程 API | src/service/lcu.js | ✅ 完整实现 |
| 游戏流程监控 | src/service/game-flow-monitor.js | ✅ 新增实现 |
| 自动截图 | electron/auto-screenshot-service.js | ✅ 已有基础 |
| 定时检查 | ChampionMonitor | ✅ 已有模式 |

### 待实现
| 技术 | 文件 | 难度 |
|------|------|------|
| 特征检测（颜色、轮廓） | electron/modules/image-detector.js | 中 |
| OCR 识别 | electron/modules/augment-ocr.js | 中 |
| Tesseract.js 集成 | package.json + 配置 | 低 |
| 游戏内浮窗显示 | 复用 WinrateOverlay | 低 |

---

## 🔧 依赖安装准备

当进入 Phase 3 时需要安装：

```bash
# OCR 识别
npm install tesseract.js

# 图像处理
npm install sharp

# 可选：图像处理库
npm install opencv.js  # 如果需要更高级的图像处理
```

**建议：** 现在不安装，等到 Phase 3 时再安装（保持 package.json 干净）

---

## 💡 设计建议

### 海克斯卡片颜色特征
根据需求文档，海克斯卡片有以下稀有度颜色：

| 稀有度 | 边框颜色 | RGB 值 | 用途 |
|--------|---------|--------|------|
| 金色 | 金黄色 | (251, 191, 36) | 一级 |
| 紫色 | 紫罗兰 | (192, 132, 252) | 二级 |
| 蓝色 | 天蓝色 | (96, 165, 250) | 三级 |
| 棱彩 | 混合色 | 多种 | 特殊 |

### 推荐的图像分析流程

```
原始截图 (1920x1080)
  ↓
1. 颜色空间转换 (RGB → HSV)
  ↓
2. 颜色范围过滤 (提取金/紫/蓝像素)
  ↓
3. 轮廓检测 (识别三个矩形卡片)
  ↓
4. 位置验证 (确保在屏幕中央)
  ↓
5. 名称区域提取 (卡片上部 1/4 区域)
  ↓
6. 图像预处理 (灰度化、对比度增强、二值化)
  ↓
7. Tesseract OCR (识别文字)
  ↓
8. 模糊匹配 (与 augments-base.json 比对)
  ↓
输出：[海克斯ID, 海克斯名称, 位置信息]
```

---

## 📈 性能预期

### 最坏场景（3-5 秒完整分析）

| 步骤 | 耗时 | 说明 |
|------|------|------|
| 截图 | 50-100ms | 使用 screenshot-desktop |
| 特征检测 | 50-100ms | sharp 库处理 |
| 轮廓识别 | 50-100ms | 简单算法 |
| OCR 识别 | 2-3秒 | Tesseract.js 首次加载较慢 |
| 数据匹配 | <10ms | 本地 JSON 查询 |
| 查询胜率 | <50ms | 本地 IPC 调用 |
| 显示浮窗 | <200ms | Vue 渲染 |

**优化建议：**
- 缓存 Tesseract.js 模型
- 使用 Worker 线程进行 OCR
- 预加载 augments-base.json 数据

---

## ⚠️ 已知风险和缓解方案

### 风险 1：OCR 识别准确率
**问题：** Tesseract.js 对中文识别可能不够准

**缓解：**
- 图像预处理（增强对比度、放大2-3倍）
- 使用模糊匹配（Levenshtein 距离）
- 识别失败时降级使用颜色匹配

### 风险 2：不同分辨率支持
**问题：** 游戏可能在不同分辨率下运行

**缓解：**
- 自动检测分辨率
- 使用相对位置而非绝对坐标
- 支持缩放因子

### 风险 3：图像分析性能
**问题：** 频繁的 OCR 可能占用过多 CPU

**缓解：**
- 特征检测通过后才进行 OCR
- 降低分析频率（每 200-300ms）
- 使用 Worker 线程

---

## 🎓 学习资源

### 图像处理
- [Sharp 文档](https://sharp.pixelplumbing.com/)
- [OpenCV.js 教程](https://docs.opencv.org/4.5.2/index.html)

### OCR
- [Tesseract.js 文档](https://tesseract.projectnaphthalene.com/)
- [中文 OCR 最佳实践](https://github.com/naptha/tesseract.js)

### LCU API
- [LCU API 文档](https://www.leagueoflegends.com/en-us/news/dev/dev-blog-lcu-api-guide/)
- [所有可用端点列表](https://github.com/CommunityDragon/CDTB/blob/master/refs/lcu/lcu.json)

---

## ✨ 里程碑总结

| 里程碑 | 状态 | 日期 |
|--------|------|------|
| Feature 1: 选人阶段海克斯推荐 | ✅ 完成 | 2026-01-31 |
| 游戏流程检测基础 | ✅ 完成 | 2026-01-31 |
| 游戏流程监控服务 | ✅ 完成 | 2026-01-31 |
| 自动截图集成 | ⏳ 计划 | 2026-02 中旬 |
| 图像分析实现 | ⏳ 计划 | 2026-02 末 |
| Feature 2: 游戏内海克斯推荐 | ⏳ 计划 | 2026-03 初 |

---

## 🎯 建议的下一步行动

### 短期验证
1. ✅ 在开发工具中测试游戏流程检测
2. ✅ 验证 LCU API 端点的响应
3. ✅ 记录不同阶段的实际时间

### 本周内
1. 集成 GameFlowMonitor 到 ChampionMonitor
2. 测试事件触发是否正确
3. 准备好 Tesseract.js 的集成方案

### 下周
1. 开始实现特征检测模块
2. 设计 OCR 识别的流程
3. 准备测试图像集

---

**当前状态：** 🟢 Feature 2 准备就绪，可随时开始实现

**问题或建议：** 欢迎随时讨论技术细节或优化方案

祝你好运！🚀
