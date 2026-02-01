# 游戏阶段检测快速测试指南

## 🚀 立即可验证的内容

### 1. 在开发工具控制台测试

启动应用后，在浏览器开发工具的控制台中运行：

```javascript
// 导入 LCU 服务
import LCUService from './service/lcu.js'
import configCache from './service/config-cache.js'

// 获取游戏路径
const lolPath = configCache.getLolPath() || "E:\\wegame\\英雄联盟(26)"

// 创建实例
const lcu = new LCUService(lolPath)

// 获取认证令牌（需要游戏客户端运行）
await lcu.getAuthToken()

// 测试 1：获取当前游戏阶段
const phase = await lcu.getGameflowPhase()
console.log('当前游戏阶段:', phase)

// 测试 2：获取游戏会话信息
const session = await lcu.getGameflowSession()
console.log('游戏会话:', session)

// 测试 3：轮询游戏阶段变化
const timerId = await lcu.pollGameflowPhase((phase) => {
  console.log('🔄 游戏阶段变化:', phase)
}, 1000) // 每1秒轮询一次

// 30秒后停止轮询
setTimeout(() => {
  lcu.stopPollGameflowPhase(timerId)
  console.log('轮询已停止')
}, 30000)
```

### 2. 测试场景和预期输出

**场景 A：在大厅阶段**
```javascript
// 输入
await lcu.getGameflowPhase()

// 预期输出
"Lobby"
```

**场景 B：进入选人阶段**
```javascript
// 预期看到:
📍 游戏阶段变化: Lobby → ChampSelect
🎯 进入选人阶段
```

**场景 C：游戏开始加载**
```javascript
// 预期看到:
📍 游戏阶段变化: ChampSelect → GameStart
🎮 游戏开始加载
```

**场景 D：游戏进行中（海克斯选择时机）**
```javascript
// 预期看到:
📍 游戏阶段变化: GameStart → InProgress
⚔️ 游戏进行中 - 海克斯选择可能即将开始
```

### 3. 所有可能的游戏阶段

| 英文 | 中文 | 说明 |
|------|------|------|
| Lobby | 大厅 | 等待进入匹配或组队 |
| Matchmaking | 匹配中 | 寻找对手 |
| CheckedIntoGame | 已进入游戏 | 确认已进入游戏 |
| ReadyCheck | 准备确认 | 等待所有玩家确认 |
| ChampSelect | 选人阶段 | 正在选英雄和符文 |
| GameStart | 游戏加载 | 游戏开始加载中 |
| InProgress | 游戏进行中 | ⭐ **海克斯选择发生在这个阶段前30秒** |
| WaitingForStats | 等待结果 | 游戏结束，等待统计 |
| PreEndOfGame | 游戏结束（统计） | 结算界面 |
| EndOfGame | 游戏结束 | 最终结束 |

---

## 📊 响应数据结构参考

### getGameflowPhase() 响应

```javascript
"InProgress"  // 简单的字符串
```

### getGameflowSession() 响应

```javascript
{
  "phase": "InProgress",
  "isSpectating": false,
  "gameData": {
    "gameId": 1234567890,
    "platformId": "KR",
    "regionLocale": "ko_KR",
    "gameMode": "PRACTICETOOL",
    "mapId": 11,
    ...
  },
  "playerData": {
    "championId": 1,
    "summonerId": 123456789,
    "summonerName": "Nickname",
    ...
  },
  ...
}
```

---

## 🔌 集成到 ChampionMonitor 的示例

如果想立即在现有的 ChampionMonitor 中集成游戏流程检测：

```javascript
// 在 ChampionMonitor.vue 中添加：

import GameFlowMonitor from '../service/game-flow-monitor'

const gameFlowMonitor = ref(null)

const startChampionMonitor = async () => {
  // ... 现有代码 ...

  // 新增：启动游戏流程监控
  try {
    gameFlowMonitor.value = new GameFlowMonitor(lcuIns)

    // 监听游戏开始
    gameFlowMonitor.value.on('game-started', () => {
      console.log('✅ 游戏已开始，可以启动自动截图')
      // 触发自动截图启动
    })

    // 监听进入 InProgress 阶段
    gameFlowMonitor.value.on('augment-ready', () => {
      console.log('✅ 海克斯选择即将开始，启动高频率截图')
      // 启动密集截图和分析
    })

    gameFlowMonitor.value.start()
    console.log('游戏流程监控已启动')
  } catch (error) {
    console.error('启动游戏流程监控失败:', error)
  }
}

const stopChampionMonitor = () => {
  // 现有代码...

  // 新增：停止游戏流程监控
  if (gameFlowMonitor.value) {
    gameFlowMonitor.value.stop()
    gameFlowMonitor.value = null
  }
}

// 组件卸载时清理
onBeforeUnmount(() => {
  stopChampionMonitor()
})
```

---

## ✅ 验证清单

进行以下测试验证功能正常：

- [ ] **应用启动后**，在控制台能调用 `await lcu.getGameflowPhase()`
- [ ] **游戏客户端未运行时**，返回 null 或错误提示
- [ ] **游戏客户端运行时**，能正确返回当前阶段（如 "Lobby"）
- [ ] **在大厅和选人间切换**，能正确监听到阶段变化
- [ ] **进入选人阶段**，输出 `🎯 进入选人阶段`
- [ ] **游戏开始加载**，输出 `🎮 游戏开始加载`
- [ ] **游戏进行中**，输出 `⚔️ 游戏进行中 - 海克斯选择可能即将开始`
- [ ] **轮询可以正常启动和停止**

---

## 🔍 故障排查

### 问题 1：无法获取游戏阶段
```
Error: Cannot read property 'get' of undefined
```

**解决：** 确保游戏客户端已运行且已进入选人或游戏阶段

### 问题 2：返回 null
**可能原因：**
- 游戏客户端未运行
- LCU 认证失败
- 游戏在大厅/匹配阶段（某些版本可能返回 null）

**验证：**
```javascript
// 检查认证是否成功
const token = await lcu.getAuthToken()
console.log('认证结果:', token)

// 如果 token 不为 null，说明认证成功
// 再尝试获取阶段
```

### 问题 3：轮询不工作
```
⚠️ 轮询游戏阶段出错
```

**排查：**
```javascript
// 检查 LCU 服务是否正常
console.log('LCU 活跃状态:', lcu.active)
console.log('LCU URL:', lcu.url)
console.log('LCU Port:', lcu.port)
```

---

## 📈 下一步工作

当游戏流程检测验证完成后，下一步是：

1. **启动自动截图服务**
   - 在 `game-started` 事件时启动截图
   - 设置合理的截图频率

2. **实现特征检测**
   - 检测海克斯卡片的颜色和位置
   - 提取卡片区域用于 OCR

3. **集成 OCR 识别**
   - 识别海克斯名称
   - 模糊匹配到本地数据库

4. **显示游戏内浮窗**
   - 按照需求文档 2.3.5 的格式显示
   - 位置跟随卡片，上方偏移

---

## 📝 相关文件

- **核心实现：**
  - `src/service/lcu.js` - LCU 服务（已扩展）
  - `src/service/game-flow-monitor.js` - 游戏流程监控（新增）

- **计划文档：**
  - `docs/FEATURE_2_PLAN.md` - Feature 2 详细实现计划

---

祝测试顺利！有任何问题欢迎反馈。 🎮
