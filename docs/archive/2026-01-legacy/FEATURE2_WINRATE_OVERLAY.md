# 功能2: 浮动窗口显示胜率 - 实现说明

## 功能概述

**基于F1截图功能的扩展**，实现截图后自动分析并在浮动窗口中展示英雄胜率、选择率、禁用率等相关数据。

## 新增文件清单

### 1. ✅ `electron/image-analyzer.js` - 图像分析模块
**功能**: 对截图进行图像分析
```javascript
export const analyzeScreenshot(imagePath)        // 分析截图，提取英雄、位置等信息
export const extractChampions(analysisResult)    // 提取英雄列表
export const extractPosition(analysisResult)     // 提取位置信息
export const extractPhase(analysisResult)        // 提取游戏阶段
```

**返回数据结构**:
```javascript
{
  success: true,
  imagePath: string,
  filename: string,
  timestamp: number,
  analysis: {
    champions: [],        // 识别的英雄ID列表
    position: null,       // 'top' | 'jungle' | 'mid' | 'adc' | 'support'
    phase: null,          // 'pick' | 'ban' | 'game'
    confidence: 0,        // 置信度 0-1
  }
}
```

### 2. ✅ `src/src/service/winrate.js` - 胜率查询服务
**功能**: 查询英雄的胜率、选择率等数据
```javascript
export const getChampionWinrate(championId, position, options)     // 查询单个英雄胜率
export const getChampionsWinrates(championIds, position)           // 批量查询
export const formatWinrateForDisplay(winrateData)                  // 格式化用于展示
export const getWinrateLevel(winrate)                              // 获取胜率评级
```

**胜率评级**:
| 胜率 | 等级 | 颜色 | Emoji |
|------|------|------|-------|
| ≥55% | 强势 | 红色 | 🔥 |
| 52-55% | 优势 | 橙色 | 📈 |
| 48-52% | 均衡 | 绿色 | ⚖️ |
| 45-48% | 劣势 | 蓝色 | 📉 |
| <45% | 弱势 | 灰色 | ❌ |

### 3. ✅ `src/components/WinrateOverlay.vue` - 浮动窗口组件
**功能**: 在界面上显示胜率浮窗

**特性**:
- 📍 固定位置浮窗（可配置 top-right/top-left/bottom-right/bottom-left）
- 🎨 精美梯度背景和动画效果
- ⏱️ 自动隐藏（10秒后）
- 📊 显示胜率、选择率、禁用率、游戏次数
- 🎯 显示推荐符文和装备
- 🔄 手动刷新功能
- 📱 响应式设计

**浮窗显示内容**:
```
┌─────────────────────────┐
│ 英雄名称 [位置标签] [X] │
├─────────────────────────┤
│ 胜率 🔥   选择率        │
│ 52.5%    15.2%         │
│ 强势     禁用率: 8.3%  │
├─────────────────────────┤
│ 推荐符文                │
│ [符文1] [符文2]        │
├─────────────────────────┤
│ 推荐装备                │
│ [装备1] [装备2]        │
├─────────────────────────┤
│ [刷新] [详情]          │
└─────────────────────────┘
```

## 修改的文件

### 1. ✅ `electron/main.js`
**添加内容**:
```javascript
// 导入新模块
import { analyzeScreenshot, extractChampions, extractPosition } from './image-analyzer.js'

// 新增 IPC 处理程序
ipcMain.handle('analyze-screenshot', async (event, imagePath) => {
    const result = await analyzeScreenshot(imagePath)
    return result
})

ipcMain.handle('get-winrate', async (event, data) => {
    // 查询胜率
    const result = { /* ... */ }
    return result
})

// F1 快捷键增强
globalShortcut.register('F1', async () => {
    // 1. 截图
    // 2. 异步分析截图
    // 3. 查询胜率
    // 4. 通过 IPC 发送 'winrate-updated' 事件
})
```

### 2. ✅ `electron/preload.js`
**修改内容**: 添加 'winrate-updated' 到 IPC 接收白名单

### 3. ✅ `src/components/Display.vue`
**修改内容**: 添加 `<WinrateOverlay ref="winrateOverlay" />` 组件

## 完整的工作流程

```
用户按 F1 键
    ↓
主进程捕获快捷键
    ↓
执行 captureScreenshot()
    ↓
发送 'screenshot-taken' 事件到渲染进程
    ↓
异步执行 analyzeScreenshot()
    ├─ 识别英雄、位置、游戏阶段
    ├─ 返回 champions、position 等信息
    ↓
查询 get-winrate 的 IPC 处理程序
    ├─ 根据英雄和位置查询胜率
    ├─ 获取推荐符文、装备
    ↓
发送 'winrate-updated' 事件到渲染进程
    ↓
WinrateOverlay 组件接收事件
    ├─ 更新浮窗数据
    ├─ 计算胜率评级和颜色
    ├─ 显示浮窗
    ├─ 10秒后自动隐藏
```

## 前端集成方式

### 在 Display.vue 中：
```vue
<template>
  <div>
    <!-- 其他内容 -->
    <WinrateOverlay ref="winrateOverlay" />
  </div>
</template>

<script setup>
import WinrateOverlay from './WinrateOverlay.vue'
const winrateOverlay = ref(null)

// 组件会自动接收来自主进程的事件
// window.ipcRenderer.on('winrate-updated', (data) => { ... })
</script>
```

### 手动控制浮窗：
```javascript
// 显示浮窗
winrateOverlay.value?.showOverlay({
  champion: {
    name: '亚索',
    position: 'mid',
    winrate: 48.5,
  },
  stats: {
    winrate: '48.5%',
    pickRate: '12.1%',
    banRate: '5.2%',
    playCount: '50000+',
  },
  runes: ['感电', '猎人：冰川', '眼球收集器', '贪欲猎手'],
  items: ['卢登的激荡', '正义荣耀', '中亚沙漏'],
  dataSource: 'OP.GG',
})

// 关闭浮窗
winrateOverlay.value?.closeOverlay()

// 刷新数据
winrateOverlay.value?.refreshData()
```

## 浮窗样式特性

✅ **梯度背景** - 紫蓝色梯度背景
✅ **动画效果** - 滑入和淡出动画
✅ **圆角设计** - 现代化UI
✅ **阴影效果** - 增强立体感
✅ **响应式**  - 自适应内容大小
✅ **颜色编码** - 胜率用颜色表示
✅ **Emoji图标** - 视觉化信息

## 待补充的具体功能

您提到后续补充具体需求，这里是框架中的 TODO 部分：

1. **图像分析实现**
   - OCR 识别英雄名称
   - 图像特征识别（选人界面位置等）
   - 游戏阶段检测（选人/禁用/游戏中）

2. **胜率查询实现**
   - 调用 OP.GG API 或爬虫
   - 调用 LOL.QQ.COM API
   - 数据缓存机制

3. **UI 需求**
   - 是否需要更多统计数据
   - 是否需要对标按钮
   - 是否需要历史记录

4. **位置检测**
   - 根据位置选择合适的数据
   - 多选位置支持

## 测试步骤

1. 启动应用: `npm run dev`
2. 打开浏览器开发者工具
3. 按 F1 键截图
4. 观察：
   - Console 中的日志输出
   - 浮窗是否显示
   - 浮窗是否10秒后自动隐藏

## 文件修改统计

| 文件 | 操作 | 行数 | 用途 |
|------|------|------|------|
| `electron/image-analyzer.js` | 新建 | 90+ | 图像分析 |
| `src/src/service/winrate.js` | 新建 | 150+ | 胜率查询 |
| `src/components/WinrateOverlay.vue` | 新建 | 450+ | 浮窗UI |
| `electron/main.js` | 修改 | +50 | IPC处理 |
| `electron/preload.js` | 修改 | +1 | 白名单 |
| `src/components/Display.vue` | 修改 | +2 | 集成组件 |

**总计**: 3个新建文件 + 3个修改文件

---

## 下一步

等待你提供的具体需求：
1. 📸 Demo 截图示例
2. 🎯 具体的英雄识别方式（OCR/特征匹配/其他）
3. 📊 需要显示哪些具体的胜率数据
4. 🎨 UI 样式的调整需求
5. 🔗 数据源的选择（OP.GG/QQ官方/其他）
