# Feature 2 实现方案：游戏内海克斯选择界面检测

## 第一部分：游戏阶段检测（LCU API）

### LCU 游戏流程 API

**关键端点：**
```
GET /lol-gameflow/v1/gameflow-phase
GET /lol-gameflow/v1/session
```

**游戏阶段流程：**
```
Lobby (大厅)
  ↓
Matchmaking (匹配中)
  ↓
ReadyCheck (准备确认)
  ↓
ChampSelect (选人)
  ↓
GameStart (游戏加载) ← 这里我们需要启动截图服务
  ↓
InProgress (游戏进行) ← 海克斯选择通常在这个阶段前30秒内
  ↓
WaitingForStats (等待结果)
  ↓
EndOfGame (游戏结束)
```

### 响应数据结构

#### `/lol-gameflow/v1/gameflow-phase` 返回值：
```javascript
"ChampSelect"  // 当前阶段的字符串
或
"GameStart"
或
"InProgress"
等等
```

#### `/lol-gameflow/v1/session` 返回值：
```javascript
{
  "phase": "GameStart",
  "isSpectating": false,
  "gameData": {
    "gameId": 123456789,
    "platformId": "KR",
    "regionLocale": "ko_KR",
    ...
  },
  ...
}
```

---

## 第二部分：实现步骤

### Phase 2.1：扩展 LCUService（1天）

**文件：** `src/service/lcu.js`

```javascript
// 新增方法

// 获取当前游戏阶段
async getGameflowPhase() {
  const res = await http.get(
    `${this.url}/lol-gameflow/v1/gameflow-phase`,
    this.auth
  )
  return res // 返回 "ChampSelect", "GameStart", "InProgress" 等
}

// 获取游戏会话信息
async getGameflowSession() {
  const res = await http.get(
    `${this.url}/lol-gameflow/v1/session`,
    this.auth
  )
  return res
}

// 轮询游戏阶段
async pollGameflowPhase(interval = 1000, callback) {
  const pollTimer = setInterval(async () => {
    try {
      const phase = await this.getGameflowPhase()
      if (callback) {
        callback(phase)
      }
    } catch (error) {
      console.warn('轮询游戏阶段失败:', error.message)
    }
  }, interval)

  return pollTimer
}
```

**验证：**
在开发工具中手动测试：
```javascript
const lcu = new LCUService(lolPath)
await lcu.getAuthToken()
const phase = await lcu.getGameflowPhase()
console.log('当前阶段:', phase)
```

---

### Phase 2.2：游戏流程监控服务（2天）

**新文件：** `electron/game-flow-monitor.js`

```javascript
/**
 * 游戏流程监控服务
 * 监听游戏阶段变化，在关键时刻触发相应操作
 */

let currentPhase = null
let phaseChangeCallback = null
let gameStartedCallback = null
let augmentSelectCallback = null

/**
 * 启动游戏流程监控
 */
export async function startGameFlowMonitor(lcuService, options = {}) {
  const pollInterval = options.pollInterval || 1000

  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      try {
        const phase = await lcuService.getGameflowPhase()

        if (phase !== currentPhase) {
          console.log(`📍 游戏阶段变化: ${currentPhase} → ${phase}`)
          currentPhase = phase

          // 触发阶段变化回调
          if (phaseChangeCallback) {
            phaseChangeCallback(phase)
          }

          // 阶段特定处理
          handlePhaseChange(phase, lcuService, options)
        }
      } catch (error) {
        console.warn('监控游戏流程出错:', error.message)
      }
    }, pollInterval)

    resolve(timer)
  })
}

/**
 * 处理阶段变化
 */
function handlePhaseChange(phase, lcuService, options) {
  switch(phase) {
    case 'GameStart':
      console.log('🎮 游戏开始加载')
      if (gameStartedCallback) {
        gameStartedCallback()
      }

      // 如果启用了自动截图，在游戏开始后立即启动
      if (options.enableAutoScreenshot) {
        console.log('📸 启动自动截图服务')
        // 触发自动截图启动
      }
      break

    case 'InProgress':
      console.log('⚔️ 游戏进行中 - 开始监控海克斯选择')
      // 这个阶段的前30秒内可能发生海克斯选择
      // 启动密集的截图和分析
      break

    case 'WaitingForStats':
      console.log('📊 游戏已结束，等待结果')
      // 停止所有截图和分析
      break

    default:
      console.log(`其他阶段: ${phase}`)
  }
}

/**
 * 注册阶段变化回调
 */
export function onPhaseChange(callback) {
  phaseChangeCallback = callback
}

/**
 * 注册游戏开始回调
 */
export function onGameStarted(callback) {
  gameStartedCallback = callback
}

/**
 * 停止游戏流程监控
 */
export function stopGameFlowMonitor(timer) {
  if (timer) {
    clearInterval(timer)
  }
}
```

---

### Phase 2.3：游戏内截图和分析流程（3-4天）

**流程图：**
```
游戏进入 GameStart 阶段
  ↓
启动高频率截图（每100-500ms一张）
  ↓
进行图像分析（特征检测 + OCR）
  ↓
检测到海克斯选择界面？
  ├→ YES: 识别三个海克斯 + 查询胜率 + 显示浮窗
  └→ NO: 继续截图
  ↓
游戏进入 WaitingForStats 或其他阶段
  ↓
停止截图和分析
```

---

## 第三部分：快速集成建议

### 最小实现方案（2-3周内）

**优先级顺序：**

1. **第1周：游戏阶段检测**
   - 扩展 LCUService，添加 `getGameflowPhase()` 方法
   - 在 ChampionMonitor 中添加游戏流程监听
   - 验证可以正确检测 GameStart → InProgress 阶段变化

2. **第2周：自动截图集成**
   - 在游戏进入 InProgress 后自动启动定时截图
   - 设置合理的截图频率（建议每200-300ms一张）
   - 将截图保存到临时目录

3. **第3周：图像分析和识别**
   - 实现特征检测（颜色阈值检测海克斯卡片）
   - 集成 Tesseract.js 进行 OCR 识别
   - 显示识别结果到弹窗

---

## 第四部分：技术细节

### 海克斯选择界面特征

海克斯选择通常有以下特征：
- **位置：** 屏幕中央
- **三个矩形卡片：** 排成一行或三角形排列
- **颜色：**
  - 金色卡片：RGB 边框 (251, 191, 36)
  - 紫色卡片：RGB 边框 (192, 132, 252)
  - 蓝色卡片：RGB 边框 (96, 165, 250)
  - 棱彩卡片：RGB 边框 (200, 100, 150) 等
- **名称区域：** 卡片上方 1/4 处

### 截图参数建议

```javascript
// 游戏加载阶段 (GameStart)
const loadingPhaseConfig = {
  interval: 500,      // 每500ms截图一次（不需要太频繁）
  duration: 30000,    // 持续30秒（游戏加载通常<30s）
  analyzeInterval: 1000 // 每1秒分析一次
}

// 海克斯选择阶段 (InProgress 前30秒)
const augmentPhaseConfig = {
  interval: 100,      // 每100ms截图一次（高频率）
  duration: 35000,    // 持续35秒
  analyzeInterval: 200 // 每200ms分析一次（加快识别速度）
}
```

### 性能考虑

- **内存：** 每张截图 ~5-10MB，建议最多保存最近3-5张
- **CPU：** OCR 和特征检测会占用 20-30% CPU，建议使用 Worker 线程
- **网络：** 不需要网络，所有数据本地处理

---

## 当前状态和下一步

✅ **已完成：**
- LCUService 基础框架
- 英雄选择监控（ChampionMonitor）
- 海克斯胜率查询（Feature 1）

⏳ **待实现（优先级）：**
1. 扩展 LCUService - 游戏阶段检测
2. 游戏流程监控服务
3. 图像特征检测模块
4. OCR 识别模块
5. 游戏内浮窗显示

---

## 答案总结

**Q: 游戏开始的 API 是什么？**

A: 使用 LCU API 的 `/lol-gameflow/v1/gameflow-phase` 端点：
- 实时获取游戏当前阶段（ChampSelect, GameStart, InProgress 等）
- 轮询间隔：建议 1000ms（1秒）
- 无需额外认证（已包含在 LCU 令牌中）

**Q: 如何检测海克斯选择界面？**

A: 两步方案：
1. **等待触发：** 监听 GameStart → InProgress 的阶段变化
2. **视觉检测：** 定期截图，使用颜色特征检测和 OCR 识别海克斯卡片

**推荐实现顺序：**
```
Week 1: 添加 getGameflowPhase() 方法到 LCUService
Week 2: 创建 game-flow-monitor.js 服务，监听阶段变化
Week 3: 实现图像分析（特征检测 + OCR）
```

---

**预期完成时间：** 3-4 周
**难度等级：** 中等（相比 Feature 1，需要更多的图像处理知识）
