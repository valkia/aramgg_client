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
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { loadAugmentBase } from './data-loader.js'
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
 * 从远端数据 API 加载完整列表并建立名称索引
 */
async function initAugmentDatabase() {
    // 如果数据库已加载且不为空，直接返回
    if (AUGMENT_DATABASE !== null && Object.keys(AUGMENT_DATABASE).length > 0) {
        logger.debug(`📚 海克斯数据库已缓存: ${Object.keys(AUGMENT_DATABASE).length} 个海克斯`)
        return AUGMENT_DATABASE
    }

    // 如果之前加载失败得到了空对象，重置为 null 重新加载
    if (AUGMENT_DATABASE !== null && Object.keys(AUGMENT_DATABASE).length === 0) {
        logger.warn(`⚠️ 检测到空数据库缓存，强制重新加载...`)
        AUGMENT_DATABASE = null
    }

    logger.info(`📚 正在初始化海克斯数据库...`)

    try {
        const augmentsData = await loadAugmentBase()
        logger.info(`   远端海克斯数据加载成功: ${augmentsData.length} 条原始数据`)

        // 建立按名称索引的数据库（用于快速查找）
        AUGMENT_DATABASE = {}
        AUGMENT_MATCH_ENTRIES = null
        let invalidCount = 0
        for (const augment of augmentsData) {
            if (!augment.id || !augment.name) {
                invalidCount++
                continue
            }

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

        const totalCount = Object.keys(AUGMENT_DATABASE).length
        logger.info(`📚 海克斯数据库已加载: ${totalCount} 个有效海克斯 (跳过 ${invalidCount} 条无效数据)`)

        if (totalCount === 0) {
            logger.error(`❌ 警告: 数据库为空！请检查数据文件内容`)
        }

        return AUGMENT_DATABASE
    } catch (error) {
        logger.error(`❌ 加载海克斯数据库失败: ${error.message}`)
        logger.error(`   错误详情:`, error)
        // 使用空数据库作为备份，但标记为 null 以便下次重试
        AUGMENT_DATABASE = {}
        AUGMENT_MATCH_ENTRIES = null
        return AUGMENT_DATABASE
    }
}

let tesseractWorker = null
let tesseractWorkerPromise = null
let tesseractModulePromise = null
let tesseractWorkerIdleTimer = null
let tesseractWorkerPsm = null
let ocrQueue = Promise.resolve()
let loggedTesseractLangPath = null
let AUGMENT_MATCH_ENTRIES = null
let LAST_AUGMENT_OCR_CACHE = null

const TESSERACT_WORKER_IDLE_CLEANUP_MS = 60000
const OCR_TITLE_ACTIVITY_SAMPLE = { width: 160, height: 50 }
const OCR_TITLE_ACTIVE_BRIGHT_RATIO = 0.012
const OCR_TITLE_WEAK_BRIGHT_RATIO = 0.004
const OCR_TITLE_DARK_RATIO = 0.72
const OCR_RESULT_CACHE_MAX_AGE_MS = 30000
const OCR_TITLE_FINGERPRINT_SIZE = { width: 32, height: 10 }
const OCR_TITLE_FINGERPRINT_MAX_DIFF_RATIO = 0.08

const MATCH_BLACKLIST = new Set([
    // 属性描述词
    '攻击', '防御', '生命', '法术', '魔法', '伤害', '护甲',
    '技能', '冷却', '移速', '暴击', '吸血', '穿透',
    // 功能描述词
    '功能', '能力', '效果', '被动', '主动', '额外',
    '持续', '提供', '增加', '获得', '造成',
])

const OCR_NAME_ALIASES = new Map([
    ['夺金', ['厅金']],
    ['神射法师', ['枝师']],
])

const OCR_PUNCTUATION_PATTERN = /[\s"'“”‘’`.,，。:：;；!！?？、|｜/\\()[\]{}<>《》【】「」『』\-_=+~·•]/g

/**
 * 将调用方传入的图片输入统一成 Buffer。
 * 运行时截图传 Buffer，IPC 和测试脚本通常传图片路径。
 */
function resolveImageBuffer(imageInput) {
    if (Buffer.isBuffer(imageInput)) {
        return {
            buffer: imageInput,
            sourceType: 'buffer',
            sourcePath: null,
        }
    }

    if (typeof imageInput === 'string' && imageInput.trim() !== '') {
        return {
            buffer: readFileSync(imageInput),
            sourceType: 'path',
            sourcePath: imageInput,
        }
    }

    return {
        buffer: null,
        sourceType: 'unknown',
        sourcePath: null,
    }
}

/**
 * 本地开发时优先使用仓库内的中文模型，避免 Tesseract.js 走 CDN 下载。
 */
function getTesseractOptions() {
    const localLangDirs = [
        process.cwd(),
        path.join(__dirname, '..'),
        path.join(process.resourcesPath || '', 'data'),
        process.resourcesPath || '',
    ].filter(Boolean)

    for (const langDir of localLangDirs) {
        if (existsSync(path.join(langDir, 'chi_sim.traineddata'))) {
            if (loggedTesseractLangPath !== langDir) {
                loggedTesseractLangPath = langDir
                logger.info(`OCR language data: local chi_sim.traineddata at ${langDir}`)
            }
            return {
                langPath: langDir,
                cacheMethod: 'none',
                gzip: false,
            }
        }
    }

    if (loggedTesseractLangPath !== 'default') {
        loggedTesseractLangPath = 'default'
        logger.warn('OCR language data: local chi_sim.traineddata not found; using Tesseract default loading strategy')
    }
    return {}
}

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

function normalizeOcrText(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(OCR_PUNCTUATION_PATTERN, '')
}

function clampRegion(region, imageWidth, imageHeight) {
    const left = Math.max(0, Math.min(imageWidth - 1, Math.round(region.left)))
    const top = Math.max(0, Math.min(imageHeight - 1, Math.round(region.top)))
    const right = Math.max(left + 1, Math.min(imageWidth, Math.round(region.left + region.width)))
    const bottom = Math.max(top + 1, Math.min(imageHeight, Math.round(region.top + region.height)))

    return {
        left,
        top,
        width: right - left,
        height: bottom - top,
    }
}

function createCardLayout(width, height) {
    const cardWidth = width * 0.168
    const cardGap = width * 0.0175
    const groupWidth = cardWidth * 3 + cardGap * 2
    const groupLeft = (width - groupWidth) / 2

    return {
        cardWidth,
        cardGap,
        groupWidth,
        groupLeft,
    }
}

function createIndividualTitleRegions(width, height) {
    const { cardWidth, cardGap, groupLeft } = createCardLayout(width, height)

    return [0, 1, 2].map(index => ({
        name: `card-title-${index + 1}`,
        left: groupLeft + index * (cardWidth + cardGap) + cardWidth * 0.08,
        top: height * 0.37,
        width: cardWidth * 0.84,
        height: height * 0.07,
        scale: 3,
        threshold: 145,
        invert: true,
        psm: 'SINGLE_LINE',
    }))
}

function createOcrRegions(width, height) {
    const { groupWidth, groupLeft } = createCardLayout(width, height)
    const individualTitleRegions = createIndividualTitleRegions(width, height)

    const titleStack = {
        name: 'card-title-stack',
        type: 'title-stack',
        regions: individualTitleRegions,
        psm: 'SPARSE_TEXT',
    }

    const titleBand = {
        name: 'card-title-band',
        left: groupLeft - width * 0.01,
        top: height * 0.355,
        width: groupWidth + width * 0.02,
        height: height * 0.095,
        scale: 2.5,
        threshold: 145,
        invert: true,
        psm: 'SPARSE_TEXT',
    }

    const individualTitleGroup = {
        name: 'card-title-individual-group',
        type: 'individual-title-group',
        regions: individualTitleRegions,
        psm: 'SINGLE_LINE',
    }

    const textBand = {
        name: 'card-text-band',
        left: width * 0.18,
        top: height * 0.31,
        width: width * 0.64,
        height: height * 0.25,
        scale: 1.8,
        threshold: false,
        invert: false,
        psm: 'SPARSE_TEXT',
        slowFallback: true,
    }

    const legacyBand = width >= 2400
        ? {
            name: 'legacy-wide-band',
            left: width * 0.25,
            top: height * 0.4,
            width: width * 0.5,
            height: height * 0.15,
            scale: 1.8,
            threshold: false,
            invert: false,
            psm: 'SPARSE_TEXT',
            slowFallback: true,
        }
        : {
            name: 'legacy-game-band',
            left: width * 0.15,
            top: height * 0.25,
            width: width * 0.7,
            height: height * 0.25,
            scale: 1.6,
            threshold: false,
            invert: false,
            psm: 'SPARSE_TEXT',
            slowFallback: true,
        }

    return [titleStack, titleBand, individualTitleGroup, textBand, legacyBand]
}

async function prepareOcrRegion(imageBuffer, region, imageWidth, imageHeight) {
    const rect = clampRegion(region, imageWidth, imageHeight)
    const scale = region.scale || 1
    const targetWidth = Math.max(1, Math.round(rect.width * scale))
    const targetHeight = Math.max(1, Math.round(rect.height * scale))

    let pipeline = sharp(imageBuffer)
        .extract(rect)
        .resize({
            width: targetWidth,
            height: targetHeight,
            fit: 'fill',
        })
        .greyscale()
        .normalize()
        .sharpen()

    if (region.threshold === false) {
        pipeline = pipeline.linear(1.5, -48)
    } else {
        pipeline = pipeline
            .linear(1.9, -120)
            .threshold(region.threshold || 145)

        if (region.invert !== false) {
            pipeline = pipeline.negate()
        }
    }

    return {
        rect,
        width: targetWidth,
        height: targetHeight,
        buffer: await pipeline.png().toBuffer(),
    }
}

async function prepareStackedTitleRegion(imageBuffer, stackRegion, imageWidth, imageHeight) {
    const preparedRows = []

    for (const region of stackRegion.regions || []) {
        preparedRows.push(await prepareOcrRegion(imageBuffer, region, imageWidth, imageHeight))
    }

    if (preparedRows.length === 0) {
        return {
            rect: { left: 0, top: 0, width: 1, height: 1 },
            width: 1,
            height: 1,
            buffer: await sharp({
                create: {
                    width: 1,
                    height: 1,
                    channels: 3,
                    background: '#ffffff',
                },
            }).png().toBuffer(),
        }
    }

    const rowGap = Math.max(10, Math.round(preparedRows[0].height * 0.18))
    const width = Math.max(...preparedRows.map(row => row.width))
    const height = preparedRows.reduce((total, row) => total + row.height, 0) + rowGap * (preparedRows.length - 1)
    const bounds = preparedRows.reduce((acc, row) => {
        const right = row.rect.left + row.rect.width
        const bottom = row.rect.top + row.rect.height
        return {
            left: Math.min(acc.left, row.rect.left),
            top: Math.min(acc.top, row.rect.top),
            right: Math.max(acc.right, right),
            bottom: Math.max(acc.bottom, bottom),
        }
    }, { left: Infinity, top: Infinity, right: 0, bottom: 0 })

    let top = 0
    const composites = preparedRows.map(row => {
        const composite = {
            input: row.buffer,
            left: Math.max(0, Math.round((width - row.width) / 2)),
            top,
        }
        top += row.height + rowGap
        return composite
    })

    const buffer = await sharp({
        create: {
            width,
            height,
            channels: 3,
            background: '#ffffff',
        },
    })
        .composite(composites)
        .png()
        .toBuffer()

    return {
        rect: {
            left: bounds.left,
            top: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
        },
        width,
        height,
        buffer,
    }
}

async function readIndividualTitleAugments(imageBuffer, groupRegion, imageWidth, imageHeight) {
    const augments = []
    const seenIds = new Set()

    for (const [index, region] of (groupRegion.regions || []).entries()) {
        const { rect, buffer } = await prepareOcrRegion(imageBuffer, region, imageWidth, imageHeight)
        logger.debug(`OCR ordered title region ${region.name}: x=${rect.left}, y=${rect.top}, width=${rect.width}, height=${rect.height}`)

        const text = await performOCR(buffer, region.psm)
        if (!text || text.trim() === '') {
            logger.debug(`  OCR ordered title ${index + 1}: empty`)
            continue
        }

        const matches = await matchAugmentDatabase(text)
        const match = matches.find(augment => {
            const id = String(augment.id)
            return !seenIds.has(id)
        })

        if (!match) {
            logger.debug(`  OCR ordered title ${index + 1}: no augment match`)
            continue
        }

        seenIds.add(String(match.id))
        augments.push({
            ...match,
            detectedSlot: index,
        })
        logger.debug(`  OCR ordered title ${index + 1}: ${match.name} (${match.id})`)
    }

    return augments
}

async function measureTitleRegionActivity(imageBuffer, region, imageWidth, imageHeight) {
    const rect = clampRegion(region, imageWidth, imageHeight)
    const { data, info } = await sharp(imageBuffer)
        .extract(rect)
        .resize({
            width: OCR_TITLE_ACTIVITY_SAMPLE.width,
            height: OCR_TITLE_ACTIVITY_SAMPLE.height,
            fit: 'fill',
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

    const channels = info.channels || 3
    const pixelCount = data.length / channels
    let brightPixels = 0
    let darkPixels = 0

    for (let offset = 0; offset < data.length; offset += channels) {
        const r = data[offset]
        const g = data[offset + 1]
        const b = data[offset + 2]
        const max = Math.max(r, g, b)

        if (r > 180 && g > 180 && b > 170) {
            brightPixels++
        }
        if (max < 55) {
            darkPixels++
        }
    }

    return {
        brightRatio: brightPixels / pixelCount,
        darkRatio: darkPixels / pixelCount,
    }
}

async function hasLikelyAugmentTitleActivity(imageBuffer, width, height) {
    const titleRegions = createIndividualTitleRegions(width, height)
    const samples = await Promise.all(
        titleRegions.map(region => measureTitleRegionActivity(imageBuffer, region, width, height))
    )
    const strongTitleRegions = samples.filter(sample => sample.brightRatio >= OCR_TITLE_ACTIVE_BRIGHT_RATIO).length
    const weakCardRegions = samples.filter(sample =>
        sample.brightRatio >= OCR_TITLE_WEAK_BRIGHT_RATIO && sample.darkRatio >= OCR_TITLE_DARK_RATIO
    ).length
    const likely = strongTitleRegions >= 2 || weakCardRegions >= 2

    logger.debug(`OCR title activity: likely=${likely}, strong=${strongTitleRegions}, weak=${weakCardRegions}, samples=${samples.map(sample => `${(sample.brightRatio * 100).toFixed(2)}%/${(sample.darkRatio * 100).toFixed(1)}%`).join(', ')}`)

    return likely
}

async function createTitleRegionFingerprint(imageBuffer, width, height) {
    const titleRegions = createIndividualTitleRegions(width, height)
    const regionFingerprints = await Promise.all(titleRegions.map(async (region) => {
        const rect = clampRegion(region, width, height)
        const data = await sharp(imageBuffer)
            .extract(rect)
            .resize({
                width: OCR_TITLE_FINGERPRINT_SIZE.width,
                height: OCR_TITLE_FINGERPRINT_SIZE.height,
                fit: 'fill',
            })
            .greyscale()
            .normalize()
            .raw()
            .toBuffer()
        const mean = data.reduce((sum, value) => sum + value, 0) / data.length
        let bits = ''

        for (const value of data) {
            bits += value >= mean ? '1' : '0'
        }

        return bits
    }))

    return regionFingerprints.join('|')
}

function fingerprintDistance(a, b) {
    if (!a || !b || a.length !== b.length) {
        return Infinity
    }

    let distance = 0
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
            distance += 1
        }
    }

    return distance
}

function getCachedAugmentsForFingerprint(fingerprint) {
    if (!LAST_AUGMENT_OCR_CACHE || !fingerprint) {
        return null
    }

    const cacheAgeMs = Date.now() - LAST_AUGMENT_OCR_CACHE.updatedAt
    if (cacheAgeMs > OCR_RESULT_CACHE_MAX_AGE_MS) {
        return null
    }

    const distance = fingerprintDistance(fingerprint, LAST_AUGMENT_OCR_CACHE.fingerprint)
    const maxDistance = Math.round(fingerprint.length * OCR_TITLE_FINGERPRINT_MAX_DIFF_RATIO)
    if (distance > maxDistance) {
        return null
    }

    logger.debug(`OCR augment recognition reused cached title result: distance=${distance}/${maxDistance}, age=${cacheAgeMs}ms`)
    LAST_AUGMENT_OCR_CACHE.updatedAt = Date.now()
    return LAST_AUGMENT_OCR_CACHE.augments.map(augment => ({ ...augment }))
}

function cacheAugmentsForFingerprint(fingerprint, augments) {
    if (!fingerprint || !Array.isArray(augments) || augments.length < 3) {
        return
    }

    LAST_AUGMENT_OCR_CACHE = {
        fingerprint,
        augments: augments.slice(0, 3).map(augment => ({ ...augment })),
        updatedAt: Date.now(),
    }
}

function clearAugmentOcrCache() {
    LAST_AUGMENT_OCR_CACHE = null
}

function enqueueOcr(task) {
    const nextTask = ocrQueue.catch(() => {}).then(task)
    ocrQueue = nextTask.catch(() => {})
    return nextTask
}

async function getTesseractModule() {
    if (!tesseractModulePromise) {
        tesseractModulePromise = import('tesseract.js')
    }

    return tesseractModulePromise
}

async function getTesseractWorker() {
    if (tesseractWorkerIdleTimer) {
        clearTimeout(tesseractWorkerIdleTimer)
        tesseractWorkerIdleTimer = null
    }

    if (tesseractWorker) {
        return tesseractWorker
    }

    if (!tesseractWorkerPromise) {
        tesseractWorkerPromise = (async () => {
            const Tesseract = await getTesseractModule()
            const { createWorker, PSM } = Tesseract
            const worker = await createWorker('chi_sim', 1, getTesseractOptions())

            await worker.setParameters({
                tessedit_pageseg_mode: PSM.SPARSE_TEXT,
                preserve_interword_spaces: '1',
                user_defined_dpi: '300',
            })
            tesseractWorkerPsm = PSM.SPARSE_TEXT

            return worker
        })().catch(error => {
            tesseractWorkerPromise = null
            tesseractWorkerPsm = null
            throw error
        })
    }

    tesseractWorker = await tesseractWorkerPromise
    return tesseractWorker
}

function scheduleTesseractWorkerIdleCleanup() {
    if (tesseractWorkerIdleTimer) {
        clearTimeout(tesseractWorkerIdleTimer)
    }

    tesseractWorkerIdleTimer = setTimeout(() => {
        tesseractWorkerIdleTimer = null
        void resetTesseractWorker()
    }, TESSERACT_WORKER_IDLE_CLEANUP_MS)

    if (typeof tesseractWorkerIdleTimer.unref === 'function') {
        tesseractWorkerIdleTimer.unref()
    }
}

async function resetTesseractWorker() {
    if (tesseractWorkerIdleTimer) {
        clearTimeout(tesseractWorkerIdleTimer)
        tesseractWorkerIdleTimer = null
    }

    const worker = tesseractWorker
    tesseractWorker = null
    tesseractWorkerPromise = null
    tesseractWorkerPsm = null

    if (!worker) {
        return
    }

    try {
        await worker.terminate()
    } catch (error) {
        logger.debug('Failed to terminate OCR worker after error:', error.message)
    }
}

export const warmupImageAnalyzer = async () => {
    const startedAt = performance.now()

    try {
        await Promise.all([
            initAugmentDatabase(),
            getTesseractWorker(),
        ])
        scheduleTesseractWorkerIdleCleanup()
        logger.info('Image analyzer warmup completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
        })
        return true
    } catch (error) {
        logger.warn('Image analyzer warmup failed:', error.message)
        return false
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

        logger.debug(`OCR augment recognition started: ${width}x${height}`)

        if (!await hasLikelyAugmentTitleActivity(imageBuffer, width, height)) {
            logger.debug('OCR augment recognition skipped: no likely augment title card activity')
            clearAugmentOcrCache()
            return []
        }

        const titleFingerprint = await createTitleRegionFingerprint(imageBuffer, width, height)
        const cachedAugments = getCachedAugmentsForFingerprint(titleFingerprint)
        if (cachedAugments) {
            return cachedAugments
        }

        const regions = createOcrRegions(width, height)
        const recognizedTexts = []
        let bestAugments = []
        let slowFallbackCount = 0
        const titleStackRegion = regions.find(region => region.type === 'title-stack')
        const titleBandRegion = regions.find(region => region.name === 'card-title-band')
        const individualTitleGroup = regions.find(region => region.type === 'individual-title-group')

        const readRegionAugments = async (region) => {
            let text = ''

            if (region.type === 'title-stack') {
                const { rect, width: stackWidth, height: stackHeight, buffer } = await prepareStackedTitleRegion(imageBuffer, region, width, height)
                logger.debug(`OCR region ${region.name}: x=${rect.left}, y=${rect.top}, width=${rect.width}, height=${rect.height}, stacked=${stackWidth}x${stackHeight}`)
                text = await performOCR(buffer, region.psm)
            } else {
                const { rect, buffer } = await prepareOcrRegion(imageBuffer, region, width, height)
                logger.debug(`OCR region ${region.name}: x=${rect.left}, y=${rect.top}, width=${rect.width}, height=${rect.height}`)
                text = await performOCR(buffer, region.psm)
            }

            if (!text || text.trim() === '') {
                logger.debug(`  OCR区域 ${region.name} 未识别到文本`)
                return []
            }

            recognizedTexts.push(text)
            return matchAugmentDatabase(recognizedTexts.join('\n'))
        }

        for (const region of [titleStackRegion, titleBandRegion].filter(Boolean)) {
            const currentAugments = await readRegionAugments(region)
            if (currentAugments.length > bestAugments.length) {
                bestAugments = currentAugments
            }

            if (currentAugments.length >= 3) {
                logger.debug(`OCR augment recognition completed from ${region.name}: 3 augments`)
                const result = currentAugments.slice(0, 3)
                cacheAugmentsForFingerprint(titleFingerprint, result)
                return result
            }
        }

        if (individualTitleGroup) {
            const orderedTitleAugments = await readIndividualTitleAugments(imageBuffer, individualTitleGroup, width, height)
            if (orderedTitleAugments.length > bestAugments.length) {
                bestAugments = orderedTitleAugments
            }

            if (orderedTitleAugments.length >= 3) {
                logger.debug('OCR augment recognition completed from ordered individual titles: 3 augments')
                const result = orderedTitleAugments.slice(0, 3)
                cacheAugmentsForFingerprint(titleFingerprint, result)
                return result
            }
        }

        for (const region of regions) {
            if (
                region === titleStackRegion ||
                region === titleBandRegion ||
                region.type === 'individual-title-group'
            ) {
                continue
            }

            if (region.slowFallback && bestAugments.length < 2) {
                logger.debug(`OCR slow fallback ${region.name} skipped: bestAugments=${bestAugments.length}`)
                continue
            }

            if (region.slowFallback && slowFallbackCount >= 1) {
                logger.debug(`OCR slow fallback ${region.name} skipped: earlier slow fallback already ran`)
                continue
            }

            if (region.slowFallback) {
                slowFallbackCount += 1
            }

            const currentAugments = await readRegionAugments(region)
            if (currentAugments.length > bestAugments.length) {
                bestAugments = currentAugments
            }

            if (currentAugments.length >= 3) {
                logger.debug(`OCR augment recognition completed from ${region.name}: 3 augments`)
                const result = currentAugments.slice(0, 3)
                cacheAugmentsForFingerprint(titleFingerprint, result)
                return result
            }
        }

        if (recognizedTexts.length === 0) {
            logger.debug('OCR returned no text in all augment regions')
            return []
        }

        logger.debug(`OCR augment recognition completed: ${bestAugments.length} augments`)

        const result = bestAugments.slice(0, 3)
        cacheAugmentsForFingerprint(titleFingerprint, result)
        return result
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
async function performOCR(imageBuffer, psm = 'SPARSE_TEXT') {
    try {
        return await enqueueOcr(async () => {
            try {
                const Tesseract = await getTesseractModule()
                const { PSM } = Tesseract
                const worker = await getTesseractWorker()
                const pagesegMode = PSM[psm] || PSM.SPARSE_TEXT

                if (tesseractWorkerPsm !== pagesegMode) {
                    await worker.setParameters({
                        tessedit_pageseg_mode: pagesegMode,
                        preserve_interword_spaces: '1',
                        user_defined_dpi: '300',
                    })
                    tesseractWorkerPsm = pagesegMode
                }

                const result = await worker.recognize(imageBuffer)
                const recognizedText = result.data.text
                logger.debug(`OCR text preview: ${recognizedText.substring(0, 200)}...`)
                logger.debug(`OCR full text: ${recognizedText}`)

                return recognizedText
            } finally {
                scheduleTesseractWorkerIdleCleanup()
            }
        })
    } catch (error) {
        logger.error('❌ OCR识别失败:', error)
        await resetTesseractWorker()
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
    const textLen = text.length

    if (nameLen === 0 || textLen < nameLen) {
        logger.debug(`   fuzzyFind: 文本太短 (${textLen} < ${nameLen})，无法匹配 "${name}"`)
        return null
    }

    // 先尝试精确匹配
    const exactIndex = text.indexOf(name)
    if (exactIndex !== -1) {
        logger.debug(`   fuzzyFind: ✨ 精确匹配成功 "${name}" @位置 ${exactIndex}`)
        return { index: exactIndex, distance: 0, matchLen: nameLen }
    }

    const aliases = OCR_NAME_ALIASES.get(name) || []
    for (const alias of aliases) {
        const normalizedAlias = normalizeOcrText(alias)
        const aliasIndex = text.indexOf(normalizedAlias)
        if (aliasIndex !== -1) {
            logger.debug(`   OCR别名匹配成功 "${name}" <= "${alias}" @位置 ${aliasIndex}`)
            return {
                index: aliasIndex,
                distance: 0,
                matchLen: normalizedAlias.length,
                alias,
            }
        }
    }

    // ⚠️ 名称太短（≤2字）不做模糊匹配，避免误匹配
    // 两字海克斯必须精确匹配（避免"大力"误匹配到"作寺"等）
    if (nameLen <= 2) {
        logger.debug(`   fuzzyFind: "${name}" (长度 ${nameLen} ≤2)，跳过模糊匹配`)
        return null
    }

    // 滑动窗口模糊匹配（仅对≥3字的海克斯）
    // 允许的最大编辑距离：3字允许1个错误，4字以上允许 floor(len/3) 个错误
    const maxDistance = nameLen === 3 ? 1 : Math.floor(nameLen / 3)
    let bestMatch = null

    // 只记录调试特定海克斯
    const shouldDebug = name.includes('有始') || name.includes('面包') || name.includes('关键')
    if (shouldDebug) {
        logger.debug(`   fuzzyFind: 🔍 开始模糊匹配 "${name}" (长度${nameLen}, 最大允许距离${maxDistance}), 文本长度${textLen}`)
    }

    for (let i = 0; i <= text.length - nameLen; i++) {
        const window = text.slice(i, i + nameLen)
        const dist = editDistance(window, name)

        if (dist <= maxDistance) {
            if (shouldDebug) {
                logger.debug(`   fuzzyFind: 💡 潜在匹配 "${name}" ≈ "${window}" @位置 ${i} (距离 ${dist})`)
            }
            if (!bestMatch || dist < bestMatch.distance) {
                bestMatch = { index: i, distance: dist, matchLen: nameLen }
            }
        }
    }

    if (bestMatch && shouldDebug) {
        logger.debug(`   fuzzyFind: ✅ 最终选择 "${name}" @位置 ${bestMatch.index} (距离 ${bestMatch.distance})`)
    } else if (shouldDebug) {
        // 显示几个最接近但不匹配的窗口
        const sampleWindows = []
        for (let i = 0; i <= Math.min(text.length - nameLen, 50) && sampleWindows.length < 3; i++) {
            const window = text.slice(i, i + nameLen)
            const dist = editDistance(window, name)
            if (dist <= maxDistance + 2) {
                sampleWindows.push(`"${window}"(d${dist})@${i}`)
            }
        }
        if (sampleWindows.length > 0) {
            logger.debug(`   fuzzyFind: ❌ "${name}" 未匹配，最接近的候选: ${sampleWindows.join(', ')}`)
        } else {
            logger.debug(`   fuzzyFind: ❌ "${name}" 未找到相近候选 (检查了 ${Math.min(text.length - nameLen + 1, 51)} 个窗口)`)
        }
    }

    return bestMatch
}

function getAugmentVersionPriority(augmentData) {
    const id = Number(augmentData.id) || 0
    return id >= 1000 ? id + 100000 : id
}

function getAugmentMatchEntries(database) {
    if (AUGMENT_MATCH_ENTRIES) {
        return AUGMENT_MATCH_ENTRIES
    }

    const sortedAugments = Object.values(database).sort((a, b) => {
        const aLen = normalizeOcrText(a.name).length
        const bLen = normalizeOcrText(b.name).length
        if (bLen !== aLen) {
            return bLen - aLen
        }
        return getAugmentVersionPriority(b) - getAugmentVersionPriority(a)
    })

    const scannedNames = new Set()
    AUGMENT_MATCH_ENTRIES = []

    for (const augmentData of sortedAugments) {
        const normalizedName = normalizeOcrText(augmentData.name)

        if (MATCH_BLACKLIST.has(augmentData.name) || MATCH_BLACKLIST.has(normalizedName)) {
            continue
        }
        if (scannedNames.has(normalizedName)) {
            continue
        }

        scannedNames.add(normalizedName)
        AUGMENT_MATCH_ENTRIES.push({
            augmentData,
            normalizedName,
        })
    }

    logger.debug(`Augment match entries cached: ${AUGMENT_MATCH_ENTRIES.length}/${sortedAugments.length}`)
    return AUGMENT_MATCH_ENTRIES
}

function rangesOverlap(a, b) {
    return a.start < b.end && b.start < a.end
}

/**
 * 从识别的文本匹配海克斯数据库
 * @param {string} recognizedText - OCR识别的文本
 * @returns {Array} 匹配的海克斯列表
 */
async function matchAugmentDatabase(recognizedText) {
    if (!recognizedText || recognizedText.trim() === '') {
        logger.warn(`⚠️ matchAugmentDatabase: 输入文本为空或空白`)
        return []
    }

    // 确保数据库已初始化
    const database = await initAugmentDatabase()
    const databaseSize = Object.keys(database).length
    logger.debug(`Matching OCR text against augment database: size=${databaseSize}`)
    logger.debug(`📝 输入原文本长度: ${recognizedText.length} 字符`)

    // 去除所有空格用于模糊匹配（OCR可能识别出"台风 帽"而不是"台风帽"）
    const normalizedText = normalizeOcrText(recognizedText)
    logger.debug(`Normalized OCR text: "${normalizedText.substring(0, 100)}..." (${normalizedText.length} chars)`)

    const matchEntries = getAugmentMatchEntries(database)
    logger.debug(`📊 海克斯匹配索引已就绪，最长名称: "${matchEntries[0]?.augmentData.name}" (${matchEntries[0]?.normalizedName.length} 字符)`)

    // 收集所有候选匹配，再按重叠范围筛选，避免长名称被短名称拆分。
    const candidates = []
    let matchedCount = 0

    for (const { augmentData, normalizedName } of matchEntries) {

        // 使用模糊匹配查找
        const match = fuzzyFind(normalizedText, normalizedName)

        if (match) {
            matchedCount++
            const aliasText = match.alias ? `, OCR别名: ${match.alias}` : ''
            logger.debug(`Augment match [#${matchedCount}]: "${augmentData.name}" (id: ${augmentData.id}, index: ${match.index}, distance: ${match.distance}${aliasText})`)
            candidates.push({
                augmentData,
                match,
                start: match.index,
                end: match.index + match.matchLen,
                matchLen: match.matchLen,
            })
        }
    }

    logger.debug(`Augment match stats: scanned=${matchEntries.length}, matched=${matchedCount}`)

    candidates.sort((a, b) => {
        if (a.match.distance !== b.match.distance) {
            return a.match.distance - b.match.distance
        }
        if (a.matchLen !== b.matchLen) {
            return b.matchLen - a.matchLen
        }
        const priorityDiff = getAugmentVersionPriority(b.augmentData) - getAugmentVersionPriority(a.augmentData)
        if (priorityDiff !== 0) {
            return priorityDiff
        }
        return a.start - b.start
    })

    const selectedCandidates = []
    for (const candidate of candidates) {
        if (selectedCandidates.some(selected => rangesOverlap(candidate, selected))) {
            logger.debug(`⚠️ 跳过重叠候选: "${candidate.augmentData.name}" @${candidate.start}-${candidate.end}`)
            continue
        }

        selectedCandidates.push(candidate)
    }

    // 按在原文中的位置排序，保持卡片从左到右/从上到下的识别顺序。
    selectedCandidates.sort((a, b) => a.start - b.start)
    logger.debug(`📊 筛选重叠候选后数量: ${selectedCandidates.length}`)
    selectedCandidates.forEach((c, i) => {
        logger.debug(`   [#${i + 1}] "${c.augmentData.name}" @位置 ${c.start}`)
    })

    // 选择前 3 个（海克斯选择界面固定是 3 张卡片）
    const augments = []
    for (const candidate of selectedCandidates.slice(0, 3)) {
        const confidence = candidate.match.distance === 0 ? 0.95 : 0.80
        augments.push({
            id: candidate.augmentData.id,
            name: candidate.augmentData.name,
            rarity: candidate.augmentData.rarity,
            confidence,
        })
    }

    if (augments.length > 0) {
        logger.debug(`Matched ${augments.length} augments: ${augments.map(a => `"${a.name}" (id:${a.id})`).join(', ')}`)
    } else {
        logger.debug(`No augment matched from OCR text (candidates=${candidates.length})`)
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
 * @param {Buffer|string} imageInput - 截图 Buffer 或图片路径
 * @returns {Promise<Object>} 分析结果
 */
export const analyzeScreenshot = async (imageInput) => {
    try {
        const startTime = performance.now()
        const { buffer: imageBuffer, sourceType, sourcePath } = resolveImageBuffer(imageInput)

        // 验证图片数据有效性
        if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
            return {
                success: false,
                error: '截图数据无效',
            }
        }

        const timestamp = Date.now()
        logger.debug(`Screenshot analysis started: source=${sourceType}${sourcePath ? `, path=${sourcePath}` : ''}, buffer=${(imageBuffer.length / 1024).toFixed(1)}KB`)

        // 【新方案】使用OCR识别海克斯名称
        const recognizedAugments = await recognizeAugmentsFromImage(imageBuffer)

        logger.debug(`OCR augment result count: ${recognizedAugments.length}`)

        // 判断是否为海克斯选择界面
        const isAugmentPhase = recognizedAugments.length === 3
        const confidence = calculateConfidence(recognizedAugments.length, isAugmentPhase)

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
                sourceType,
                sourcePath,
                format: 'png',
                detectionMethod: 'ocr',
                analysisDurationMs: parseFloat((performance.now() - startTime).toFixed(2)),
            },
        }

        logger.debug(`Screenshot analysis completed: augments=${recognizedAugments.length}, duration=${analysisResult.metadata.analysisDurationMs}ms`)
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

export const shutdownImageAnalyzer = async () => {
    await resetTesseractWorker()
}

export default {
    analyzeScreenshot,
    extractAugments,
    isAugmentPhase,
    getConfidence,
    warmupImageAnalyzer,
    shutdownImageAnalyzer,
}
