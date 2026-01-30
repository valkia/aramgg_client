/**
 * 胜率查询服务
 * 功能：从不同数据源获取英雄的胜率、选择率等信息
 */

/**
 * 查询英雄胜率信息
 * @param {string|number} championId - 英雄ID
 * @param {string} position - 位置（'top', 'jungle', 'mid', 'adc', 'support'）
 * @param {Object} options - 查询选项
 * @returns {Promise<Object>} 胜率信息
 */
export const getChampionWinrate = async (championId, position = null, options = {}) => {
    try {
        // TODO: 后续补充具体实现
        // 这里可以调用：
        // 1. OP.GG API
        // 2. LOL.QQ.COM API
        // 3. 其他数据源

        const result = {
            success: true,
            championId,
            position,
            winrate: null,          // 胜率（百分比，如 51.2）
            pickRate: null,         // 选择率
            banRate: null,          // 禁用率
            playCount: null,        // 游戏次数
            mainRunes: null,        // 推荐符文
            mainItems: null,        // 推荐装备
            dataSource: 'opgg',     // 数据源
            updateTime: Date.now(),
            tier: null,             // 等级
        }

        console.log('Champion winrate query:', result)
        return result
    } catch (error) {
        console.error('Winrate query failed:', error)
        return {
            success: false,
            championId,
            position,
            error: error.message,
        }
    }
}

/**
 * 批量查询多个英雄的胜率
 * @param {Array<number>} championIds - 英雄ID数组
 * @param {string} position - 位置
 * @returns {Promise<Array>} 胜率信息数组
 */
export const getChampionsWinrates = async (championIds, position = null) => {
    try {
        const results = await Promise.all(
            championIds.map(id => getChampionWinrate(id, position))
        )
        return results.filter(r => r.success)
    } catch (error) {
        console.error('Batch winrate query failed:', error)
        return []
    }
}

/**
 * 格式化胜率数据用于展示
 * @param {Object} winrateData - 胜率数据
 * @returns {Object} 格式化后的展示数据
 */
export const formatWinrateForDisplay = (winrateData) => {
    if (!winrateData.success) {
        return {
            status: 'error',
            message: winrateData.error || '无法获取数据',
        }
    }

    return {
        status: 'success',
        championId: winrateData.championId,
        position: winrateData.position,
        stats: {
            winrate: winrateData.winrate ? `${winrateData.winrate.toFixed(1)}%` : 'N/A',
            pickRate: winrateData.pickRate ? `${winrateData.pickRate.toFixed(1)}%` : 'N/A',
            banRate: winrateData.banRate ? `${winrateData.banRate.toFixed(1)}%` : 'N/A',
            playCount: winrateData.playCount ? `${winrateData.playCount}` : 'N/A',
        },
        runes: winrateData.mainRunes,
        items: winrateData.mainItems,
        dataSource: winrateData.dataSource,
        tier: winrateData.tier,
    }
}

/**
 * 获取胜率评价等级
 * @param {number} winrate - 胜率百分比
 * @returns {Object} 等级信息 {level, color, label}
 */
export const getWinrateLevel = (winrate) => {
    if (winrate === null || winrate === undefined) {
        return {
            level: 'unknown',
            color: '#999',
            label: '未知',
            emoji: '❓',
        }
    }

    if (winrate >= 55) {
        return {
            level: 'excellent',
            color: '#e74c3c',  // 红色
            label: '强势',
            emoji: '🔥',
        }
    } else if (winrate >= 52) {
        return {
            level: 'good',
            color: '#f39c12',  // 橙色
            label: '优势',
            emoji: '📈',
        }
    } else if (winrate >= 48) {
        return {
            level: 'balanced',
            color: '#27ae60',  // 绿色
            label: '均衡',
            emoji: '⚖️',
        }
    } else if (winrate >= 45) {
        return {
            level: 'weak',
            color: '#3498db',  // 蓝色
            label: '劣势',
            emoji: '📉',
        }
    } else {
        return {
            level: 'terrible',
            color: '#95a5a6',  // 灰色
            label: '弱势',
            emoji: '❌',
        }
    }
}

export default {
    getChampionWinrate,
    getChampionsWinrates,
    formatWinrateForDisplay,
    getWinrateLevel,
}
