# 完整功能架构总结

## 项目目标

构建 LOL 符文推荐助手的增强版本，通过 F1 快捷键自动截图 → 分析 → 显示胜率的完整流程。

## 已实现的两个功能

### ✅ 功能1: F1 快捷键截图 (COMPLETED)
- 快捷键注册和处理
- 全屏截图保存
- 自动清理旧截图
- IPC 通知渲染进程

**关键文件**:
- `electron/screenshot.js` ⭐
- `electron/main.js` (修改)
- `electron/preload.js` (修改)
- `package.json` (screenshot-desktop 依赖)

**工作流程**:
```
F1 按键 → 主进程捕获 → 截图保存 → IPC通知 → screenshot-taken事件
```

---

### ✅ 功能2: 浮动窗口显示胜率 (FRAMEWORK READY)
- 图像分析框架（待补充具体实现）
- 胜率查询框架（待补充具体实现）
- 浮动窗口UI（完全实现）
- IPC 通信管道

**关键文件**:
- `electron/image-analyzer.js` ⭐
- `src/src/service/winrate.js` ⭐
- `src/components/WinrateOverlay.vue` ⭐
- `electron/main.js` (修改)
- `src/components/Display.vue` (修改)

**工作流程**:
```
screenshot-taken事件 → 分析截图 → 查询胜率 → winrate-updated事件
→ WinrateOverlay浮窗 → 显示数据 → 10秒自动隐藏
```

---

## 核心数据流

```
┌──────────────────────────────────────────────────────────────┐
│                        F1 按键事件                           │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────▼──────────────────┐
         │   Electron 主进程                │
         │  (electron/main.js)              │
         ├──────────────────────────────────┤
         │ • globalShortcut.register('F1')  │
         │ • captureScreenshot()            │
         └───────────────┬────────────────┬─┘
                         │                │
        ┌────────────────▼─┐  ┌──────────▼─────────────┐
        │  screenshot-taken│  │  异步任务:分析+查询    │
        │  IPC 事件        │  │                       │
        └────────────────┬─┘  ├──────────────────────┤
                         │    │ 1. analyzeScreenshot │
                         │    │    (image-analyzer)  │
                         │    │                      │
                         │    │ 2. get-winrate IPC  │
                         │    │    (main.js)        │
                         │    │                      │
                         │    │ 3. send('winrate-   │
                         │    │    updated')        │
                         │    └──────────────────────┘
                         │
        ┌────────────────▼────────────────────────┐
        │      Vue 渲染进程                       │
        │   (Display.vue)                        │
        ├─────────────────────────────────────────┤
        │  • WinrateOverlay 组件                 │
        │  • 监听 winrate-updated 事件           │
        │  • 显示浮窗                            │
        │  • 10秒后自动隐藏                      │
        └─────────────────────────────────────────┘
```

## 文件结构

```
项目根目录/
├── electron/
│   ├── main.js                    ✏️ 修改: F1快捷键 + IPC处理
│   ├── preload.js                 ✏️ 修改: IPC白名单
│   ├── screenshot.js              ⭐ 新建: 截图功能
│   └── image-analyzer.js          ⭐ 新建: 图像分析框架
│
├── src/
│   ├── components/
│   │   ├── Display.vue            ✏️ 修改: 集成WinrateOverlay
│   │   ├── WinrateOverlay.vue     ⭐ 新建: 浮窗UI组件
│   │   ├── ShowDetail.vue         (原有)
│   │   └── ...
│   │
│   └── src/service/
│       ├── winrate.js             ⭐ 新建: 胜率查询框架
│       ├── lcu.js                 (原有)
│       ├── ddragon.js             (原有)
│       └── data-source/
│           ├── op-gg.js           (原有)
│           └── lol-qq.js          (原有)
│
├── package.json                   ✏️ 修改: +screenshot-desktop
├── IMPLEMENTATION_SUMMARY.md      📄 功能1总结
├── FEATURE2_WINRATE_OVERLAY.md    📄 功能2说明
└── 本文件                         📄 完整架构总结
```

## 每个模块的职责

### electron/screenshot.js
**职责**: 截图采集
- 调用 screenshot-desktop 库
- 保存截图到本地文件系统
- 管理文件生命周期

**导出函数**:
```javascript
captureScreenshot()              // 执行截图
getScreenshots()                 // 列出截图
cleanupOldScreenshots(keepCount) // 清理旧文件
```

### electron/image-analyzer.js
**职责**: 图像分析（框架）
- 读取截图文件
- 提取英雄、位置等信息
- 返回结构化分析结果

**导出函数**:
```javascript
analyzeScreenshot(imagePath)     // 分析单个截图
extractChampions(result)         // 提取英雄列表
extractPosition(result)          // 提取位置
extractPhase(result)             // 提取游戏阶段
```

**TODO**: 补充 OCR/图像识别逻辑

### src/src/service/winrate.js
**职责**: 胜率数据查询（框架）
- 查询英雄胜率
- 批量查询多个英雄
- 格式化数据用于展示
- 计算胜率评级

**导出函数**:
```javascript
getChampionWinrate(id, position) // 查询单个英雄
getChampionsWinrates(ids, pos)   // 批量查询
formatWinrateForDisplay(data)    // 格式化
getWinrateLevel(winrate)         // 计算评级
```

**TODO**: 补充具体查询逻辑（API/爬虫）

### src/components/WinrateOverlay.vue
**职责**: 浮窗UI展示
- 监听 winrate-updated 事件
- 显示胜率信息
- 管理浮窗生命周期
- 提供手动控制接口

**暴露方法**:
```javascript
showOverlay(data)   // 显示浮窗
closeOverlay()      // 关闭浮窗
refreshData()       // 刷新数据
```

**事件监听**:
```javascript
window.ipcRenderer.on('screenshot-taken', ...)
window.ipcRenderer.on('winrate-updated', ...)
```

### electron/main.js
**职责**: Electron 主进程协调
- 管理应用窗口
- 注册全局快捷键
- IPC 通信处理
- 进程间数据流转

**新增 IPC 处理程序**:
```javascript
ipcMain.handle('screenshot-capture')   // 手动截图
ipcMain.handle('analyze-screenshot')   // 分析截图
ipcMain.handle('get-winrate')          // 查询胜率
```

**新增快捷键**:
```javascript
globalShortcut.register('F1', ...)     // F1截图+分析+查询
```

---

## IPC 通信通道

### 主进程 → 渲染进程

| 事件名 | 数据结构 | 来源 | 触发时机 |
|--------|--------|------|---------|
| `screenshot-taken` | `{ success, filepath, filename, timestamp }` | F1快捷键 | 截图完成 |
| `winrate-updated` | `{ champion, stats, runes, items, ... }` | 胜率查询 | 分析完成 |

### 渲染进程 → 主进程

| IPC方法 | 参数 | 返回值 | 用途 |
|--------|------|--------|------|
| `invoke('screenshot-capture')` | 无 | 截图结果 | 手动截图 |
| `invoke('analyze-screenshot', imagePath)` | 图片路径 | 分析结果 | 分析截图 |
| `invoke('get-winrate', data)` | champions, position | 胜率数据 | 查询胜率 |

---

## 配置和常量

### 截图存储位置
```
~/.lol-tips-client/screenshots/
├── screenshot-1706234567890.png
├── screenshot-1706234568901.png
└── ...
```

### 胜率评级标准
```
≥55%    → 强势  (🔥 红色)
52-55%  → 优势  (📈 橙色)
48-52%  → 均衡  (⚖️ 绿色)
45-48%  → 劣势  (📉 蓝色)
<45%    → 弱势  (❌ 灰色)
```

### 浮窗位置
```
'top-right'      (默认, 右上角)
'top-left'       (左上角)
'bottom-right'   (右下角)
'bottom-left'    (左下角)
```

---

## 待实现的具体功能（需要你的需求）

### 🔴 高优先级

1. **图像分析具体实现**
   - 如何识别英雄名称？（OCR？特征匹配？）
   - 如何识别位置标识？
   - 如何检测游戏阶段？
   - 需要哪些第三方库？

2. **胜率数据来源**
   - 使用 OP.GG？（已有爬虫代码）
   - 使用 LOL.QQ.COM？（已有API调用）
   - 使用其他来源？
   - 是否需要缓存机制？

3. **浮窗内容定制**
   - 除了胜率、选择率、禁用率外，还需要什么数据？
   - 需要显示推荐符文和装备吗？
   - 需要显示对位克制信息吗？

### 🟡 中优先级

4. **性能优化**
   - 图像分析速度要求？
   - 数据缓存策略？
   - 并发查询限制？

5. **错误处理**
   - 无法识别英雄时如何处理？
   - 无法获取数据时如何处理？
   - 用户交互反馈？

6. **用户配置**
   - 浮窗位置可配置？
   - 自动隐藏时间可配置？
   - 数据源选择？

### 🟢 低优先级

7. **高级功能**
   - 截图历史记录？
   - 多英雄对比？
   - 自定义提示音？
   - 胜率趋势图？

---

## 测试检查清单

- [ ] F1 按键能正常触发截图
- [ ] 截图文件正确保存到本地
- [ ] IPC 事件正确发送到渲染进程
- [ ] WinrateOverlay 组件正确显示
- [ ] 浮窗在10秒后自动隐藏
- [ ] 关闭按钮正常工作
- [ ] 刷新按钮能重新加载数据
- [ ] 错误情况下有适当提示

---

## 部署和构建

### 开发模式
```bash
npm run dev
```

### 生产构建
```bash
npm run pack
```

---

## 下一步

1. **提供具体需求**
   - Demo 截图示例（LOL 选人界面）
   - 具体的英雄识别方式
   - 需要显示的具体数据
   - UI 样式偏好

2. **补充实现**
   - 在 `image-analyzer.js` 中添加 OCR/图像识别逻辑
   - 在 `winrate.js` 中添加具体的 API 调用逻辑
   - 在 `main.js` 中完善 IPC 处理程序

3. **测试验证**
   - 单元测试
   - 集成测试
   - 端到端测试

---

## 联系和反馈

所有文档已准备就绪，框架完整，等待你的具体需求补充！

📄 相关文档:
- `IMPLEMENTATION_SUMMARY.md` - 功能1详细说明
- `FEATURE2_WINRATE_OVERLAY.md` - 功能2详细说明
- `本文件` - 完整架构总结
