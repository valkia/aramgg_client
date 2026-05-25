# 海克斯检测方案 - 架构变更说明

## 【2026-01-31】方案更新：从颜色检测 → OCR识别

### 背景

之前实现了基于**颜色特征检测**的海克斯卡片识别方案，但在实际使用中遇到了严重问题：

#### 问题1：高误检率
- **现象**：非海克斯UI界面也被识别为海克斯
- **原因**：游戏中其他UI元素（菜单、按钮、背景等）也包含类似的颜色组合（白色、金色、紫色等）
- **结果**：在36张非海克斯截图中误检了29张（误检率83%）

#### 问题2：检测不稳定
- **现象**：真实海克斯截图中某些颜色无法被正确检测
- **原因**：不同分辨率、光照条件、图形设置下，同一颜色的RGB/HSV值变化很大
- **结果**：算法需要不断调整阈值，维护成本高

#### 问题3：阈值调试困难
- **现象**：提高某一阈值以减少误检时，往往导致真正的海克斯无法被检测
- **原因**：颜色特征检测本质上就是一个难以完全准确的方案
- **结果**：無法找到平衡点（17张真实海克斯中仅检测到16张、同时误检29张）

### 新方案：OCR识别

#### 核心思想
不再依赖**颜色特征**，而是直接**识别文本内容**：

1. **提取屏幕中央区域** → 海克斯卡片通常显示在屏幕中央
2. **进行OCR文本识别** → 识别海克斯的中文名称
3. **匹配数据库** → 与已知海克斯列表进行匹配
4. **返回识别结果** → 如果识别到海克斯名称，则确认为海克斯选择界面

#### 优势
- ✅ **准确率高** - 直接识别文本内容，不易混淆
- ✅ **鲁棒性强** - 不受颜色、分辨率、光照的影响
- ✅ **易于维护** - 只需维护海克斯数据库即可，无需调整复杂的颜色阈值
- ✅ **易于扩展** - 支持多语言、新增海克斯时无需修改检测逻辑

#### 劣势
- ⚠️ **需要OCR库** - 需要集成Tesseract.js或其他OCR库
- ⚠️ **性能开销** - OCR识别比颜色检测耗时较长
- ⚠️ **依赖质量** - OCR识别质量取决于第三方库

### 实现进度

**已完成**：
- ✅ 去掉复杂的颜色检测逻辑
- ✅ 简化置信度判断（改为简单的是/否）
- ✅ 设计OCR识别框架
- ✅ 预留OCR集成接口

**待实现**：
- ⏳ 集成Tesseract.js库
- ⏳ 实现performOCR()函数
- ⏳ 实现matchAugmentDatabase()函数
- ⏳ 测试和调优

### 代码位置

- **主要文件**：`electron/image-analyzer.js`
- **关键函数**：
  - `recognizeAugmentsFromImage()` - OCR识别主函数（第449行）
  - `performOCR()` - 执行OCR识别（待实现）
  - `matchAugmentDatabase()` - 匹配海克斯数据库（待实现）
  - `analyzeScreenshot()` - 分析截图入口（第521行）

### 使用方式（当OCR集成完成后）

```javascript
// 用户按F1截图
// → 自动调用 analyzeScreenshot()
// → recognizeAugmentsFromImage() 进行OCR识别
// → 识别到海克斯名称
// → 显示海克斯信息

// 无需任何参数调整或颜色阈值配置
```

### 海克斯数据库

数据库位置：`electron/image-analyzer.js` 第48-58行

```javascript
const AUGMENT_DATABASE = {
    'dragonsflair': { id: 'dragonsflair', rarity: 'gold', name: '龙的光彩' },
    'timekeeper': { id: 'timekeeper', rarity: 'gold', name: '时间守护者' },
    // ... 更多海克斯
}
```

将来OCR识别的文本将与这个数据库进行模糊匹配。

### 下一步

1. **集成OCR库**
   ```bash
   npm install tesseract.js
   ```

2. **实现performOCR()**
   ```javascript
   async function performOCR(imageBuffer) {
       const { createWorker } = require('tesseract.js')
       const worker = await createWorker('chi_sim')
       const result = await worker.recognize(imageBuffer)
       await worker.terminate()
       return result.data.text
   }
   ```

3. **实现matchAugmentDatabase()**
   ```javascript
   function matchAugmentDatabase(recognizedText) {
       // 从recognizedText中提取海克斯名称
       // 与AUGMENT_DATABASE进行模糊匹配
       // 返回匹配的海克斯列表
   }
   ```

4. **测试验证**
   ```bash
   npm run build
   npm run test:screenshots
   ```

### 备注

这个方案变更是基于实际使用反馈做出的**战略性调整**。虽然颜色检测在理论上可行，但在实践中的复杂性和维护成本远高于OCR识别。

此外，游戏UI通常设计为**视觉清晰可辨**，这天然适合OCR识别，比依赖精确的颜色匹配更可靠。

---

**最后更新**：2026-01-31
**相关人员**：Claude Code AI
**方案状态**：实现中
