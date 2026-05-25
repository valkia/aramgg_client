// 截图功能集成指南

## 后端实现完成清单 ✅

### 1. 核心模块
- **electron/screenshot.js** - 截图工具模块
  - `captureScreenshot()` - 执行截图
  - `getScreenshots()` - 列出所有截图
  - `cleanupOldScreenshots(keepCount)` - 清理旧截图

- **electron/main.js** 修改
  - 导入 captureScreenshot 和 cleanupOldScreenshots
  - 注册 F1 全局快捷键
  - 快捷键触发时执行截图
  - 截图完成后通过 IPC 发送 'screenshot-taken' 事件到渲染进程

- **electron/preload.js** 修改
  - 暴露 `window.ipc` 别名
  - 添加 'screenshot-taken' 到 IPC 接收白名单

### 2. 工作流程
```
用户按 F1 键
   ↓
主进程捕获快捷键事件
   ↓
调用 captureScreenshot()
   ↓
保存截图到 ~/.lol-tips-client/screenshots/{timestamp}.png
   ↓
通过 IPC 发送 'screenshot-taken' 事件到渲染进程
   ↓
前端接收事件，可在UI中显示或处理
   ↓
自动清理旧截图（保留最新10张）
```

### 3. 截图数据结构
```javascript
{
  success: boolean,
  filepath: string,        // 完整路径
  filename: string,        // 文件名
  timestamp: number,       // 时间戳
  error?: string          // 错误信息（如果失败）
}
```

## 前端集成方式

### 方式1: 在 Vue 组件中监听截图事件

```javascript
import { onMounted, ref } from 'vue'

export default {
  setup() {
    const latestScreenshot = ref(null)
    const screenshotList = ref([])

    onMounted(() => {
      // 监听来自主进程的截图完成事件
      window.ipcRenderer.on('screenshot-taken', (data) => {
        console.log('Screenshot captured:', data)
        latestScreenshot.value = data
        screenshotList.value.push(data)

        if (data.success) {
          // 显示成功提示
          console.log(`截图已保存到: ${data.filepath}`)
          // 可以在这里添加UI提示
        }
      })
    })

    return {
      latestScreenshot,
      screenshotList
    }
  }
}
```

### 方式2: 手动调用截图（需要渲染进程有权限）

```javascript
// 虽然 F1 会自动触发，但如果需要手动调用：
const manualCapture = async () => {
  try {
    const result = await window.ipcRenderer.invoke('screenshot-capture')
    console.log('Manual screenshot result:', result)
  } catch (error) {
    console.error('Failed to capture screenshot:', error)
  }
}
```

### 方式3: 在 Display.vue 中添加截图按钮示例

```vue
<template>
  <div class="display-container">
    <div v-if="latestScreenshot" class="screenshot-info">
      <p v-if="latestScreenshot.success">✅ 最新截图: {{ latestScreenshot.filename }}</p>
      <p v-else>❌ 截图失败: {{ latestScreenshot.error }}</p>
    </div>

    <button @click="manualCapture">手动截图</button>
    <p class="hint">💡 也可以按 F1 快捷键自动截图</p>
  </div>
</template>

<script setup>
import { onMounted, ref, onBeforeUnmount } from 'vue'

const latestScreenshot = ref(null)

const manualCapture = async () => {
  try {
    const result = await window.ipcRenderer.invoke('screenshot-capture')
    if (result.success) {
      console.log('Screenshot saved:', result.filepath)
    }
  } catch (error) {
    console.error('Screenshot failed:', error)
  }
}

onMounted(() => {
  window.ipcRenderer.on('screenshot-taken', (data) => {
    latestScreenshot.value = data
  })
})

onBeforeUnmount(() => {
  // 可以在这里取消监听，但由于preload已处理，可以不做
})
</script>

<style scoped>
.screenshot-info {
  padding: 10px;
  margin: 10px 0;
  background-color: #f5f5f5;
  border-radius: 4px;
}

.hint {
  color: #666;
  font-size: 12px;
  margin-top: 10px;
}
</style>
```

## 文件位置

截图文件保存到用户主目录:
```
~/.lol-tips-client/screenshots/
├── screenshot-1706234567890.png
├── screenshot-1706234568901.png
└── ...
```

在 Windows 上通常是: `C:\Users\YourUsername\.lol-tips-client\screenshots\`

## 下一步任务

你提到后续会提供：
1. ✅ Demo 截图示例
2. ✅ 具体功能需求说明

我将根据你提供的信息添加图像分析功能（如 OCR 识别英雄名称等）。

## 测试 F1 快捷键

1. 启动应用 `npm run dev`
2. 打开浏览器开发者工具（Console）
3. 按 F1 键
4. 查看控制台输出：
   - "F1 pressed, capturing screenshot..."
   - "Screenshot saved: /path/to/screenshot-xxxxx.png"
5. 查看 ~/.lol-tips-client/screenshots/ 目录中是否有新文件生成
