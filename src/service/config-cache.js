/**
 * 本地配置缓存服务
 * 用于存储和读取应用配置（如游戏路径等）
 */

import log from '@/native/logger.js';

const STORAGE_KEY = 'lol-tips-config';

/**
 * 从localStorage获取所有配置
 */
function getConfig() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        log.error('获取配置失败:', e);
        return {};
    }
}

/**
 * 保存配置
 */
function saveConfig(config) {
    try {
        const current = getConfig();
        const updated = { ...current, ...config };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return true;
    } catch (e) {
        log.error('保存配置失败:', e);
        return false;
    }
}

/**
 * 获取游戏路径
 */
function getLolPath() {
    const config = getConfig();
    return config.lolPath || '';
}

/**
 * 保存游戏路径
 */
function saveLolPath(path) {
    return saveConfig({ lolPath: path });
}

/**
 * 清除游戏路径
 */
function clearLolPath() {
    const config = getConfig();
    delete config.lolPath;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export default {
    getConfig,
    saveConfig,
    getLolPath,
    saveLolPath,
    clearLolPath,
};
