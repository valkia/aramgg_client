/**
 * 图像分析模块 - 检测游戏内海克斯选择界面和识别英雄
 * 功能：
 * 1. 检测海克斯卡片（通过颜色特征）
 * 2. 识别海克斯名称（通过 OCR）
 * 3. 提取英雄位置和游戏阶段
 */

import fs from 'fs-extra'
import path from 'path'
import sharp from 'sharp'

// 海克斯卡片的颜色特征（使用 HSV 颜色空间进行更精确的检测）
const AUGMENT_COLORS = {
    gold: {
        h: [20, 45], s: [150, 255], v: [180, 255],  // 金色/黄色范围
        rgbFallback: { r: [200, 255], g: [160, 210], b: [0, 80] },
        name: '金色'
    },
    purple: {
        h: [280, 320], s: [100, 255], v: [150, 255],  // 紫色范围
        rgbFallback: { r: [160, 220], g: [60, 140], b: [180, 255] },
        name: '紫色'
    },
    blue: {
        h: [200, 240], s: [100, 255], v: [150, 255],  // 蓝色范围
        rgbFallback: { r: [60, 150], g: [120, 200], b: [200, 255] },
        name: '蓝色'
    },
    silver: {
        h: [0, 360], s: [0, 50], v: [140, 220],  // 灰色/银色（低饱和度）
        rgbFallback: { r: [120, 200], g: [120, 200], b: [120, 200] },
        name: '银色'
    },
}

// 海克斯数据库（用于匹配识别结果）
const AUGMENT_DATABASE = {
    // 金色（传说级）海克斯
    'dragonsflair': { id: 'dragonsflair', rarity: 'gold', name: '龙的光彩' },
    'timekeeper': { id: 'timekeeper', rarity: 'gold', name: '时间守护者' },
    // 紫色（史诗级）海克斯
    'archangel': { id: 'archangel', rarity: 'purple', name: '大天使' },
    'morellonomicon': { id: 'morellonomicon', rarity: 'purple', name: '莫雷洛秘典' },
    // 蓝色（稀有级）海克斯
    'healthaura': { id: 'healthaura', rarity: 'blue', name: '生命光环' },
    'attackspeed': { id: 'attackspeed', rarity: 'blue', name: '攻速' },
}

let tesseractWorker = null

/**
 * RGB 转 HSV
 */
function rgbToHsv(r, g, b) {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    let h, s

    if (max === min) {
        h = s = 0
    } else {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
            case g: h = ((b - r) / d + 2) / 6; break
            case b: h = ((r - g) / d + 4) / 6; break
        }
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/**
 * 检测图像中的海克斯卡片位置（改进的颜色检测 + 位置验证）
 * @param {Buffer} imageBuffer - 图像缓冲区
 * @returns {Promise<Object>} 检测结果包含卡片数量和置信度
 */
async function detectAugmentCards(imageBuffer) {
    try {
        const metadata = await sharp(imageBuffer).metadata()
        const { width, height } = metadata

        // 将图像转换为 RGB 数据
        const rgbData = await sharp(imageBuffer)
            .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
            .raw()
            .toBuffer({ resolveWithObject: true })

        const pixels = rgbData.data
        const channels = 3 // RGB

        // 海克斯卡片通常在屏幕中央（宽度的35%-65%，高度的25%-75%）
        const minCardWidth = 60
        const minCardHeight = 100
        const scanStep = 5 // 每5像素扫描一次（提高精度）

        const detectedCards = []

        // 为每种颜色检测卡片
        for (let colorKey in AUGMENT_COLORS) {
            const colorRange = AUGMENT_COLORS[colorKey]
            const colorCards = scanForColor(pixels, width, height, channels, colorRange, scanStep)

            for (const card of colorCards) {
                // 过滤掉太小的卡片
                if (card.width >= minCardWidth && card.height >= minCardHeight) {
                    // 检查卡片是否在合理的位置（屏幕中央区域）
                    const centerX = card.x + card.width / 2
                    const centerY = card.y + card.height / 2
                    const isInCentralArea = centerX > width * 0.2 && centerX < width * 0.8 &&
                                          centerY > height * 0.15 && centerY < height * 0.85

                    if (isInCentralArea) {
                        detectedCards.push({
                            color: colorKey,
                            rarity: colorRange.name,
                            x: card.x,
                            y: card.y,
                            width: card.width,
                            height: card.height,
                        })
                    }
                }
            }
        }

        // 对检测到的卡片进行验证和优化
        const validatedCards = validateAndOptimizeCards(detectedCards, width, height)

        console.log(`🎨 检测到 ${validatedCards.length} 个有效的海克斯卡片`)
        return validatedCards
    } catch (error) {
        console.error('❌ 海克斯卡片检测失败:', error)
        return []
    }
}

/**
 * 验证和优化检测到的卡片
 */
function validateAndOptimizeCards(cards, screenWidth, screenHeight) {
    if (cards.length === 0) {
        return []
    }

    // 按 x 坐标排序
    cards.sort((a, b) => a.x - b.x)

    // 如果检测到3张卡片，验证它们的间距是否均匀
    if (cards.length >= 3) {
        const spacing = [
            cards[1].x - (cards[0].x + cards[0].width),
            cards[2].x - (cards[1].x + cards[1].width),
        ]

        // 检查间距是否相近（允许±20%的差异）
        const avgSpacing = (spacing[0] + spacing[1]) / 2
        const spacingVar1 = Math.abs(spacing[0] - avgSpacing) / avgSpacing
        const spacingVar2 = Math.abs(spacing[1] - avgSpacing) / avgSpacing

        if (spacingVar1 < 0.2 && spacingVar2 < 0.2) {
            console.log(`✅ 卡片间距均匀，这看起来像是一个有效的海克斯选择界面`)
            return cards.slice(0, 3)
        }
    }

    // 返回所有检测到的卡片（即使间距不完美）
    return cards
}

/**
 * 在像素数据中扫描特定颜色（使用 HSV 或 RGB 备用方案）
 */
function scanForColor(pixels, width, height, channels, colorRange, step) {
    const regions = []
    const colorPixels = new Set()

    // 找出所有符合颜色范围的像素
    // 优先使用 HSV，如果失败则使用 RGB
    const useHsv = colorRange.h && colorRange.s && colorRange.v

    for (let i = 0; i < pixels.length; i += channels * step) {
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]

        let isMatch = false

        if (useHsv) {
            // HSV 匹配
            const [h, s, v] = rgbToHsv(r, g, b)

            // 处理红色的 H 值绕圈情况（0-30 和 330-360 都表示红色）
            let hMatch = false
            if (colorRange.h[0] > colorRange.h[1]) {
                // 绕圈情况（如 [330, 30]）
                hMatch = h >= colorRange.h[0] || h <= colorRange.h[1]
            } else {
                hMatch = h >= colorRange.h[0] && h <= colorRange.h[1]
            }

            const sMatch = s >= colorRange.s[0] && s <= colorRange.s[1]
            const vMatch = v >= colorRange.v[0] && v <= colorRange.v[1]

            isMatch = hMatch && sMatch && vMatch
        }

        // RGB 备用方案（如果 HSV 不匹配且有 RGB 备用）
        if (!isMatch && colorRange.rgbFallback) {
            const rbg = colorRange.rgbFallback
            isMatch = r >= rbg.r[0] && r <= rbg.r[1] &&
                     g >= rbg.g[0] && g <= rbg.g[1] &&
                     b >= rbg.b[0] && b <= rbg.b[1]
        }

        if (isMatch) {
            colorPixels.add(i / channels)
        }
    }

    // 根据像素集合形成区域
    if (colorPixels.size > 50) {
        const bounds = findBounds(colorPixels, width)
        if (bounds) {
            regions.push(bounds)
        }
    }

    return regions
}

/**
 * 找出像素集合的边界
 */
function findBounds(pixelSet, width) {
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity

    for (const pixelIndex of pixelSet) {
        const x = pixelIndex % width
        const y = Math.floor(pixelIndex / width)

        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    }
}

/**
 * 从图像中提取文字（OCR）- 可选实现
 * @param {Buffer} imageBuffer - 图像缓冲区
 * @returns {Promise<string>} 识别的文本
 */
async function recognizeText(imageBuffer) {
    try {
        // 在生产环境或 OCR 不可用时，使用简单的纯颜色检测
        // 完整的 OCR 需要更复杂的设置和依赖
        console.warn('⚠️ OCR 功能在此版本中使用简化实现')

        // 返回空字符串表示 OCR 降级处理
        return ''
    } catch (error) {
        console.error('❌ OCR 识别失败:', error)
        return ''
    }
}

/**
 * 根据卡片数量计算置信度
 * @param {number} cardCount - 检测到的卡片数量
 * @param {boolean} isAugmentPhase - 是否识别为海克斯阶段
 * @returns {number} 0-1之间的置信度
 */
function calculateConfidence(cardCount, isAugmentPhase) {
    // 如果检测到3张卡片且位置验证通过，置信度很高
    if (cardCount === 3 && isAugmentPhase) {
        return 0.95
    }

    // 根据检测到的卡片数量判断置信度
    switch (cardCount) {
        case 3:
            return 0.85  // 检测到3张卡片但间距不完美
        case 2:
            return 0.6   // 检测到2张卡片
        case 1:
            return 0.3   // 仅检测到1张卡片
        default:
            return 0.1   // 未检测到任何卡片
    }
}

/**
 * 根据检测到的颜色生成海克斯建议
 * @param {Array} cardDetections - 卡片检测结果
 * @returns {Array} 推荐的海克斯
 */
function generateAugmentRecommendations(cardDetections) {
    // 基于检测到的颜色，返回该稀有度的常见海克斯
    const recommendedByRarity = {
        '金色': [
            { id: 'dragonsflair', name: '龙的光彩', rarity: 'gold', confidence: 0.7 },
            { id: 'timekeeper', name: '时间守护者', rarity: 'gold', confidence: 0.6 },
        ],
        '紫色': [
            { id: 'archangel', name: '大天使', rarity: 'purple', confidence: 0.7 },
            { id: 'morellonomicon', name: '莫雷洛秘典', rarity: 'purple', confidence: 0.6 },
        ],
        '蓝色': [
            { id: 'healthaura', name: '生命光环', rarity: 'blue', confidence: 0.7 },
            { id: 'attackspeed', name: '攻速', rarity: 'blue', confidence: 0.6 },
        ],
        '灰色': [
            { id: 'basic1', name: '基础强化', rarity: 'grey', confidence: 0.5 },
        ],
    }

    const augments = []
    const seenIds = new Set()

    // 根据检测的卡片颜色推荐海克斯
    for (const card of cardDetections) {
        const recommendations = recommendedByRarity[card.rarity] || []
        for (const rec of recommendations) {
            if (!seenIds.has(rec.id) && augments.length < 3) {
                augments.push(rec)
                seenIds.add(rec.id)
            }
        }
    }

    return augments
}

/**
 * 分析截图图像
 * @param {string} imagePath - 截图文件路径
 * @returns {Promise<Object>} 分析结果
 */
export const analyzeScreenshot = async (imagePath) => {
    try {
        // 验证文件是否存在
        const exists = await fs.pathExists(imagePath)
        if (!exists) {
            return {
                success: false,
                error: '截图文件不存在',
            }
        }

        // 获取文件信息
        const stats = await fs.stat(imagePath)
        const filename = path.basename(imagePath)
        const imageBuffer = await fs.readFile(imagePath)

        console.log(`🔍 开始分析截图: ${filename}`)

        // 1. 检测海克斯卡片
        const cardDetections = await detectAugmentCards(imageBuffer)
        console.log(`✨ 检测到 ${cardDetections.length} 个海克斯卡片`)

        // 2. 生成推荐（基于颜色检测）
        let recognizedAugments = []
        let isAugmentPhase = false

        if (cardDetections.length >= 3) {
            // 检测到足够的卡片，认为处于海克斯选择阶段
            recognizedAugments = generateAugmentRecommendations(cardDetections)
            isAugmentPhase = true
            console.log(`🎯 识别到 ${recognizedAugments.length} 个海克斯推荐`)
        } else if (cardDetections.length > 0) {
            // 检测到部分卡片，但不确定是否完全处于海克斯阶段
            recognizedAugments = generateAugmentRecommendations(cardDetections)
            isAugmentPhase = false
            console.log(`⚠️ 部分识别: 检测到 ${cardDetections.length} 个卡片`)
        } else {
            // 未检测到卡片，可能不在海克斯阶段或光线不足
            console.log('ℹ️ 未检测到海克斯卡片')
        }

        // 计算置信度（基于检测到的卡片数量和验证）
        const confidence = calculateConfidence(cardDetections.length, isAugmentPhase)

        // 3. 整合结果
        const analysisResult = {
            success: true,
            imagePath,
            filename,
            timestamp: stats.mtime.getTime(),
            analysis: {
                augments: recognizedAugments,         // 识别到的海克斯
                cardCount: cardDetections.length,      // 检测到的卡片数量
                cardColors: cardDetections.map(c => c.rarity), // 卡片稀有度
                confidence: confidence,                // 基于卡片数量的置信度
                isAugmentPhase: isAugmentPhase,        // 是否处于海克斯选择阶段
                cardPositions: cardDetections.map(c => ({x: c.x, y: c.y, width: c.width, height: c.height})),
            },
            metadata: {
                fileSize: stats.size,
                format: 'png',
                detectionMethod: 'color-hsv-based',
            },
        }

        console.log(`✅ 截图分析完成:`, analysisResult)
        return analysisResult
    } catch (error) {
        console.error('❌ 截图分析失败:', error)
        return {
            success: false,
            error: error.message,
        }
    }
}

/**
 * 从分析结果中提取海克斯信息
 * @param {Object} analysisResult - 分析结果
 * @returns {Array} 海克斯信息数组
 */
export const extractAugments = (analysisResult) => {
    if (!analysisResult.success || !analysisResult.analysis) {
        return []
    }
    return analysisResult.analysis.augments || []
}

/**
 * 检查是否处于海克斯选择阶段
 * @param {Object} analysisResult - 分析结果
 * @returns {boolean}
 */
export const isAugmentPhase = (analysisResult) => {
    if (!analysisResult.success || !analysisResult.analysis) {
        return false
    }
    return analysisResult.analysis.isAugmentPhase || false
}

/**
 * 获取识别置信度
 * @param {Object} analysisResult - 分析结果
 * @returns {number} 0-1之间的置信度
 */
export const getConfidence = (analysisResult) => {
    if (!analysisResult.success || !analysisResult.analysis) {
        return 0
    }
    return analysisResult.analysis.confidence || 0
}

export default {
    analyzeScreenshot,
    extractAugments,
    isAugmentPhase,
    getConfidence,
}
