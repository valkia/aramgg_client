/**
 * 图像分析模块 - 检测游戏内海克斯选择界面和识别英雄
 *
 * 【重要说明 - 2026-01-31】
 * 原计划使用颜色特征检测海克斯卡片，但该方案存在以下问题：
 * 1. 误检率高 - 游戏UI中其他元素也包含类似的颜色组合
 * 2. 检测不稳定 - 不同分辨率、光照条件下颜色阈值难以统一
 * 3. 维护成本高 - 需要针对每种截图情况调整复杂的颜色阈值
 *
 * 当前方案：OCR识别海克斯名称
 * - 直接OCR识别屏幕中央区域的文本
 * - 匹配海克斯数据库中的名称
 * - 更可靠、更简单、更易维护
 *
 * TODO: 实现OCR识别逻辑（需要集成Tesseract.js或其他OCR库）
 */

import sharp from 'sharp'
import path from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import logger from './modules/logger.js'

// ES Module 中获取 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 海克斯卡片的颜色特征（使用 HSV 颜色空间进行更精确的检测）
// 关键洞察：卡片的边框是亮白色，内部才是稀有度颜色
const AUGMENT_COLORS = {
    // 最重要：白色/明亮的卡片边框
    white: {
        // 白色/明亮色：宽松范围（能检测demo和真实截图）
        h: [0, 360], s: [0, 50], v: [220, 255],
        rgbFallback: { r: [200, 255], g: [200, 255], b: [200, 255] },
        name: '白色边框',
        minPixels: 100,
    },
    gold: {
        // 金色
        h: [20, 45], s: [100, 255], v: [180, 255],
        rgbFallback: { r: [200, 255], g: [160, 200], b: [0, 80] },
        name: '金色',
        minPixels: 50,
    },
    purple: {
        // 紫色
        h: [270, 330], s: [80, 255], v: [120, 255],
        rgbFallback: { r: [160, 220], g: [60, 140], b: [180, 255] },
        name: '紫色',
        minPixels: 50,
    },
    blue: {
        // 蓝色
        h: [200, 240], s: [80, 255], v: [120, 255],
        rgbFallback: { r: [60, 150], g: [120, 200], b: [200, 255] },
        name: '蓝色',
        minPixels: 50,
    },
}

// 加载完整的海克斯数据库
let AUGMENT_DATABASE = null

/**
 * 初始化海克斯数据库
 * 从 augments-base.json 加载完整列表并建立名称索引
 */
function initAugmentDatabase() {
    if (AUGMENT_DATABASE !== null) {
        return AUGMENT_DATABASE
    }

    try {
        const augmentsPath = path.join(__dirname, 'data', 'augments-base.json')
        const augmentsData = JSON.parse(readFileSync(augmentsPath, 'utf-8'))

        // 建立按名称索引的数据库（用于快速查找）
        AUGMENT_DATABASE = {}
        for (const augment of augmentsData) {
            // 稀有度映射
            const rarityMap = {
                'kSilver': 'silver',
                'kGold': 'gold',
                'kPrismatic': 'prismatic'
            }

            AUGMENT_DATABASE[augment.id] = {
                id: augment.id,
                name: augment.name,
                rarity: rarityMap[augment.rarity] || 'unknown',
                iconPath: augment.iconPath
            }
        }

        logger.info(`📚 海克斯数据库已加载: ${Object.keys(AUGMENT_DATABASE).length} 个海克斯`)
        return AUGMENT_DATABASE
    } catch (error) {
        logger.error('❌ 加载海克斯数据库失败:', error)
        // 使用空数据库作为备份
        AUGMENT_DATABASE = {}
        return AUGMENT_DATABASE
    }
}

let tesseractWorker = null

/**
 * RGB 转 HSV（正确的 HSV 计算，不是 HSL）
 */
function rgbToHsv(r, g, b) {
    r /= 255
    g /= 255
    b /= 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min

    let h = 0
    let s = 0
    let v = max

    // 计算饱和度 S
    if (max !== 0) {
        s = delta / max
    }

    // 计算色相 H
    if (delta !== 0) {
        if (max === r) {
            h = ((g - b) / delta + (g < b ? 6 : 0)) / 6
        } else if (max === g) {
            h = ((b - r) / delta + 2) / 6
        } else {
            h = ((r - g) / delta + 4) / 6
        }
    }

    return [
        Math.round(h * 360),  // H: 0-360
        Math.round(s * 100),  // S: 0-100
        Math.round(v * 100)   // V: 0-100
    ]
}

/**
 * 检测图像中的海克斯卡片位置
 *
 * 【暂时跳过】颜色检测逻辑
 * 原方案在实际使用中误检率高，已改为OCR方案
 *
 * @param {Buffer} imageBuffer - 图像缓冲区
 * @returns {Promise<Array>} 返回空数组（由OCR逻辑处理）
 */
async function detectAugmentCards(imageBuffer) {
    try {
        logger.info(`📝 【信息】检测海克斯卡片 - 使用OCR方案（跳过颜色检测）`)
        // 实际检测工作由 recognizeAugmentsFromImage() 通过OCR处理
        return []
    } catch (error) {
        logger.error('❌ 海克斯卡片检测失败:', error)
        return []
    }
}

/**
 * 【已弃用 - OCR方案中不需要】
 * 分割合并在一起的卡片区域
 * 仅保留代码以便后续参考，不再被调用
 */
function splitMergedCards_DEPRECATED(cards, screenWidth, screenHeight, minWidth, minHeight, maxWidth, maxHeight) {
    const result = []

    for (const card of cards) {
        // 尝试分割成3张卡片
        const estimatedCardWidth = card.width / 3
        const estimatedCardHeight = card.height

        logger.info(`  分割: ${card.rarity} (${card.width}x${card.height}) 分割成3张，每张约 ${Math.round(estimatedCardWidth)}x${Math.round(estimatedCardHeight)}`)

        let validSplits = 0
        for (let i = 0; i < 3; i++) {
            const splitCard = {
                ...card,
                x: card.x + (i * estimatedCardWidth),
                width: estimatedCardWidth,
            }

            // 检查分割后的卡片是否在有效范围内
            if (splitCard.width >= minWidth && splitCard.width <= maxWidth &&
                splitCard.height >= minHeight && splitCard.height <= maxHeight) {
                logger.info(`    ✅ 分割卡片 ${i + 1}: 有效尺寸 ${Math.round(splitCard.width)}x${Math.round(splitCard.height)}`)
                result.push(splitCard)
                validSplits++
            } else {
                logger.info(`    ⚠️ 分割卡片 ${i + 1}: 无效尺寸 ${Math.round(splitCard.width)}x${Math.round(splitCard.height)}`)
            }
        }

        if (validSplits === 0) {
            // 如果分割没有得到有效卡片，保留原始卡片（稍后会被验证拒绝）
            logger.info(`    分割失败，保留原始卡片`)
            result.push(card)
        }
    }

    return result
}

/**
 * 【已弃用 - OCR方案中不需要】
 * 验证和优化检测到的卡片
 * 仅保留代码以便后续参考，不再被调用
 */
function validateAndOptimizeCards_DEPRECATED(cards, screenWidth, screenHeight) {
    if (cards.length === 0) {
        return []
    }

    // 按 x 坐标排序
    cards.sort((a, b) => a.x - b.x)

    // ✅ 步骤1：检查卡片宽度一致性
    const widths = cards.map(c => c.width)
    const maxWidth = Math.max(...widths)
    const minWidth = Math.min(...widths)
    const widthConsistency = minWidth / maxWidth

    if (widthConsistency < 0.85) {
        logger.info(`⚠️ 卡片宽度不一致（最小/最大 = ${widthConsistency.toFixed(2)} < 0.85），可能不是海克斯卡片`)
        return []
    }
    logger.info(`✓ 卡片宽度一致（比例: ${widthConsistency.toFixed(2)} >= 0.85）`)

    // ✅ 步骤1b：检查卡片Y坐标一致性（真实卡片在同一行）
    const yPositions = cards.map(c => c.y)
    const maxY = Math.max(...yPositions)
    const minY = Math.min(...yPositions)
    const yRange = maxY - minY

    // 真实海克斯的3张卡片应该在近似相同的垂直位置（允许少量偏差）
    // 但如果Y偏差太大（> 100px），说明卡片来自不同的UI层，可能是误检
    if (yRange > 100) {
        logger.info(`⚠️ 卡片Y坐标差异过大（范围: ${yRange}px > 100px），可能不是海克斯卡片`)
        return []
    }
    logger.info(`✓ 卡片Y坐标一致（范围: ${yRange}px <= 100px）`)

    // ✅ 步骤2：如果少于3张卡片，直接返回空
    if (cards.length < 3) {
        logger.info(`⚠️ 检测到 ${cards.length} 张卡片，少于3张，不符合海克斯选择界面`)
        return []  // ✅ 严格要求3张
    }

    // ✅ 步骤3：处理不同数量的候选卡片

    // 如果超过3张，检查是否是重叠的颜色层（位置相近）
    if (cards.length > 3) {
        logger.info(`⚠️ 检测到 ${cards.length} 张候选卡片，检查是否是多颜色层重叠...`)

        // 检查候选卡片的位置分布：真正的海克斯卡片应该分布在屏幕中央，且彼此相距约 300-400px
        // 首先尝试从白色边框卡片中选择（最可靠）
        const whiteCards = cards.filter(c => c.color === 'white')

        if (whiteCards.length >= 3) {
            // 如果有足够的白色卡片，只使用白色卡片
            logger.info(`✨ 检测到 ${whiteCards.length} 张白色边框卡片，使用白色优先策略`)
            cards = whiteCards.slice(0, 3)
        } else if (whiteCards.length > 0 && cards.length <= 6) {
            // 如果白色不足但不超过6张，可能是白色+其他颜色的混合
            // 检查卡片的x坐标分布，看是否确实是3个不同的位置
            cards.sort((a, b) => a.x - b.x)

            // 计算卡片之间的距离
            const distances = []
            for (let i = 1; i < cards.length; i++) {
                distances.push(cards[i].x - cards[i-1].x)
            }

            const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length
            const distanceVar = distances.map(d => Math.abs(d - avgDistance) / avgDistance)

            // 如果距离分布相对均匀（< 80%差异），说明这些卡片可能是同一组的多色层
            if (distanceVar.every(v => v < 0.8)) {
                logger.info(`✨ 候选卡片位置分布均匀（距离标准差 < 80%），尝试智能选择...`)

                // 将卡片分成3组，每组选择最佳代表
                const third = Math.floor(cards.length / 3)
                const groups = [
                    cards.slice(0, third),
                    cards.slice(third, third * 2),
                    cards.slice(third * 2)
                ]

                const selectedCards = groups.map((group, idx) => {
                    // 优先选择白色
                    const whiteInGroup = group.filter(c => c.color === 'white')
                    if (whiteInGroup.length > 0) {
                        return whiteInGroup[0]
                    }
                    // 否则选择宽度最大的
                    return group.reduce((a, b) => a.width > b.width ? a : b)
                })

                cards = selectedCards
                logger.info(`✨ 智能选择完成，得到 3 张卡片`)
            } else {
                // 距离分布不均匀，说明这不是真正的3张卡片
                logger.info(`⚠️ 候选卡片位置分布不均匀（距离标准差 >= 80%），可能不是海克斯界面`)
                return []
            }
        } else {
            // 超过6张或完全没有白色卡片，直接拒绝
            logger.info(`❌ 候选卡片过多（${cards.length} > 6）或缺少白色边框，不符合海克斯界面特征`)
            return []
        }
    }

    // 现在应该正好是3张了（或少于3张已被拒绝）
    if (cards.length === 3) {
        // ✅ 核心验证1：必须检测到多种颜色（是真实海克斯的标志）
        const colorSet = new Set(cards.map(c => c.color))
        const colorList = Array.from(colorSet)

        if (colorSet.size < 2) {
            // 单色卡片很可能是误检（比如菜单背景、UI等）
            logger.info(`⚠️ 单色卡片（仅${colorList[0]}），不符合海克斯特征。拒绝`)
            return []
        }

        logger.info(`✓ 多颜色卡片（${colorList.join(', ')}），符合海克斯特征`)

        const spacing = [
            cards[1].x - (cards[0].x + cards[0].width),
            cards[2].x - (cards[1].x + cards[1].width),
        ]

        // 如果有真实的间距（不是负数或太小），进行验证
        if (spacing[0] > 0 && spacing[1] > 0) {
            const avgSpacing = (spacing[0] + spacing[1]) / 2
            const spacingVar1 = Math.abs(spacing[0] - avgSpacing) / avgSpacing
            const spacingVar2 = Math.abs(spacing[1] - avgSpacing) / avgSpacing

            // ✅ 放宽间距要求：< 50%
            if (spacingVar1 < 0.5 && spacingVar2 < 0.5) {
                logger.info(`✅ 卡片验证通过：尺寸一致、位置正中央、间距均匀`)
                return cards.slice(0, 3)  // ✅ 只返回前3张
            } else {
                logger.info(`⚠️ 卡片间距不均匀（差异: ${(Math.max(spacingVar1, spacingVar2)*100).toFixed(1)}% > 50%）`)
                return []
            }
        } else {
            // 如果没有真实间距（分割出来的卡片），只检查尺寸一致性和位置
            logger.info(`✅ 卡片验证通过（分割卡片）：尺寸一致、位置正中央`)
            return cards.slice(0, 3)  // ✅ 接受分割出来的卡片
        }
    } else {
        // 少于3张
        logger.info(`⚠️ 卡片数量不足: ${cards.length} < 3`)
        return []
    }
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

    // ✅ 根据像素集合形成区域 - 更严格的阈值
    const minPixels = colorRange.minPixels || 200
    if (colorPixels.size > minPixels) {
        const bounds = findBounds(colorPixels, width)
        if (bounds) {
            regions.push(bounds)
        }
    } else if (colorPixels.size > 0) {
        logger.info(`⚠️ 颜色 ${colorRange.name} 检测到 ${colorPixels.size} 像素，少于最少要求 ${minPixels}，排除`)
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
 * 从图像中提取海克斯名称（OCR）
 * 识别屏幕中央区域的文本内容
 *
 * @param {Buffer} imageBuffer - 图像缓冲区
 * @returns {Promise<Array>} 识别的海克斯列表
 */
async function recognizeAugmentsFromImage(imageBuffer) {
    try {
        const metadata = await sharp(imageBuffer).metadata()
        const { width, height } = metadata

        logger.info(`🔍 【OCR】开始识别海克斯名称 (${width}x${height})`)

        // 根据分辨率判断截图类型，使用不同的裁剪策略
        let cropX, cropY, cropWidth, cropHeight

        // 判断是否为纯游戏画面（1920x1080）还是全屏含IDE（2560x1440）
        const isFullScreenWithIDE = width >= 2400 // 2560x1440 或更大
        const isPureGameScreen = width >= 1800 && width < 2400 // 1920x1080

        if (isFullScreenWithIDE) {
            // 全屏含IDE截图（如 q1-q17, demo3）
            // 海克斯卡片在屏幕右侧偏中央
            cropX = Math.round(width * 0.25)      // 从25%开始
            cropY = Math.round(height * 0.4)      // 从40%开始
            cropWidth = Math.round(width * 0.5)   // 50%宽度
            cropHeight = Math.round(height * 0.15) // 15%高度（只包含名称）
            logger.info(`  检测到：全屏含IDE截图`)
        } else if (isPureGameScreen) {
            // 纯游戏画面截图（如 demo1, demo2）
            // 海克斯卡片在屏幕正中央
            cropX = Math.round(width * 0.15)      // 从15%开始
            cropY = Math.round(height * 0.25)     // 从25%开始
            cropWidth = Math.round(width * 0.7)   // 70%宽度
            cropHeight = Math.round(height * 0.25) // 25%高度（包含名称 + 部分描述）
            logger.info(`  检测到：纯游戏画面截图`)
        } else {
            // 其他分辨率，使用默认策略
            cropX = Math.round(width * 0.2)
            cropY = Math.round(height * 0.3)
            cropWidth = Math.round(width * 0.6)
            cropHeight = Math.round(height * 0.15)
            logger.info(`  检测到：未知分辨率，使用默认裁剪`)
        }

        logger.info(`  裁剪区域: x=${cropX}, y=${cropY}, 宽=${cropWidth}, 高=${cropHeight}`)

        // 裁剪并进行强化预处理
        const croppedBuffer = await sharp(imageBuffer)
            .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
            .greyscale()  // 转为灰度图（提高文字识别）
            .normalize()  // 自动归一化对比度
            .linear(1.5, -(128 * 0.5))  // 增强对比度：contrast * pixel - offset
            .toBuffer()

        logger.info(`  🖼️ 已准备裁剪图像用于OCR识别（${cropWidth}x${cropHeight}）`)

        // 执行OCR识别
        const recognizedText = await performOCR(croppedBuffer)

        // 匹配数据库
        const augments = matchAugmentDatabase(recognizedText)

        return augments
    } catch (error) {
        logger.error('❌ OCR 识别失败:', error)
        return []
    }
}

/**
 * 执行OCR识别
 * @param {Buffer} imageBuffer - 准备好的图像（裁剪、增强对比度）
 * @returns {Promise<string>} 识别的文本
 */
async function performOCR(imageBuffer) {
    try {
        // 使用动态 import（ES Module 项目）
        const Tesseract = await import('tesseract.js')
        const { createWorker } = Tesseract

        // 创建工作线程，使用简体中文模型
        const worker = await createWorker('chi_sim')

        // 执行文本识别
        const result = await worker.recognize(imageBuffer)

        // 清理资源
        await worker.terminate()

        // 提取识别的文本
        const recognizedText = result.data.text
        logger.info(`📖 OCR识别文本: ${recognizedText.substring(0, 100)}...`)

        return recognizedText
    } catch (error) {
        logger.error('❌ OCR识别失败:', error)
        return ''
    }
}

/**
 * 计算两个字符串的编辑距离（Levenshtein距离）
 */
function editDistance(a, b) {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    )
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            matrix[i][j] = a[i - 1] === b[j - 1]
                ? matrix[i - 1][j - 1]
                : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1])
        }
    }
    return matrix[a.length][b.length]
}

/**
 * 在文本中滑动窗口查找与目标名称最相似的子串
 * @returns {{ index: number, distance: number } | null} 匹配位置和编辑距离
 */
function fuzzyFind(text, name) {
    const nameLen = name.length
    if (nameLen === 0 || text.length < nameLen) return null

    // 先尝试精确匹配
    const exactIndex = text.indexOf(name)
    if (exactIndex !== -1) {
        return { index: exactIndex, distance: 0, matchLen: nameLen }
    }

    // ⚠️ 名称太短（≤2字）不做模糊匹配，避免误匹配
    // 两字海克斯必须精确匹配（避免"大力"误匹配到"作寺"等）
    if (nameLen <= 2) return null

    // 滑动窗口模糊匹配（仅对≥3字的海克斯）
    // 允许的最大编辑距离：3字允许1个错误，4字以上允许 floor(len/3) 个错误
    const maxDistance = nameLen === 3 ? 1 : Math.floor(nameLen / 3)
    let bestMatch = null

    for (let i = 0; i <= text.length - nameLen; i++) {
        const window = text.slice(i, i + nameLen)
        const dist = editDistance(window, name)

        if (dist <= maxDistance) {
            if (!bestMatch || dist < bestMatch.distance) {
                bestMatch = { index: i, distance: dist, matchLen: nameLen }
            }
        }
    }

    return bestMatch
}

/**
 * 从识别的文本匹配海克斯数据库
 * @param {string} recognizedText - OCR识别的文本
 * @returns {Array} 匹配的海克斯列表
 */
function matchAugmentDatabase(recognizedText) {
    if (!recognizedText || recognizedText.trim() === '') {
        return []
    }

    // 确保数据库已初始化
    const database = initAugmentDatabase()

    // 黑名单：常见的描述性词汇（非海克斯名称，但容易被误匹配）
    // ⚠️ 注意：不要添加真实的海克斯名称到黑名单！
    const blacklist = new Set([
        // 属性描述词
        '攻击', '防御', '生命', '法术', '魔法',
        '技能', '冷却', '移速', '暴击', '吸血', '穿透',
        // 功能描述词
        '功能', '能力', '效果', '被动', '主动', '额外',
        '持续', '提供', '增加', '获得', '造成',
    ])

    const augments = []
    const seenIds = new Set()

    // 去除所有空格用于模糊匹配（OCR可能识别出"台风 帽"而不是"台风帽"）
    let normalizedText = recognizedText.replace(/\s+/g, '')

    // 将所有海克斯按名称长度降序排序（优先匹配长名称，避免"台风"匹配到"台风帽"）
    const sortedAugments = Object.values(database).sort((a, b) => {
        const aLen = a.name.replace(/\s+/g, '').length
        const bLen = b.name.replace(/\s+/g, '').length
        return bLen - aLen
    })

    // 收集所有候选匹配（逐步从文本中移除已匹配部分）
    const candidates = []
    const seenNames = new Set()

    for (const augmentData of sortedAugments) {
        const normalizedName = augmentData.name.replace(/\s+/g, '')

        // 跳过黑名单、已匹配的 ID、已匹配的相同名称
        if (blacklist.has(augmentData.name)) continue
        if (seenIds.has(augmentData.id)) continue
        if (seenNames.has(normalizedName)) continue

        // 使用模糊匹配查找
        const match = fuzzyFind(normalizedText, normalizedName)

        if (match) {
            candidates.push({
                augmentData,
                match,
                originalIndex: match.index,
            })
            seenIds.add(augmentData.id)
            seenNames.add(normalizedName)

            // 从文本中移除已匹配的部分，避免子串重复匹配
            normalizedText = normalizedText.slice(0, match.index) +
                            normalizedText.slice(match.index + match.matchLen)
        }
    }

    // 按在原文中的位置排序（优先选择文本前面的，即上方的海克斯名称）
    candidates.sort((a, b) => a.originalIndex - b.originalIndex)

    // 选择前 3 个（海克斯选择界面固定是 3 张卡片）
    for (const candidate of candidates.slice(0, 3)) {
        const confidence = candidate.match.distance === 0 ? 0.95 : 0.80
        augments.push({
            id: candidate.augmentData.id,
            name: candidate.augmentData.name,
            rarity: candidate.augmentData.rarity,
            confidence,
        })
    }

    if (augments.length > 0) {
        logger.info(`✅ 匹配到 ${augments.length} 个海克斯: ${augments.map(a => a.name).join(', ')}`)
    } else {
        logger.info(`⚠️ 未匹配到海克斯`)
    }

    return augments
}

/**
 * 根据卡片数量计算置信度 - 更严格
 * @param {number} cardCount - 检测到的卡片数量
 * @param {boolean} isAugmentPhase - 是否识别为海克斯阶段
 * @returns {number} 0-1之间的置信度
 */
function calculateConfidence(cardCount, isAugmentPhase) {
    // ✅ 只有完全通过所有验证的情况才给高置信度
    if (cardCount === 3 && isAugmentPhase) {
        return 0.95  // 通过了所有验证
    }

    // ❌ 其他情况都不可信
    switch (cardCount) {
        case 3:
            return 0.5   // ✅ 降低：3张卡片但验证失败
        case 2:
            return 0.2   // 2张卡片，太少了
        case 1:
            return 0.05  // 仅1张卡片，基本无效
        default:
            return 0     // 未检测到任何卡片
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
 * @param {Buffer} imageBuffer - 截图数据Buffer（PNG格式）
 * @returns {Promise<Object>} 分析结果
 */
export const analyzeScreenshot = async (imageBuffer) => {
    try {
        // 验证Buffer有效性
        if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
            return {
                success: false,
                error: '截图数据无效',
            }
        }

        const timestamp = Date.now()
        logger.info(`🔍 开始分析截图: buffer size ${(imageBuffer.length / 1024).toFixed(1)}KB`)

        // 【新方案】使用OCR识别海克斯名称
        const recognizedAugments = await recognizeAugmentsFromImage(imageBuffer)

        logger.info(`🔍 OCR识别结果: 检测到 ${recognizedAugments.length} 个海克斯`)

        // 判断是否为海克斯选择界面
        const isAugmentPhase = recognizedAugments.length >= 1  // 识别到至少1个海克斯就认为是海克斯界面

        // 【简化】跳过复杂的置信度判断
        // 原方案的置信度逻辑过于复杂且容易误判，改为简单的是/否判断
        const confidence = isAugmentPhase ? 0.95 : 0

        // 整合结果
        const analysisResult = {
            success: true,
            timestamp,
            analysis: {
                augments: recognizedAugments,         // OCR识别到的海克斯
                cardCount: recognizedAugments.length, // 识别到的海克斯数量
                cardColors: [],                       // 不再使用颜色检测
                confidence: confidence,                // 简化的置信度（0 或 0.95）
                isAugmentPhase: isAugmentPhase,        // 是否处于海克斯选择阶段
                cardPositions: [],                     // 不再使用卡片位置
                detectionMethod: 'ocr-based',          // 新方案标记
            },
            metadata: {
                bufferSize: imageBuffer.length,
                format: 'png',
                detectionMethod: 'ocr',
            },
        }

        logger.info(`✅ 截图分析完成: 识别到 ${recognizedAugments.length} 个海克斯`)
        return analysisResult
    } catch (error) {
        logger.error('❌ 截图分析失败:', error)
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
