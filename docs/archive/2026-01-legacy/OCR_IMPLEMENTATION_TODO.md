# OCR方案实现待办清单

## 📋 实现步骤

### Step 1: 安装Tesseract.js库
```bash
cd E:\ideaProject\lol_tips_client
npm install tesseract.js
```

### Step 2: 实现performOCR()函数
**文件**：`electron/image-analyzer.js` 第473-485行

```javascript
/**
 * 执行OCR识别
 * @param {Buffer} imageBuffer - 准备好的图像（裁剪、增强对比度）
 * @returns {Promise<string>} 识别的文本
 */
async function performOCR(imageBuffer) {
    try {
        const { createWorker } = require('tesseract.js')

        // 创建工作线程，使用简体中文模型
        const worker = await createWorker('chi_sim')

        // 执行文本识别
        const result = await worker.recognize(imageBuffer)

        // 清理资源
        await worker.terminate()

        // 提取识别的文本
        const recognizedText = result.data.text
        console.log(`📖 OCR识别文本: ${recognizedText.substring(0, 100)}...`)

        return recognizedText
    } catch (error) {
        console.error('❌ OCR识别失败:', error)
        return ''
    }
}
```

### Step 3: 实现matchAugmentDatabase()函数
**文件**：`electron/image-analyzer.js` 第487-510行

```javascript
/**
 * 从识别的文本匹配海克斯数据库
 * @param {string} recognizedText - OCR识别的文本
 * @returns {Array} 匹配的海克斯列表
 */
function matchAugmentDatabase(recognizedText) {
    if (!recognizedText || recognizedText.trim() === '') {
        return []
    }

    const augments = []
    const seenIds = new Set()

    // 遍历数据库中的所有海克斯
    for (const [key, augmentData] of Object.entries(AUGMENT_DATABASE)) {
        // 检查识别的文本中是否包含海克斯名称
        if (recognizedText.includes(augmentData.name)) {
            // 避免重复
            if (!seenIds.has(augmentData.id)) {
                augments.push({
                    id: augmentData.id,
                    name: augmentData.name,
                    rarity: augmentData.rarity,
                    confidence: 0.95,  // OCR识别成功的置信度
                })
                seenIds.add(augmentData.id)
            }
        }
    }

    console.log(`✅ 匹配到 ${augments.length} 个海克斯`)
    return augments
}
```

### Step 4: 更新recognizeAugmentsFromImage()函数
**文件**：`electron/image-analyzer.js` 第449-468行

在 `recognizeAugmentsFromImage()` 函数中，将注释部分取消，调用performOCR()和matchAugmentDatabase()：

```javascript
export const recognizeAugmentsFromImage = async (imageBuffer) => {
    try {
        const metadata = await sharp(imageBuffer).metadata()
        const { width, height } = metadata

        console.log(`🔍 【OCR】开始识别海克斯名称 (${width}x${height})`)

        // 提取屏幕中央的矩形区域（30%-70%）用于OCR识别
        const cropX = Math.round(width * 0.3)
        const cropY = Math.round(height * 0.3)
        const cropWidth = Math.round(width * 0.4)
        const cropHeight = Math.round(height * 0.4)

        // 裁剪并增强对比度以便OCR识别
        const croppedBuffer = await sharp(imageBuffer)
            .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
            .modulate({
                brightness: 1.1,
                contrast: 1.5,
                saturation: 0.5
            })
            .toBuffer()

        // 执行OCR识别
        const recognizedText = await performOCR(croppedBuffer)

        // 匹配数据库
        const augments = matchAugmentDatabase(recognizedText)

        return augments
    } catch (error) {
        console.error('❌ OCR 识别失败:', error)
        return []
    }
}
```

## 🧪 测试步骤

### 构建项目
```bash
npm run build
```

### 运行基本测试
```bash
# 测试真实海克斯截图（q1-q17）
node electron/test-real-augments.js

# 测试所有截图
npm run test:screenshots
```

### 预期结果
- ✅ 真实海克斯截图（q1-q17）应该100%被识别
- ✅ 非海克斯截图应该0%被误检（识别为augments为空）
- ✅ 识别速度：每张截图 < 2秒（受OCR库性能影响）

## 📝 关键要点

### 海克斯数据库位置
`electron/image-analyzer.js` 第48-58行

目前包含的海克斯：
- 龙的光彩 (dragonsflair) - 金色
- 时间守护者 (timekeeper) - 金色
- 大天使 (archangel) - 紫色
- 莫雷洛秘典 (morellonomicon) - 紫色
- 生命光环 (healthaura) - 蓝色
- 攻速 (attackspeed) - 蓝色

**需要扩展数据库**：将英雄联盟中所有海克斯加入到AUGMENT_DATABASE中

### OCR识别的工作流程
```
截图文件
  ↓
读取为Buffer
  ↓
裁剪中央区域（30%-70%）
  ↓
增强对比度（便于OCR识别）
  ↓
performOCR() - Tesseract.js识别文本
  ↓
matchAugmentDatabase() - 模糊匹配海克斯名称
  ↓
返回识别的海克斯列表
```

### 性能考虑
- Tesseract.js首次运行会下载~65MB的模型文件
- 可以设置缓存以加快后续运行
- 考虑在后台预加载worker

## 🔍 调试技巧

如果OCR识别不到海克斯名称：

1. **检查裁剪区域**
   - 确认裁剪的是屏幕中央（30%-70%）
   - 可能需要调整裁剪坐标

2. **检查对比度增强**
   - 打印增强后的图像看是否清晰
   - 可能需要调整brightness/contrast值

3. **检查OCR模型**
   - 确认下载了chi_sim（简体中文）模型
   - 可以改用eng（英文）测试基础功能

4. **检查数据库匹配**
   - 打印recognizedText看OCR输出
   - 检查AUGMENT_DATABASE中的名称是否匹配

## 📚 相关文档
- [海克斯检测方案说明](./AUGMENT_DETECTION_STRATEGY.md) - 详细的战略说明
- [Tesseract.js文档](https://github.com/naptha/tesseract.js) - OCR库官方文档

---

**方案状态**：待实现
**优先级**：高
**估计工作量**：2-4小时（包括测试）
