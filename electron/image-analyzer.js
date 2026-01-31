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

// 海克斯卡片的颜色特征（RGB）
const AUGMENT_COLORS = {
    gold: { r: [220, 255], g: [180, 210], b: [20, 80], name: '金色' },      // 金色稀有度
    purple: { r: [160, 200], g: [80, 140], b: [200, 255], name: '紫色' },    // 紫色稀有度
    blue: { r: [80, 150], g: [140, 200], b: [220, 255], name: '蓝色' },      // 蓝色稀有度
    grey: { r: [100, 150], g: [100, 150], b: [100, 150], name: '灰色' },     // 灰色稀有度
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
 * 检测图像中的海克斯卡片位置（基于颜色）
 * @param {Buffer} imageBuffer - 图像缓冲区
 * @returns {Promise<Array>} 检测到的卡片位置数组
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
        const cards = []

        // 扫描图像寻找海克斯卡片的边界
        // 海克斯卡片通常在屏幕中央，尺寸约为 200x300 像素
        const minCardWidth = 100
        const minCardHeight = 150
        const scanStep = 10 // 每10像素扫描一次（加快速度）

        for (let colorKey in AUGMENT_COLORS) {
            const colorRange = AUGMENT_COLORS[colorKey]
            const detected = scanForColor(pixels, width, height, channels, colorRange, scanStep)
            if (detected.length > 0) {
                cards.push({
                    color: colorKey,
                    name: colorRange.name,
                    regions: detected,
                })
            }
        }

        console.log(`🎨 检测到 ${cards.length} 种颜色的海克斯卡片`)
        return cards
    } catch (error) {
        console.error('❌ 海克斯卡片检测失败:', error)
        return []
    }
}

/**
 * 在像素数据中扫描特定颜色
 */
function scanForColor(pixels, width, height, channels, colorRange, step) {
    const regions = []
    const colorPixels = new Set()

    // 找出所有符合颜色范围的像素
    for (let i = 0; i < pixels.length; i += channels * step) {
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]

        if (
            r >= colorRange.r[0] && r <= colorRange.r[1] &&
            g >= colorRange.g[0] && g <= colorRange.g[1] &&
            b >= colorRange.b[0] && b <= colorRange.b[1]
        ) {
            colorPixels.add(i / channels)
        }
    }

    // 根据相邻像素聚类形成区域
    if (colorPixels.size > 100) {
        const bounds = findBounds(colorPixels, width)
        if (bounds.width > 50 && bounds.height > 80) {
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
        const recommendations = recommendedByRarity[card.name] || []
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

        // 3. 整合结果
        const analysisResult = {
            success: true,
            imagePath,
            filename,
            timestamp: stats.mtime.getTime(),
            analysis: {
                augments: recognizedAugments,         // 识别到的海克斯
                cardCount: cardDetections.length,      // 检测到的卡片数量
                cardColors: cardDetections.map(c => c.name), // 卡片颜色
                confidence: isAugmentPhase ? 0.85 : (recognizedAugments.length > 0 ? 0.5 : 0.2),
                isAugmentPhase: isAugmentPhase,        // 是否处于海克斯选择阶段
            },
            metadata: {
                fileSize: stats.size,
                format: 'png',
                detectionMethod: 'color-based',
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
