import { desktopCapturer, BrowserWindow as BrowserWindow$1, ipcMain, screen, app, globalShortcut } from "electron";
import path from "path";
import fs from "fs-extra";
import os from "os";
import sharp from "sharp";
import fs$1, { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import Store from "electron-store";
import https from "https";
import axios from "axios";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;
const getLogDir = () => {
  const logDir = path.join(os.homedir(), ".lol-tips-client", "logs");
  fs.ensureDirSync(logDir);
  return logDir;
};
const getLogFileName = () => {
  const now = /* @__PURE__ */ new Date();
  const dateStr = now.toISOString().split("T")[0];
  return `app-${dateStr}.log`;
};
const getLogFilePath = () => {
  return path.join(getLogDir(), getLogFileName());
};
const formatLogMessage = (level, message, ...args) => {
  const now = /* @__PURE__ */ new Date();
  const timestamp = now.toISOString();
  const levelStr = level.padEnd(5);
  let msg = message;
  if (args.length > 0) {
    msg += " " + args.map((arg) => {
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(" ");
  }
  return `[${timestamp}] [${levelStr}] ${msg}`;
};
const writeToFile = async (logMessage) => {
  try {
    const logFile = getLogFilePath();
    await fs.appendFile(logFile, logMessage + "\n", { encoding: "utf8" });
  } catch (error) {
    console.error("写入日志文件失败:", error);
  }
};
const logWithLevel = (level, levelValue, message, ...args) => {
  if (levelValue < currentLevel) return;
  const formattedMessage = formatLogMessage(level, message, ...args);
  if (level === "ERROR") {
    console.error(formattedMessage);
  } else if (level === "WARN") {
    console.warn(formattedMessage);
  } else {
    console.log(formattedMessage);
  }
  writeToFile(formattedMessage);
};
const logger = {
  debug: (message, ...args) => logWithLevel("DEBUG", LOG_LEVELS.DEBUG, message, ...args),
  info: (message, ...args) => logWithLevel("INFO", LOG_LEVELS.INFO, message, ...args),
  warn: (message, ...args) => logWithLevel("WARN", LOG_LEVELS.WARN, message, ...args),
  error: (message, ...args) => logWithLevel("ERROR", LOG_LEVELS.ERROR, message, ...args),
  // 获取日志目录路径
  getLogDir,
  // 获取当前日志文件路径
  getCurrentLogFile: getLogFilePath,
  // 清理旧日志文件（保留最近N天）
  cleanupOldLogs: async (keepDays = 7) => {
    try {
      const logDir = getLogDir();
      const files = await fs.readdir(logDir);
      const now = Date.now();
      const maxAge = keepDays * 24 * 60 * 60 * 1e3;
      for (const file of files) {
        if (!file.endsWith(".log")) continue;
        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        const fileAge = now - stats.mtime.getTime();
        if (fileAge > maxAge) {
          await fs.remove(filePath);
          logger.info(`已删除旧日志文件: ${file}`);
        }
      }
    } catch (error) {
      logger.error("清理旧日志失败:", error);
    }
  }
};
const findGameWindow = (sources) => {
  return sources.find((source) => {
    const name = source.name.toLowerCase();
    return name.includes("league of legends") || name.includes("英雄联盟") || name.includes("lol") || name.includes("league") && name.includes("client");
  }) || null;
};
const findScreenSource = (sources) => {
  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  return screens.length > 0 ? screens[0] : null;
};
const captureScreenshot = async (options = {}) => {
  try {
    const timestamp = Date.now();
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    const gameWindow = findGameWindow(sources);
    let captureSource = gameWindow;
    let captureMode = "window";
    if (!gameWindow) {
      captureSource = findScreenSource(sources);
      captureMode = "screen";
    }
    if (!captureSource) {
      throw new Error("无法获取截图源");
    }
    const screenshot = captureSource.thumbnail;
    if (!screenshot || screenshot.isEmpty()) {
      throw new Error("截图为空");
    }
    const pngBuffer = screenshot.toPNG();
    const hasLolWindow = !!gameWindow;
    const size = screenshot.getSize();
    if (gameWindow) {
      logger.info(`找到游戏窗口: ${gameWindow.name}`);
      logger.debug(`窗口尺寸: ${size.width}x${size.height}`);
    } else {
      logger.warn(`未找到游戏窗口，使用全屏截图`);
      logger.debug(`屏幕尺寸: ${size.width}x${size.height}`);
    }
    logger.info(`Screenshot captured: ${size.width}x${size.height}, buffer size: ${(pngBuffer.length / 1024).toFixed(1)}KB`);
    return {
      success: true,
      buffer: pngBuffer,
      timestamp,
      hasLolWindow,
      captureMode,
      windowName: gameWindow?.name,
      width: size.width,
      height: size.height
    };
  } catch (error) {
    logger.error("Screenshot capture failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
};
const __filename$2 = fileURLToPath(import.meta.url);
const __dirname$2 = path.dirname(__filename$2);
let AUGMENT_DATABASE = null;
function findDataFile() {
  const possiblePaths = [
    // 1. 相对于当前文件的路径（打包后）
    path.join(__dirname$2, "data", "augments-base.json"),
    // 2. 相对于当前文件的上级目录（源代码位置）
    path.join(__dirname$2, "..", "electron", "data", "augments-base.json"),
    // 3. 使用 process.resourcesPath（打包后）
    path.join(process.resourcesPath || "", "data", "augments-base.json"),
    // 4. 使用当前工作目录
    path.join(process.cwd(), "electron", "data", "augments-base.json"),
    // 5. 绝对路径（作为最后备选）
    "E:\\ideaProject\\lol_tips_client\\electron\\data\\augments-base.json"
  ];
  logger.debug(`🔍 尝试 ${possiblePaths.length} 个可能的数据文件路径:`);
  for (let i = 0; i < possiblePaths.length; i++) {
    const testPath = possiblePaths[i];
    logger.debug(`   [${i + 1}] ${testPath.substring(0, 80)}...`);
    if (existsSync(testPath)) {
      logger.info(`✅ 找到数据文件: ${testPath}`);
      return testPath;
    }
  }
  logger.error(`❌ 在所有路径中均未找到数据文件`);
  logger.debug(`   __dirname: ${__dirname$2}`);
  logger.debug(`   process.resourcesPath: ${process.resourcesPath}`);
  logger.debug(`   process.cwd(): ${process.cwd()}`);
  return null;
}
function initAugmentDatabase() {
  if (AUGMENT_DATABASE !== null && Object.keys(AUGMENT_DATABASE).length > 0) {
    logger.debug(`📚 海克斯数据库已缓存: ${Object.keys(AUGMENT_DATABASE).length} 个海克斯`);
    return AUGMENT_DATABASE;
  }
  if (AUGMENT_DATABASE !== null && Object.keys(AUGMENT_DATABASE).length === 0) {
    logger.warn(`⚠️ 检测到空数据库缓存，强制重新加载...`);
    AUGMENT_DATABASE = null;
  }
  logger.info(`📚 正在初始化海克斯数据库...`);
  try {
    const augmentsPath = findDataFile();
    if (!augmentsPath) {
      logger.error(`❌ 无法找到数据文件 augments-base.json`);
      AUGMENT_DATABASE = {};
      return AUGMENT_DATABASE;
    }
    logger.info(`   使用数据文件: ${augmentsPath}`);
    const fileContent = readFileSync(augmentsPath, "utf-8");
    logger.info(`   数据文件大小: ${fileContent.length} 字符`);
    const augmentsData = JSON.parse(fileContent);
    logger.info(`   JSON解析成功: ${augmentsData.length} 条原始数据`);
    AUGMENT_DATABASE = {};
    let invalidCount = 0;
    for (const augment of augmentsData) {
      if (!augment.id || !augment.name) {
        invalidCount++;
        continue;
      }
      const rarityMap = {
        "kSilver": "silver",
        "kGold": "gold",
        "kPrismatic": "prismatic"
      };
      AUGMENT_DATABASE[augment.id] = {
        id: augment.id,
        name: augment.name,
        rarity: rarityMap[augment.rarity] || "unknown",
        iconPath: augment.iconPath
      };
    }
    const totalCount = Object.keys(AUGMENT_DATABASE).length;
    logger.info(`📚 海克斯数据库已加载: ${totalCount} 个有效海克斯 (跳过 ${invalidCount} 条无效数据)`);
    if (totalCount === 0) {
      logger.error(`❌ 警告: 数据库为空！请检查数据文件内容`);
    }
    return AUGMENT_DATABASE;
  } catch (error) {
    logger.error(`❌ 加载海克斯数据库失败: ${error.message}`);
    logger.error(`   错误详情:`, error);
    AUGMENT_DATABASE = {};
    return AUGMENT_DATABASE;
  }
}
async function recognizeAugmentsFromImage(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    logger.info(`🔍 【OCR】开始识别海克斯名称 (${width}x${height})`);
    let cropX, cropY, cropWidth, cropHeight;
    const isFullScreenWithIDE = width >= 2400;
    const isPureGameScreen = width >= 1800 && width < 2400;
    if (isFullScreenWithIDE) {
      cropX = Math.round(width * 0.25);
      cropY = Math.round(height * 0.4);
      cropWidth = Math.round(width * 0.5);
      cropHeight = Math.round(height * 0.15);
      logger.info(`  检测到：全屏含IDE截图`);
    } else if (isPureGameScreen) {
      cropX = Math.round(width * 0.15);
      cropY = Math.round(height * 0.25);
      cropWidth = Math.round(width * 0.7);
      cropHeight = Math.round(height * 0.25);
      logger.info(`  检测到：纯游戏画面截图`);
    } else {
      cropX = Math.round(width * 0.2);
      cropY = Math.round(height * 0.3);
      cropWidth = Math.round(width * 0.6);
      cropHeight = Math.round(height * 0.15);
      logger.info(`  检测到：未知分辨率，使用默认裁剪`);
    }
    logger.info(`  裁剪区域: x=${cropX}, y=${cropY}, 宽=${cropWidth}, 高=${cropHeight}`);
    const croppedBuffer = await sharp(imageBuffer).extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight }).greyscale().normalize().linear(1.5, -(128 * 0.5)).toBuffer();
    logger.info(`  🖼️ 已准备裁剪图像用于OCR识别（${cropWidth}x${cropHeight}）`);
    logger.info(`🔍 开始执行 OCR 识别...`);
    const recognizedText = await performOCR(croppedBuffer);
    if (!recognizedText || recognizedText.trim() === "") {
      logger.warn(`⚠️ OCR 未识别到任何文本`);
      return [];
    }
    logger.info(`🔍 开始匹配海克斯数据库...`);
    const augments = matchAugmentDatabase(recognizedText);
    logger.info(`✅ 海克斯识别完成: 共 ${augments.length} 个`);
    return augments;
  } catch (error) {
    logger.error("❌ OCR 识别失败:", error);
    return [];
  }
}
async function performOCR(imageBuffer) {
  try {
    const Tesseract = await import("tesseract.js");
    const { createWorker } = Tesseract;
    const worker = await createWorker("chi_sim");
    const result = await worker.recognize(imageBuffer);
    await worker.terminate();
    const recognizedText = result.data.text;
    logger.info(`📖 OCR识别文本: ${recognizedText.substring(0, 200)}...`);
    logger.debug(`📝 OCR完整文本: ${recognizedText}`);
    return recognizedText;
  } catch (error) {
    logger.error("❌ OCR识别失败:", error);
    return "";
  }
}
function editDistance(a, b) {
  const matrix = Array.from(
    { length: a.length + 1 },
    (_, i) => Array.from({ length: b.length + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1] ? matrix[i - 1][j - 1] : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[a.length][b.length];
}
function fuzzyFind(text, name) {
  const nameLen = name.length;
  const textLen = text.length;
  if (nameLen === 0 || textLen < nameLen) {
    logger.debug(`   fuzzyFind: 文本太短 (${textLen} < ${nameLen})，无法匹配 "${name}"`);
    return null;
  }
  const exactIndex = text.indexOf(name);
  if (exactIndex !== -1) {
    logger.debug(`   fuzzyFind: ✨ 精确匹配成功 "${name}" @位置 ${exactIndex}`);
    return { index: exactIndex, distance: 0, matchLen: nameLen };
  }
  if (nameLen <= 2) {
    logger.debug(`   fuzzyFind: "${name}" (长度 ${nameLen} ≤2)，跳过模糊匹配`);
    return null;
  }
  const maxDistance = nameLen === 3 ? 1 : Math.floor(nameLen / 3);
  let bestMatch = null;
  const shouldDebug = name.includes("有始") || name.includes("面包") || name.includes("关键");
  if (shouldDebug) {
    logger.debug(`   fuzzyFind: 🔍 开始模糊匹配 "${name}" (长度${nameLen}, 最大允许距离${maxDistance}), 文本长度${textLen}`);
  }
  for (let i = 0; i <= text.length - nameLen; i++) {
    const window = text.slice(i, i + nameLen);
    const dist = editDistance(window, name);
    if (dist <= maxDistance) {
      if (shouldDebug) {
        logger.debug(`   fuzzyFind: 💡 潜在匹配 "${name}" ≈ "${window}" @位置 ${i} (距离 ${dist})`);
      }
      if (!bestMatch || dist < bestMatch.distance) {
        bestMatch = { index: i, distance: dist, matchLen: nameLen };
      }
    }
  }
  if (bestMatch && shouldDebug) {
    logger.debug(`   fuzzyFind: ✅ 最终选择 "${name}" @位置 ${bestMatch.index} (距离 ${bestMatch.distance})`);
  } else if (shouldDebug) {
    const sampleWindows = [];
    for (let i = 0; i <= Math.min(text.length - nameLen, 50) && sampleWindows.length < 3; i++) {
      const window = text.slice(i, i + nameLen);
      const dist = editDistance(window, name);
      if (dist <= maxDistance + 2) {
        sampleWindows.push(`"${window}"(d${dist})@${i}`);
      }
    }
    if (sampleWindows.length > 0) {
      logger.debug(`   fuzzyFind: ❌ "${name}" 未匹配，最接近的候选: ${sampleWindows.join(", ")}`);
    } else {
      logger.debug(`   fuzzyFind: ❌ "${name}" 未找到相近候选 (检查了 ${Math.min(text.length - nameLen + 1, 51)} 个窗口)`);
    }
  }
  return bestMatch;
}
function matchAugmentDatabase(recognizedText) {
  if (!recognizedText || recognizedText.trim() === "") {
    logger.warn(`⚠️ matchAugmentDatabase: 输入文本为空或空白`);
    return [];
  }
  const database = initAugmentDatabase();
  const databaseSize = Object.keys(database).length;
  logger.info(`🔍 开始匹配海克斯数据库: 数据库包含 ${databaseSize} 个海克斯`);
  logger.debug(`📝 输入原文本长度: ${recognizedText.length} 字符`);
  const blacklist = /* @__PURE__ */ new Set([
    // 属性描述词
    "攻击",
    "防御",
    "生命",
    "法术",
    "魔法",
    "技能",
    "冷却",
    "移速",
    "暴击",
    "吸血",
    "穿透",
    // 功能描述词
    "功能",
    "能力",
    "效果",
    "被动",
    "主动",
    "额外",
    "持续",
    "提供",
    "增加",
    "获得",
    "造成"
  ]);
  const augments = [];
  const seenIds = /* @__PURE__ */ new Set();
  let normalizedText = recognizedText.replace(/\s+/g, "");
  logger.info(`📝 归一化后文本: "${normalizedText.substring(0, 100)}..." (${normalizedText.length} 字符)`);
  const sortedAugments = Object.values(database).sort((a, b) => {
    const aLen = a.name.replace(/\s+/g, "").length;
    const bLen = b.name.replace(/\s+/g, "").length;
    return bLen - aLen;
  });
  logger.debug(`📊 海克斯按名称长度排序完成，最长名称: "${sortedAugments[0]?.name}" (${sortedAugments[0]?.name?.replace(/\s+/g, "").length} 字符)`);
  const candidates = [];
  const seenNames = /* @__PURE__ */ new Set();
  let skippedBlacklist = 0;
  let skippedDuplicateId = 0;
  let skippedDuplicateName = 0;
  let matchedCount = 0;
  for (const augmentData of sortedAugments) {
    const normalizedName = augmentData.name.replace(/\s+/g, "");
    if (blacklist.has(augmentData.name)) {
      skippedBlacklist++;
      continue;
    }
    if (seenIds.has(augmentData.id)) {
      skippedDuplicateId++;
      continue;
    }
    if (seenNames.has(normalizedName)) {
      skippedDuplicateName++;
      logger.debug(`⚠️ 跳过重复名称: "${augmentData.name}" (id: ${augmentData.id})`);
      continue;
    }
    const match = fuzzyFind(normalizedText, normalizedName);
    if (match) {
      matchedCount++;
      logger.info(`✅ 匹配成功 [#${matchedCount}]: "${augmentData.name}" (id: ${augmentData.id}, 位置: ${match.index}, 编辑距离: ${match.distance})`);
      candidates.push({
        augmentData,
        match,
        originalIndex: match.index
      });
      seenIds.add(augmentData.id);
      seenNames.add(normalizedName);
      const beforeLen = normalizedText.length;
      normalizedText = normalizedText.slice(0, match.index) + normalizedText.slice(match.index + match.matchLen);
      logger.debug(`   移除匹配文本后长度: ${beforeLen} → ${normalizedText.length} 字符`);
    }
  }
  logger.info(`📊 匹配统计: 检查 ${sortedAugments.length} 个海克斯, 跳过黑名单(${skippedBlacklist}), 跳过重复ID(${skippedDuplicateId}), 跳过重复名称(${skippedDuplicateName}), 成功匹配(${matchedCount})`);
  candidates.sort((a, b) => a.originalIndex - b.originalIndex);
  logger.debug(`📊 按位置排序后候选数: ${candidates.length}`);
  candidates.forEach((c, i) => {
    logger.debug(`   [#${i + 1}] "${c.augmentData.name}" @位置 ${c.originalIndex}`);
  });
  for (const candidate of candidates.slice(0, 3)) {
    const confidence = candidate.match.distance === 0 ? 0.95 : 0.8;
    augments.push({
      id: candidate.augmentData.id,
      name: candidate.augmentData.name,
      rarity: candidate.augmentData.rarity,
      confidence
    });
  }
  if (augments.length > 0) {
    logger.info(`✅ 匹配到 ${augments.length} 个海克斯: ${augments.map((a) => `"${a.name}" (id:${a.id})`).join(", ")}`);
  } else {
    logger.warn(`⚠️ 未匹配到海克斯 - 最终返回空数组 (候选池: ${candidates.length})`);
  }
  return augments;
}
const analyzeScreenshot = async (imageBuffer) => {
  try {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      return {
        success: false,
        error: "截图数据无效"
      };
    }
    const timestamp = Date.now();
    logger.info(`🔍 开始分析截图: buffer size ${(imageBuffer.length / 1024).toFixed(1)}KB`);
    const recognizedAugments = await recognizeAugmentsFromImage(imageBuffer);
    logger.info(`🔍 OCR识别结果: 检测到 ${recognizedAugments.length} 个海克斯`);
    const isAugmentPhase = recognizedAugments.length >= 1;
    const confidence = isAugmentPhase ? 0.95 : 0;
    const analysisResult = {
      success: true,
      timestamp,
      analysis: {
        augments: recognizedAugments,
        // OCR识别到的海克斯
        cardCount: recognizedAugments.length,
        // 识别到的海克斯数量
        cardColors: [],
        // 不再使用颜色检测
        confidence,
        // 简化的置信度（0 或 0.95）
        isAugmentPhase,
        // 是否处于海克斯选择阶段
        cardPositions: [],
        // 不再使用卡片位置
        detectionMethod: "ocr-based"
        // 新方案标记
      },
      metadata: {
        bufferSize: imageBuffer.length,
        format: "png",
        detectionMethod: "ocr"
      }
    };
    logger.info(`✅ 截图分析完成: 识别到 ${recognizedAugments.length} 个海克斯`);
    return analysisResult;
  } catch (error) {
    logger.error("❌ 截图分析失败:", error);
    return {
      success: false,
      error: error.message
    };
  }
};
const store$3 = new Store();
class AutoScreenshotService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.interval = 5e3;
    this.maxScreenshots = 50;
    this.screenshotCount = 0;
    this.lastScreenshotTime = null;
    this.enableAnalysis = true;
    this.analysisCount = 0;
    this.detectionCount = 0;
    this.performanceMetrics = {
      captureTime: [],
      // 截图耗时数组
      memoryUsage: []
      // 内存使用量
    };
  }
  /**
   * 启动定时截图
   * @param {number} intervalMs - 截图间隔（毫秒）
   * @returns {boolean} 是否成功启动
   */
  async start(intervalMs = 5e3) {
    if (this.isRunning) {
      logger.info("Auto screenshot already running");
      return false;
    }
    this.interval = Math.max(intervalMs, 1e3);
    this.isRunning = true;
    this.screenshotCount = 0;
    logger.info(`Auto screenshot service started with interval: ${this.interval}ms`);
    this.intervalId = setInterval(async () => {
      await this._captureScreenshot();
    }, this.interval);
    return true;
  }
  /**
   * 停止定时截图
   * @returns {boolean} 是否成功停止
   */
  stop() {
    if (!this.isRunning) {
      logger.info("Auto screenshot not running");
      return false;
    }
    clearInterval(this.intervalId);
    this.isRunning = false;
    this.intervalId = null;
    logger.info(`Auto screenshot service stopped. Total screenshots: ${this.screenshotCount}`);
    return true;
  }
  /**
   * 内部方法：执行单次截图
   * @private
   */
  async _captureScreenshot() {
    const startTime = performance.now();
    try {
      let floatingWindow2 = null;
      let wasFloatingVisible = false;
      try {
        const windows = BrowserWindow$1.getAllWindows();
        floatingWindow2 = windows.find((win) => {
          const url = win.webContents.getURL();
          return url.includes("floating-overlay");
        });
        if (floatingWindow2 && !floatingWindow2.isDestroyed() && floatingWindow2.isVisible()) {
          wasFloatingVisible = true;
          floatingWindow2.hide();
          logger.debug("⏸️ 暂时隐藏浮动窗口以进行截图");
        }
      } catch (hideErr) {
        logger.warn("隐藏浮动窗口失败:", hideErr.message);
      }
      const result = await captureScreenshot();
      const endTime = performance.now();
      const captureTimeMs = endTime - startTime;
      if (result.success) {
        this.screenshotCount++;
        this.lastScreenshotTime = Date.now();
        this._recordPerformance(captureTimeMs);
        logger.info(
          `[Auto Screenshot ${this.screenshotCount}] Captured in ${captureTimeMs.toFixed(2)}ms`
        );
        if (this.enableAnalysis) {
          setImmediate(async () => {
            await this._analyzeScreenshot(result.buffer);
            if (wasFloatingVisible && floatingWindow2 && !floatingWindow2.isDestroyed()) {
              try {
                floatingWindow2.show();
                logger.debug("▶️ 恢复浮动窗口显示");
              } catch (showErr) {
                logger.warn("恢复浮动窗口显示失败:", showErr.message);
              }
            }
          });
        } else {
          if (wasFloatingVisible && floatingWindow2 && !floatingWindow2.isDestroyed()) {
            try {
              floatingWindow2.show();
              logger.debug("▶️ 恢复浮动窗口显示（未启用分析）");
            } catch (showErr) {
              logger.warn("恢复浮动窗口显示失败:", showErr.message);
            }
          }
        }
        return result;
      } else {
        if (wasFloatingVisible && floatingWindow2 && !floatingWindow2.isDestroyed()) {
          try {
            floatingWindow2.show();
            logger.debug("▶️ 恢复浮动窗口显示（截图失败）");
          } catch (showErr) {
            logger.warn("恢复浮动窗口显示失败:", showErr.message);
          }
        }
        logger.error("Auto screenshot failed:", result.error);
        return result;
      }
    } catch (error) {
      logger.error("Auto screenshot error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  /**
   * 内部方法：分析截图
   * @private
   */
  async _analyzeScreenshot(imageBuffer) {
    try {
      this.analysisCount++;
      const analysisResult = await analyzeScreenshot(imageBuffer);
      if (!analysisResult.success) {
        return;
      }
      const { cardCount, confidence, isAugmentPhase } = analysisResult.analysis;
      if (cardCount === 3 && isAugmentPhase && confidence > 0.9) {
        this.detectionCount++;
        logger.info(`✨ [自动分析 ${this.analysisCount}] ✅ 高置信度检测: ${cardCount} 个有效海克斯卡片，置信度 ${(confidence * 100).toFixed(1)}%`);
        logger.info(`   通知 UI 显示推荐`);
        this._notifyAugmentDetected(analysisResult);
      } else {
        if (cardCount < 3) {
          logger.info(`[自动分析 ${this.analysisCount}] ⚠️ 卡片数量不足: ${cardCount} < 3`);
        } else if (!isAugmentPhase) {
          logger.info(`[自动分析 ${this.analysisCount}] ⚠️ 验证失败：卡片间距或位置不符`);
        } else if (confidence <= 0.9) {
          logger.info(`[自动分析 ${this.analysisCount}] ⚠️ 置信度过低: ${(confidence * 100).toFixed(1)}% <= 90%`);
        }
      }
    } catch (error) {
      logger.error("Auto screenshot analysis error:", error);
    }
  }
  /**
   * 通知所有窗口有新的海克斯检测
   * @private
   */
  _notifyAugmentDetected(analysisResult) {
    try {
      const championId = store$3.get("lastSelectedChampionId");
      if (!championId) {
        logger.warn("⚠️ 未找到缓存的英雄ID，海克斯推荐可能无法显示胜率数据");
      } else {
        logger.info(`📌 使用缓存的英雄ID: ${championId}`);
      }
      const windows = BrowserWindow$1.getAllWindows();
      const winrateData = {
        success: true,
        gamePhase: "augment-select",
        championId: championId || null,
        // 添加英雄ID
        augments: analysisResult.analysis.augments.slice(0, 3).map((aug) => ({
          id: aug.id,
          name: aug.name,
          rarity: aug.rarity,
          confidence: aug.confidence
        })),
        analysisConfidence: analysisResult.analysis.confidence,
        timestamp: analysisResult.timestamp,
        dataSource: "auto-analysis"
      };
      const floatingWindow2 = windows.find((win) => {
        const url = win.webContents.getURL();
        return url.includes("floating-overlay");
      });
      if (floatingWindow2 && !floatingWindow2.isDestroyed()) {
        if (!floatingWindow2.isVisible()) {
          floatingWindow2.show();
          logger.info("✨ 显示海克斯浮动窗口");
        }
        floatingWindow2.webContents.send("augment-detected", winrateData);
      } else {
        logger.warn("⚠️ 未找到浮动窗口，将数据发送给所有窗口");
        windows.forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send("augment-detected", winrateData);
          }
        });
      }
      logger.info("📢 已通知UI窗口有新的海克斯检测");
    } catch (error) {
      logger.error("Failed to notify windows:", error);
    }
  }
  /**
   * 记录性能指标
   * @private
   */
  _recordPerformance(captureTimeMs) {
    this.performanceMetrics.captureTime.push(captureTimeMs);
    if (this.performanceMetrics.captureTime.length > 100) {
      this.performanceMetrics.captureTime.shift();
    }
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage();
      this.performanceMetrics.memoryUsage.push(memUsage.heapUsed / 1024 / 1024);
      if (this.performanceMetrics.memoryUsage.length > 100) {
        this.performanceMetrics.memoryUsage.shift();
      }
    }
  }
  /**
   * 获取性能统计
   * @returns {Object} 性能指标
   */
  getPerformanceStats() {
    const captureTimes = this.performanceMetrics.captureTime;
    const memoryUsages = this.performanceMetrics.memoryUsage;
    if (captureTimes.length === 0) {
      return {
        isRunning: this.isRunning,
        screenshotCount: this.screenshotCount,
        analysisCount: this.analysisCount,
        detectionCount: this.detectionCount,
        averageCaptureTime: 0,
        maxCaptureTime: 0,
        minCaptureTime: 0,
        averageMemory: 0,
        maxMemory: 0,
        performanceLevel: this._assessPerformanceLevel(0, 0)
      };
    }
    const avgCapture = captureTimes.reduce((a, b) => a + b, 0) / captureTimes.length;
    const maxCapture = Math.max(...captureTimes);
    const minCapture = Math.min(...captureTimes);
    const avgMemory = memoryUsages.length > 0 ? memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length : 0;
    const maxMemory = memoryUsages.length > 0 ? Math.max(...memoryUsages) : 0;
    return {
      isRunning: this.isRunning,
      screenshotCount: this.screenshotCount,
      analysisCount: this.analysisCount,
      detectionCount: this.detectionCount,
      detectionRate: this.analysisCount > 0 ? (this.detectionCount / this.analysisCount * 100).toFixed(1) : 0,
      interval: this.interval,
      lastScreenshotTime: this.lastScreenshotTime,
      averageCaptureTime: parseFloat(avgCapture.toFixed(2)),
      maxCaptureTime: parseFloat(maxCapture.toFixed(2)),
      minCaptureTime: parseFloat(minCapture.toFixed(2)),
      averageMemory: parseFloat(avgMemory.toFixed(2)),
      maxMemory: parseFloat(maxMemory.toFixed(2)),
      performanceLevel: this._assessPerformanceLevel(avgCapture, avgMemory)
    };
  }
  /**
   * 评估性能等级
   * @private
   */
  _assessPerformanceLevel(captureTimeMs, memoryMB) {
    if (captureTimeMs < 100 && memoryMB < 200) {
      return {
        level: "excellent",
        score: 95,
        label: "优秀 - 对游戏基本无影响",
        color: "#27ae60"
      };
    } else if (captureTimeMs < 200 && memoryMB < 300) {
      return {
        level: "good",
        score: 85,
        label: "良好 - 对游戏影响很小",
        color: "#f39c12"
      };
    } else if (captureTimeMs < 500 && memoryMB < 500) {
      return {
        level: "fair",
        score: 70,
        label: "一般 - 可能有轻微影响",
        color: "#e67e22"
      };
    } else {
      return {
        level: "poor",
        score: 50,
        label: "较差 - 可能影响游戏性能",
        color: "#e74c3c"
      };
    }
  }
  /**
   * 设置配置
   * @param {Object} config - 配置对象
   */
  setConfig(config) {
    if (config.interval !== void 0 && config.interval > 0) {
      this.interval = config.interval;
    }
    if (config.maxScreenshots !== void 0 && config.maxScreenshots > 0) {
      this.maxScreenshots = config.maxScreenshots;
    }
    if (config.enableAnalysis !== void 0) {
      this.enableAnalysis = config.enableAnalysis;
    }
  }
  /**
   * 获取当前配置
   */
  getConfig() {
    return {
      isRunning: this.isRunning,
      interval: this.interval,
      maxScreenshots: this.maxScreenshots,
      enableAnalysis: this.enableAnalysis,
      screenshotCount: this.screenshotCount,
      analysisCount: this.analysisCount,
      detectionCount: this.detectionCount
    };
  }
  /**
   * 重置服务
   */
  reset() {
    this.stop();
    this.screenshotCount = 0;
    this.analysisCount = 0;
    this.detectionCount = 0;
    this.lastScreenshotTime = null;
    this.performanceMetrics = {
      captureTime: [],
      memoryUsage: []
    };
  }
}
const autoScreenshotService = new AutoScreenshotService();
async function getLcuToken(dirPath) {
  try {
    if (!dirPath) {
      logger.warn("[getLcuToken] ❌ 英雄联盟目录路径为空");
      return [null, null, null];
    }
    const normalizedPath = dirPath.replace(/\//g, "\\");
    logger.info("[getLcuToken] 规范化后的路径:", normalizedPath);
    const dir = path.join(normalizedPath, "LeagueClient");
    if (!fs$1.existsSync(dir)) {
      logger.warn(`[getLcuToken] ❌ LeagueClient 目录不存在: ${dir}`);
      return [null, null, null];
    }
    logger.info(`[getLcuToken] 读取目录: ${dir}`);
    const files = fs$1.readdirSync(dir);
    const logFiles = files.filter((f) => f.includes("LeagueClientUx.log") && !f.includes("-tracing")).sort((a, b) => {
      return a.localeCompare(b);
    });
    const latest = logFiles.pop();
    if (!latest) {
      logger.error(`[getLcuToken] ❌ 未找到 LeagueClientUx.log 文件`);
      logger.info(`[getLcuToken] 可用文件:`, files.slice(0, 5));
      return [null, null, null];
    }
    logger.info(`[getLcuToken] 读取文件: ${latest}`);
    const filePath = path.join(dir, latest);
    const content = fs$1.readFileSync(filePath, "utf8");
    logger.info(`[getLcuToken] 文件大小: ${content.length} bytes`);
    const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/);
    if (urlMatch) {
      const token = urlMatch[1];
      const port = urlMatch[2];
      const urlWithAuth = `https://riot:${token}@127.0.0.1:${port}`;
      logger.info(`[getLcuToken] ✅ 成功提取:`);
      logger.info(`  Token: ${token.substring(0, 10)}...`);
      logger.info(`  Port: ${port}`);
      return [token, port, urlWithAuth];
    }
    logger.info(`[getLcuToken] 标准格式未匹配，尝试备用模式...`);
    const altMatch = content.match(/https(.*)\/index\.html/);
    if (altMatch) {
      const url = altMatch[1];
      const tokenMatch = url.match(/riot:(.*)@/);
      const portMatch = url.match(/:(\d+)/);
      if (tokenMatch && portMatch) {
        const token = tokenMatch[1];
        const port = portMatch[1];
        const urlWithAuth = `https${url}`;
        logger.info(`[getLcuToken] ✅ 成功提取（备用模式）:`);
        logger.info(`  Token: ${token.substring(0, 10)}...`);
        logger.info(`  Port: ${port}`);
        return [token, port, urlWithAuth];
      }
    }
    logger.error(`[getLcuToken] ❌ 未找到有效的 URL 模式`);
    return [null, null, null];
  } catch (err) {
    const error = err;
    logger.error(`[getLcuToken] ❌ 错误:`, error.message);
    logger.error(`  Stack:`, error.stack);
    return [null, null, null];
  }
}
class LCUService {
  lolPath;
  active = false;
  url = null;
  token = null;
  port = null;
  auth = null;
  urls = null;
  // 缓存相关
  lastTokenFetchTime = 0;
  lastFailTime = 0;
  tokenCacheDuration;
  failCooldown;
  // HTTPS Agent（禁用证书验证，LCU 使用自签名证书）
  httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });
  constructor(options) {
    this.lolPath = options.lolPath;
    this.tokenCacheDuration = options.tokenCacheDuration ?? 6e4;
    this.failCooldown = options.failCooldown ?? 1e4;
  }
  /**
   * 设置内部变量（认证信息和 API URLs）
   */
  setVars(token, port, url) {
    this.active = !!token;
    this.url = url;
    this.token = token;
    this.port = port;
    if (token && url) {
      this.auth = {
        auth: {
          username: "riot",
          password: token
        }
      };
      this.urls = {
        authToken: `${url}/riotclient/auth-token`,
        curSession: `${url}/lol-champ-select/v1/session`,
        curPerk: `${url}/lol-perks/v1/currentpage`,
        perks: `${url}/lol-perks/v1/pages`,
        position1: `${url}/lol-lobby-team-builder/v1/position-preferences`,
        position2: `${url}/lol-lobby-team-builder/v2/position-preferences`,
        gameflowPhase: `${url}/lol-gameflow/v1/gameflow-phase`,
        gameflowSession: `${url}/lol-gameflow/v1/session`
      };
    } else {
      this.auth = null;
      this.urls = null;
    }
  }
  /**
   * 获取认证 token（带缓存和失败冷却机制）
   * @param forceRefresh - 是否强制刷新 token
   */
  async getAuthToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.lastFailTime && now - this.lastFailTime < this.failCooldown) {
      return null;
    }
    const needRefresh = forceRefresh || !this.active || now - this.lastTokenFetchTime > this.tokenCacheDuration;
    if (this.active && !needRefresh && this.token && this.url) {
      return { token: this.token, port: this.port, url: this.url };
    }
    try {
      const [token, port, urlWithAuth] = await getLcuToken(this.lolPath);
      if (!token || !port) {
        logger.warn("无法获取 LCU Token，游戏客户端可能未运行");
        this.setVars(null, null, null);
        this.lastFailTime = now;
        return null;
      }
      const url = `https://127.0.0.1:${port}`;
      this.setVars(token, port, url);
      this.lastTokenFetchTime = now;
      this.lastFailTime = 0;
      logger.info(`LCU 连接成功 (端口: ${port})`);
      return { token, port, url };
    } catch (error) {
      const err = error;
      logger.error("LCU 连接失败:", err.message);
      this.setVars(null, null, null);
      this.lastFailTime = now;
      return null;
    }
  }
  /**
   * 检查 LCU 状态
   */
  async getLcuStatus() {
    if (!this.urls || !this.auth) {
      return false;
    }
    try {
      const res = await axios.get(this.urls.authToken, {
        ...this.auth,
        httpsAgent: this.httpsAgent
      });
      return !!res;
    } catch (error) {
      return false;
    }
  }
  /**
   * 获取当前选人会话
   */
  async getCurrentSession() {
    if (!this.active || !this.urls || !this.auth) {
      return null;
    }
    try {
      const res = await axios.get(this.urls.curSession, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500
      });
      if (res.status === 404 || res.status === 401) {
        if (res.status === 401) {
          logger.warn("LCU 认证失效，需要重新连接");
          this.active = false;
          this.lastFailTime = Date.now();
        }
        return null;
      }
      return res.data;
    } catch (error) {
      const err = error;
      if (err.code === "ECONNREFUSED") {
        this.active = false;
        this.lastFailTime = Date.now();
        logger.warn("LCU 连接丢失");
      }
      return null;
    }
  }
  /**
   * 获取当前符文页
   */
  async getCurPerk() {
    if (!this.urls || !this.auth) {
      return null;
    }
    try {
      const res = await axios.get(this.urls.curPerk, {
        ...this.auth,
        httpsAgent: this.httpsAgent
      });
      logger.info("当前符文页:", res.data);
      return res.data;
    } catch (error) {
      return null;
    }
  }
  /**
   * 获取符文页列表
   */
  async getPerkList() {
    if (!this.urls || !this.auth) {
      return [];
    }
    try {
      const res = await axios.get(this.urls.perks, {
        ...this.auth,
        httpsAgent: this.httpsAgent
      });
      return res.data;
    } catch (error) {
      return [];
    }
  }
  /**
   * 删除符文页
   */
  async deletePerk(id) {
    if (!this.urls || !this.auth) {
      return false;
    }
    try {
      await axios.delete(`${this.urls.perks}/${id}`, {
        ...this.auth,
        httpsAgent: this.httpsAgent
      });
      return true;
    } catch (error) {
      return false;
    }
  }
  /**
   * 创建符文页
   */
  async createPerk(data) {
    if (!this.urls || !this.auth) {
      return false;
    }
    try {
      await axios.post(this.urls.perks, data, {
        ...this.auth,
        httpsAgent: this.httpsAgent
      });
      return true;
    } catch (error) {
      return false;
    }
  }
  /**
   * 应用符文页
   * 先删除当前可删除的符文页，再创建新的
   */
  async applyPerk(data) {
    const list = await this.getPerkList();
    const current = list.find((i) => i.current && i.isDeletable);
    if (current) {
      await this.deletePerk(current.id);
      await this.createPerk(data);
      return true;
    }
    await this.createPerk(data);
    return true;
  }
  /**
   * 获取当前游戏阶段
   * 返回值例如: "ChampSelect", "GameStart", "InProgress", "EndOfGame" 等
   */
  async getGameflowPhase() {
    if (!this.active || !this.url) {
      await this.getAuthToken();
    }
    if (!this.active || !this.urls || !this.auth) {
      return null;
    }
    try {
      const res = await axios.get(this.urls.gameflowPhase, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
        timeout: 5e3
        // 添加超时
      });
      if (res.status === 404 || res.status === 401) {
        logger.warn("LCU 认证失效，尝试重新连接...");
        this.active = false;
        await this.getAuthToken();
        return null;
      }
      logger.info("🎮 当前游戏阶段:", res.data);
      return res.data;
    } catch (error) {
      const err = error;
      if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
        logger.warn("LCU 连接丢失，尝试重新连接...");
        this.active = false;
        await this.getAuthToken();
      } else {
        logger.warn("获取游戏阶段失败:", err.message);
      }
      return null;
    }
  }
  /**
   * 获取游戏会话信息
   * 包含游戏 ID、地区、队伍信息等
   */
  async getGameflowSession() {
    if (!this.urls || !this.auth) {
      return null;
    }
    try {
      const res = await axios.get(this.urls.gameflowSession, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500
      });
      logger.info("📋 游戏会话信息:", res.data);
      return res.data;
    } catch (error) {
      const err = error;
      logger.error("获取游戏会话失败:", err.message);
      return null;
    }
  }
  /**
   * 轮询游戏阶段（用于监听阶段变化）
   * @param callback - 阶段变化时的回调函数
   * @param interval - 轮询间隔（毫秒），默认1000ms
   * @returns 定时器ID，可用于后续停止轮询
   */
  pollGameflowPhase(callback, interval = 1e3) {
    let lastPhase = null;
    const timer = setInterval(async () => {
      try {
        const phase = await this.getGameflowPhase();
        if (phase && phase !== lastPhase) {
          logger.info(`📍 游戏阶段变化: ${lastPhase} → ${phase}`);
          lastPhase = phase;
          callback(phase);
        }
      } catch (error) {
        const err = error;
        logger.warn("轮询游戏阶段出错:", err.message);
      }
    }, interval);
    return timer;
  }
  /**
   * 停止轮询游戏阶段
   * @param timerId - 由 pollGameflowPhase 返回的定时器ID
   */
  stopPollGameflowPhase(timerId) {
    if (timerId) {
      clearInterval(timerId);
      logger.info("⏹️ 停止游戏阶段轮询");
    }
  }
  /**
   * 获取服务状态
   */
  isActive() {
    return this.active;
  }
  /**
   * 获取当前 URL
   */
  getUrl() {
    return this.url;
  }
  /**
   * 获取游戏路径
   */
  getLolPath() {
    return this.lolPath;
  }
}
const instances = /* @__PURE__ */ new Map();
function getLCUServiceInstance(lolPath, options) {
  if (!instances.has(lolPath)) {
    instances.set(
      lolPath,
      new LCUService({
        lolPath,
        ...options
      })
    );
  }
  return instances.get(lolPath);
}
const store$2 = new Store();
function registerLCUIpcHandlers() {
  ipcMain.handle("get-champion-id", async () => {
    try {
      const lolPath = store$2.get("lolPath");
      if (!lolPath) {
        logger.warn("[LCU] 未设置游戏路径");
        return {
          success: false,
          championId: null,
          error: "游戏路径未配置"
        };
      }
      logger.info(`[LCU] 游戏路径: ${lolPath}`);
      const lcuService = getLCUServiceInstance(lolPath);
      if (!lcuService.isActive()) {
        logger.info("[LCU] LCU 服务未激活，尝试获取认证令牌...");
        const authResult = await lcuService.getAuthToken();
        logger.info(`[LCU] 认证结果: ${JSON.stringify(authResult)}`);
        if (!lcuService.isActive()) {
          logger.warn("[LCU] LCU 服务激活失败");
          return {
            success: false,
            championId: null,
            error: "LCU 未激活 - 请确保游戏客户端正在运行"
          };
        }
      }
      logger.info("[LCU] 正在获取选人会话...");
      const sessionData = await lcuService.getCurrentSession();
      if (!sessionData) {
        logger.warn("[LCU] 无法获取选人会话数据");
        return {
          success: false,
          championId: null,
          error: "无有效的选人会话 - 请确保处于英雄选择阶段"
        };
      }
      if (sessionData.errorCode) {
        logger.warn(`[LCU] 选人会话错误: ${sessionData.errorCode}`);
        return {
          success: false,
          championId: null,
          error: `选人会话错误: ${sessionData.errorCode}`
        };
      }
      const localPlayerCellId = sessionData.localPlayerCellId;
      logger.info(`[LCU] 当前玩家 cellId: ${localPlayerCellId}`);
      logger.debug(`[LCU] myTeam 数据: ${JSON.stringify(sessionData.myTeam || [])}`);
      logger.debug(`[LCU] actions 数据: ${JSON.stringify(sessionData.actions || [])}`);
      if (sessionData.myTeam && Array.isArray(sessionData.myTeam)) {
        for (const member of sessionData.myTeam) {
          if (member.cellId === localPlayerCellId && member.championId && member.championId !== 0) {
            logger.info(
              `[LCU] ✅ 从 myTeam 获得英雄ID: ${member.championId} (cellId: ${localPlayerCellId})`
            );
            return {
              success: true,
              championId: member.championId
            };
          }
        }
      }
      if (sessionData.actions && Array.isArray(sessionData.actions) && sessionData.actions.length > 0) {
        for (const actionGroup of sessionData.actions) {
          if (Array.isArray(actionGroup)) {
            for (const action of actionGroup) {
              if (action.actorCellId === localPlayerCellId && action.championId && action.championId !== 0) {
                logger.info(
                  `[LCU] ✅ 从 actions 获得英雄ID: ${action.championId} (cellId: ${localPlayerCellId})`
                );
                return {
                  success: true,
                  championId: action.championId
                };
              }
            }
          }
        }
      }
      logger.warn(`[LCU] ❌ 未找到当前玩家选择的英雄 (cellId: ${localPlayerCellId})`);
      logger.warn(`[LCU]    myTeam 长度: ${sessionData.myTeam?.length || 0}`);
      logger.warn(`[LCU]    actions 长度: ${sessionData.actions?.length || 0}`);
      return {
        success: false,
        championId: null,
        error: "未找到英雄选择 - 请确保已选择英雄"
      };
    } catch (error) {
      logger.error("[LCU] 获取英雄ID时发生错误:", error);
      const err = error;
      return {
        success: false,
        championId: null,
        error: err.message
      };
    }
  });
  logger.info("LCU IPC 处理器已注册");
}
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
let mainWindow = null;
let popupWindow = null;
let floatingWindow = null;
function getPreloadPath(isDev) {
  const appPath = app.getAppPath();
  if (isDev) {
    return path.join(appPath, "dist-electron", "preload.mjs");
  } else {
    return path.join(appPath, "dist-electron", "preload.mjs");
  }
}
const getWebPreferences = (isDev) => ({
  nodeIntegration: true,
  nodeIntegrationInWorker: true,
  webSecurity: false,
  contextIsolation: false,
  sandbox: false,
  preload: getPreloadPath(isDev)
});
const createMainWindow = async (isDev, devServerUrl) => {
  const webPreferences = getWebPreferences(isDev);
  mainWindow = new BrowserWindow$1({
    width: 800,
    height: 600,
    webPreferences,
    title: "lol符文助手"
  });
  mainWindow.on("close", () => {
    logger.info("Main window closing...");
    if (popupWindow && !popupWindow.isDestroyed()) {
      logger.info("Closing popup window...");
      popupWindow.close();
    }
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      logger.info("Closing floating window...");
      floatingWindow.close();
    }
  });
  mainWindow.on("closed", () => {
    logger.info("Main window closed");
    mainWindow = null;
  });
  if (isDev) {
    mainWindow.loadURL(`${devServerUrl}/#/display`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
  return mainWindow;
};
const createPopupWindow = async (isDev, devServerUrl) => {
  const [mX, mY] = mainWindow.getPosition();
  const curDisplay = screen.getDisplayNearestPoint({
    x: mX,
    y: mY
  });
  const webPreferences = getWebPreferences(isDev);
  popupWindow = new BrowserWindow$1({
    show: false,
    frame: true,
    skipTaskbar: true,
    resizable: isDev || false,
    fullscreenable: false,
    alwaysOnTop: true,
    // 始终置顶，包括开发模式
    width: 400,
    height: 600,
    x: curDisplay.bounds.width - 400 - 140,
    y: curDisplay.bounds.height / 2,
    webPreferences
  });
  popupWindow.on("closed", () => {
    logger.info("Popup window closed");
    popupWindow = void 0;
  });
  await popupWindow.loadURL(
    isDev ? `${devServerUrl}/#/augment-overlay` : `file://${path.join(__dirname$1, "../dist/index.html")}#/augment-overlay`
  );
  return popupWindow;
};
const createFloatingWindow = async (isDev, devServerUrl) => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const webPreferences = getWebPreferences(isDev);
  const windowWidth = 850;
  const windowHeight = 200;
  const windowX = Math.round((screenWidth - windowWidth) / 2);
  const windowY = Math.round(screenHeight * 0.12);
  floatingWindow = new BrowserWindow$1({
    show: false,
    frame: false,
    // 无边框
    transparent: true,
    // 透明背景
    skipTaskbar: true,
    // 不在任务栏显示
    resizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    // 始终置顶
    focusable: false,
    // 不获取焦点，避免干扰游戏
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    webPreferences
  });
  floatingWindow.on("closed", () => {
    logger.info("Floating window closed");
    floatingWindow = void 0;
  });
  await floatingWindow.loadURL(
    isDev ? `${devServerUrl}/#/floating-overlay` : `file://${path.join(__dirname$1, "../dist/index.html")}#/floating-overlay`
  );
  if (isDev) {
    floatingWindow.webContents.openDevTools({ mode: "detach" });
  }
  logger.info("透明浮动窗口已创建", { x: windowX, y: windowY, width: windowWidth, height: windowHeight });
  return floatingWindow;
};
const getMainWindow = () => mainWindow;
const getPopupWindow = () => popupWindow;
const getFloatingWindow = () => floatingWindow;
const toggleMainWindow = () => {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  }
};
const windowManager = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createFloatingWindow,
  createMainWindow,
  createPopupWindow,
  getFloatingWindow,
  getMainWindow,
  getPopupWindow,
  toggleMainWindow
}, Symbol.toStringTag, { value: "Module" }));
const store$1 = new Store();
function registerIpcHandlers(isDev) {
  ipcMain.handle("store-get", (event, key) => {
    return store$1.get(key);
  });
  ipcMain.handle("store-set", (event, key, value) => {
    store$1.set(key, value);
  });
  ipcMain.handle("store-delete", (event, key) => {
    store$1.delete(key);
  });
  ipcMain.handle("store-clear", () => {
    store$1.clear();
  });
  ipcMain.on(`broadcast`, (ev, data) => {
    ev.sender.send(data.channel, data);
  });
  ipcMain.on(`show-popup`, async (ev, data) => {
    const popupWindow2 = getPopupWindow();
    if (!popupWindow2) {
      const { createPopupWindow: createPopupWindow2 } = await Promise.resolve().then(() => windowManager);
      const devServerUrl = isDev ? "http://localhost:5173" : "";
      await createPopupWindow2(isDev, devServerUrl);
    }
    const newPopupWindow = getPopupWindow();
    newPopupWindow.show();
    newPopupWindow.webContents.send(`for-popup`, {
      championId: data.championId,
      position: data.position,
      augments: data.augments,
      dataSource: data.dataSource,
      timestamp: data.timestamp
    });
  });
  ipcMain.on(`hide-popup`, async () => {
    const popupWindow2 = getPopupWindow();
    if (popupWindow2) {
      const isVisible = popupWindow2.isVisible();
      if (isVisible) {
        popupWindow2.hide();
      }
    }
  });
  ipcMain.on(`hide-floating`, async () => {
    const { getFloatingWindow: getFloatingWindow2 } = await Promise.resolve().then(() => windowManager);
    const floatingWindow2 = getFloatingWindow2();
    if (floatingWindow2 && !floatingWindow2.isDestroyed()) {
      const isVisible = floatingWindow2.isVisible();
      if (isVisible) {
        floatingWindow2.hide();
        logger.info("隐藏浮动窗口");
      }
    }
  });
  ipcMain.handle("test-show-floating", async (event, data) => {
    try {
      const { getFloatingWindow: getFloatingWindow2 } = await Promise.resolve().then(() => windowManager);
      const floatingWindow2 = getFloatingWindow2();
      if (!floatingWindow2 || floatingWindow2.isDestroyed()) {
        logger.error("浮动窗口不存在");
        return { success: false, error: "浮动窗口不存在" };
      }
      if (!floatingWindow2.isVisible()) {
        floatingWindow2.show();
        logger.info("✨ 显示浮动窗口（测试）");
      }
      floatingWindow2.webContents.send("augment-detected", data);
      logger.info("📢 已发送测试数据到浮动窗口");
      return { success: true };
    } catch (error) {
      logger.error("测试浮动窗口失败:", error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.on(`toggle-main-window`, () => {
    (async () => {
      const { toggleMainWindow: toggleMainWindow2 } = await Promise.resolve().then(() => windowManager);
      toggleMainWindow2();
    })();
  });
  ipcMain.on(`restart-app`, () => {
    (async () => {
      const { app: app2 } = await import("electron");
      app2.relaunch();
      app2.exit();
    })();
  });
  ipcMain.handle("screenshot-capture", async () => {
    const result = await captureScreenshot();
    return result;
  });
  ipcMain.handle("analyze-screenshot", async (event, imagePath) => {
    const result = await analyzeScreenshot(imagePath);
    return result;
  });
  ipcMain.handle("get-winrate", async (event, data) => {
    const { championId, augmentIds } = data;
    try {
      const { getChampionAugmentStats, filterAugmentsByRarity, loadAugmentBase } = await import("./data-loader-C6Ea3DLR.js");
      let augmentStats = getChampionAugmentStats(championId);
      if (augmentIds && augmentIds.length > 0) {
        const augmentIdSet = new Set(augmentIds.map((id) => parseInt(id)));
        augmentStats = augmentStats.filter((a) => augmentIdSet.has(a.augmentId));
      }
      return {
        success: true,
        championId,
        augments: augmentStats,
        timestamp: Date.now(),
        dataSource: "local"
      };
    } catch (error) {
      logger.error("Winrate query error:", error);
      return {
        success: false,
        championId,
        augments: [],
        error: error.message
      };
    }
  });
  ipcMain.handle("load-champion-data", async (event, championId) => {
    const { loadChampionStats, loadAugmentBase, loadChampionAugments, loadChampionBuild, loadItems, loadChampionName } = await import("./data-loader-C6Ea3DLR.js");
    try {
      const [stats, augments, augmentStats, build, items, championName] = await Promise.all([
        Promise.resolve(loadChampionStats(championId)),
        Promise.resolve(loadAugmentBase()),
        Promise.resolve(loadChampionAugments(championId)),
        Promise.resolve(loadChampionBuild(championId)),
        Promise.resolve(loadItems()),
        Promise.resolve(loadChampionName(championId))
      ]);
      return {
        success: true,
        data: {
          stats,
          augments,
          augmentStats,
          build,
          items,
          championName
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });
  ipcMain.handle("auto-screenshot-start", async (event, config = {}) => {
    const interval = config.interval || 5e3;
    const success = await autoScreenshotService.start(interval);
    if (success) {
      logger.info("Auto screenshot service started");
    }
    return {
      success,
      config: autoScreenshotService.getConfig()
    };
  });
  ipcMain.handle("auto-screenshot-stop", async (event) => {
    const success = autoScreenshotService.stop();
    if (success) {
      logger.info("Auto screenshot service stopped");
    }
    return {
      success,
      config: autoScreenshotService.getConfig()
    };
  });
  ipcMain.handle("auto-screenshot-set-config", async (event, config) => {
    autoScreenshotService.setConfig(config);
    return autoScreenshotService.getConfig();
  });
  ipcMain.handle("auto-screenshot-get-stats", async (event) => {
    return autoScreenshotService.getPerformanceStats();
  });
  ipcMain.handle("auto-screenshot-get-config", async (event) => {
    return autoScreenshotService.getConfig();
  });
  ipcMain.handle("select-lol-directory", async (event) => {
    const { dialog, BrowserWindow: BrowserWindow2 } = await import("electron");
    const mainWindow2 = getMainWindow();
    try {
      const result = await dialog.showOpenDialog(mainWindow2, {
        properties: ["openDirectory"],
        title: "选择英雄联盟游戏目录",
        message: "请选择英雄联盟的安装目录"
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return {
          success: true,
          path: result.filePaths[0]
        };
      } else {
        return {
          success: false,
          path: null,
          reason: "用户取消了选择"
        };
      }
    } catch (error) {
      logger.error("选择目录出错:", error);
      return {
        success: false,
        path: null,
        error: error.message
      };
    }
  });
  ipcMain.handle("log-renderer-error", async (event, errorData) => {
    const { message, stack, source, line, column, url, type, timestamp, userAgent } = errorData;
    logger.error("渲染进程错误上报:", {
      type: type || "error",
      message: message || "Unknown error",
      stack: stack || "No stack trace",
      source: source || "unknown",
      location: `${line}:${column}`,
      url: url || "unknown",
      timestamp: timestamp || Date.now(),
      userAgent: userAgent || "unknown"
    });
    return { success: true };
  });
  registerLCUIpcHandlers();
  ipcMain.handle("test-database-load", async () => {
    try {
      const path2 = await import("path");
      const { fileURLToPath: fileURLToPath2 } = await import("url");
      const { readFileSync: readFileSync2, existsSync: existsSync2 } = await import("fs");
      const __filename2 = fileURLToPath2(import.meta.url);
      const __dirname2 = path2.dirname(__filename2);
      const possiblePaths = [
        // 相对于当前文件的 data 目录
        path2.join(__dirname2, "..", "data", "augments-base.json"),
        // 相对于当前文件的 data 目录（另一种方式）
        path2.join(__dirname2, "../data", "augments-base.json"),
        // 使用 process.resourcesPath（打包后）
        path2.join(process.resourcesPath || "", "data", "augments-base.json"),
        // 使用 app.getAppPath()
        path2.join((await import("electron")).app.getAppPath(), "data", "augments-base.json"),
        // 使用当前工作目录
        path2.join(process.cwd(), "electron", "data", "augments-base.json"),
        // 绝对路径尝试
        "E:\\ideaProject\\lol_tips_client\\electron\\data\\augments-base.json"
      ];
      const results = [];
      let successPath = null;
      let dataCount = 0;
      for (const testPath of possiblePaths) {
        const exists = existsSync2(testPath);
        results.push({
          path: testPath,
          exists,
          __dirname: __dirname2,
          resourcesPath: process.resourcesPath,
          cwd: process.cwd()
        });
        if (exists && !successPath) {
          try {
            const content = readFileSync2(testPath, "utf-8");
            const data = JSON.parse(content);
            successPath = testPath;
            dataCount = data.length;
          } catch (e) {
            results[results.length - 1].error = e.message;
          }
        }
      }
      return {
        success: !!successPath,
        successPath,
        dataCount,
        __dirname: __dirname2,
        resourcesPath: process.resourcesPath,
        cwd: process.cwd(),
        isDev,
        nodeEnv: process.env.NODE_ENV,
        tests: results
      };
    } catch (error) {
      logger.error("测试数据库加载失败:", error);
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
  });
}
let lcuPollingTimer = null;
async function init() {
  logger.info(`${"=".repeat(50)}`);
  logger.info(`ChampR 应用启动中...`);
  logger.info(`${"=".repeat(50)}`);
  const { Menu } = await import("electron");
  Menu.setApplicationMenu(null);
  registerIpcHandlers(process.env.NODE_ENV === "development");
  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  const devServerUrl = isDev ? process.env.VITE_DEV_SERVER_URL || "http://localhost:5173" : "";
  const mainWindow2 = await createMainWindow(isDev, devServerUrl);
  const popupWindow2 = await createPopupWindow(isDev, devServerUrl);
  const floatingWindow2 = await createFloatingWindow(isDev, devServerUrl);
  logger.info("窗口已创建:", {
    main: !!mainWindow2,
    popup: !!popupWindow2,
    floating: !!floatingWindow2
  });
  logger.info("将在后台初始化游戏流程监控...");
  setTimeout(() => {
    initGameFlowMonitor();
  }, 2e3);
  registerF1Shortcut();
  registerAppEvents();
  return { mainWindow: mainWindow2, popupWindow: popupWindow2, toggleMainWindow };
}
async function autoDetectLolPath() {
  const fs2 = await import("fs");
  await import("path");
  const commonPaths = [
    "C:\\Riot Games\\League of Legends",
    "C:\\Program Files\\League of Legends",
    "D:\\Riot Games\\League of Legends",
    "D:\\Games\\League of Legends",
    "E:\\wegame\\英雄联盟(26)"
    // 用户的路径
  ];
  for (const checkPath of commonPaths) {
    if (fs2.existsSync(checkPath)) {
      logger.info(`自动检测到游戏目录: ${checkPath}`);
      return checkPath;
    }
  }
  return null;
}
async function initGameFlowMonitor() {
  try {
    const Store2 = (await import("electron-store")).default;
    const store2 = new Store2();
    let lolPath = store2.get("lolPath");
    logger.info("============ 初始化游戏流程监控 ============");
    logger.info("读取配置的游戏目录:", lolPath);
    if (!lolPath) {
      logger.info("未设置游戏目录，正在尝试自动检测...");
      lolPath = await autoDetectLolPath();
      if (lolPath) {
        logger.info("自动检测成功，已保存配置");
        store2.set("lolPath", lolPath);
      } else {
        logger.warn("无法自动检测游戏目录");
        logger.info("请在应用设置中配置游戏目录");
        return;
      }
    }
    logger.info("初始化 LCU 服务...");
    const lcuService = getLCUServiceInstance(lolPath);
    logger.info("获取 LCU Token...");
    const authResult = await lcuService.getAuthToken();
    if (!lcuService.isActive()) {
      logger.error("LCU 连接失败！");
      logger.warn("可能的原因:");
      logger.warn("   1. 游戏客户端未运行 - 请启动 League of Legends 客户端");
      logger.warn("   2. LeagueClientUx.log 文件不存在 - 请重启游戏客户端");
      logger.warn("   3. 游戏目录配置错误 - 请在应用设置中检查");
      logger.info("调试步骤:");
      logger.info('   1. 运行: node electron/lcu-debug.js "你的游戏目录"');
      logger.info("   2. 检查输出中是否找到了 LeagueClientUx.log");
      logger.info("   3. 检查日志中是否包含 LCU URL");
      return;
    }
    logger.info("LCU Token 获取成功");
    logger.info("启动游戏阶段轮询...");
    let lastPhase = null;
    let tokenRefreshCounter = 0;
    lcuPollingTimer = setInterval(async () => {
      try {
        tokenRefreshCounter++;
        if (tokenRefreshCounter >= 60) {
          logger.info("定期刷新 LCU token...");
          await lcuService.getAuthToken();
          tokenRefreshCounter = 0;
        }
        const phase = await lcuService.getGameflowPhase();
        if (phase && phase !== lastPhase) {
          lastPhase = phase;
          logger.info(`游戏阶段变化: → ${phase}`);
          notifyAllWindows("game-phase-changed", { phase, prevPhase: null });
          switch (phase) {
            case "GameStart":
              logger.info("游戏开始加载");
              notifyAllWindows("game-started", {});
              break;
            case "InProgress":
              logger.info("游戏进行中 - 启动自动截图来检测海克斯选择");
              notifyAllWindows("game-in-progress", {});
              if (!autoScreenshotService.isRunning) {
                autoScreenshotService.setConfig({
                  interval: 200,
                  maxScreenshots: 100
                });
                autoScreenshotService.start(200).then(() => {
                  logger.info("自动截图服务启动成功");
                });
              }
              break;
            case "WaitingForStats":
              logger.info("游戏已结束");
              notifyAllWindows("game-ended", {});
              if (autoScreenshotService.isRunning) {
                autoScreenshotService.stop();
                logger.info("自动截图服务已停止");
              }
              break;
            case "EndOfGame":
              logger.info("游戏完全结束");
              notifyAllWindows("end-of-game", {});
              break;
          }
        }
      } catch (error) {
        logger.warn("游戏流程轮询出错:", error.message);
      }
    }, 1e3);
    logger.info("游戏流程监控已启动 (每1秒检查一次，每60秒刷新一次token)");
  } catch (error) {
    logger.error("初始化游戏流程监控失败:", error);
  }
}
function registerF1Shortcut(isDev) {
  const f1Ret = globalShortcut.register("F1", async () => {
    logger.info("F1 pressed, capturing screenshot...");
    try {
      const result = await captureScreenshot();
      logger.debug("Screenshot result:", result);
      if (result.success) {
        logger.info(`Screenshot captured: ${result.width}x${result.height}`);
        setImmediate(async () => {
          try {
            const analysisResult = await analyzeScreenshot(result.buffer);
            logger.debug("Analysis result:", analysisResult);
            if (analysisResult.success && analysisResult.analysis.augments.length > 0) {
              const augments = analysisResult.analysis.augments.slice(0, 3);
              const cachedChampionId = store.get("lastSelectedChampionId");
              if (cachedChampionId) {
                logger.info(`使用缓存的英雄ID: ${cachedChampionId}`);
              }
              const winrateData = {
                success: true,
                gamePhase: "augment-select",
                augments: augments.map((aug) => ({
                  id: aug.id,
                  name: aug.name,
                  rarity: aug.rarity,
                  confidence: aug.confidence
                })),
                championId: cachedChampionId || null,
                analysisConfidence: analysisResult.analysis.confidence,
                timestamp: Date.now(),
                dataSource: "local-analysis"
              };
              logger.info("海克斯识别成功:", winrateData);
              notifyAllWindows("augment-detected", winrateData);
            } else {
              logger.info("未识别到海克斯，使用兼容数据");
              const fallbackData = {
                success: true,
                champion: {
                  name: "Unknown",
                  position: "Unknown",
                  winrate: 0
                },
                stats: {
                  winrate: "-",
                  pickRate: "-",
                  banRate: "-"
                },
                runes: [],
                items: [],
                dataSource: "fallback"
              };
              notifyAllWindows("winrate-updated", fallbackData);
            }
          } catch (error) {
            logger.error("Error analyzing screenshot:", error);
          }
        });
      } else {
        logger.error("Screenshot failed:", result.error);
      }
    } catch (error) {
      logger.error("F1 shortcut handler error:", error);
    }
  });
  if (!f1Ret) {
    logger.error("Failed to register F1 shortcut");
  } else {
    logger.info("F1 shortcut registered successfully");
  }
}
function registerAppEvents() {
  app.on("will-quit", async (e) => {
    logger.info("App will quit, cleaning up...");
    if (lcuPollingTimer) {
      clearInterval(lcuPollingTimer);
      logger.info("游戏流程轮询已停止");
    }
    if (autoScreenshotService && autoScreenshotService.isRunning) {
      autoScreenshotService.stop();
      logger.info("自动截图服务已停止");
    }
    await logger.cleanupOldLogs(7);
  });
  app.on("quit", () => {
    logger.info("App quit");
    globalShortcut.unregisterAll();
  });
  app.on("window-all-closed", function() {
    logger.info("All windows closed, quitting app...");
    app.quit();
  });
  app.on("activate", function() {
    if (BrowserWindow$1.getAllWindows().length === 0) {
      (async () => {
        const { createMainWindow: createMainWindow2 } = await Promise.resolve().then(() => windowManager);
        createMainWindow2(process.env.NODE_ENV === "development", "http://localhost:5173");
      })();
    }
  });
}
async function notifyAllWindows(channel, data) {
  const { BrowserWindow: BrowserWindow2 } = await import("electron");
  if (channel === "augment-detected") {
    const floatingWin = getFloatingWindow();
    if (floatingWin && !floatingWin.isDestroyed()) {
      if (!floatingWin.isVisible()) {
        floatingWin.show();
        logger.info("✨ 显示海克斯浮动窗口");
      }
      floatingWin.webContents.send(channel, data);
      return;
    } else {
      logger.warn("⚠️ 浮动窗口不存在或已销毁");
    }
  }
  BrowserWindow2.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  });
}
app.commandLine.appendSwitch("ignore-certificate-errors", "true");
app.commandLine.appendSwitch("ignore-connections-limit", "op.gg");
function setupMainProcessErrorHandling() {
  process.on("unhandledRejection", (reason, promise) => {
    logger.error("主进程未处理的 Promise 拒绝:", reason);
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
  });
  process.on("uncaughtException", (error) => {
    logger.error("主进程未捕获的异常:", error.message, error.stack);
    console.error("Uncaught Exception:", error);
  });
  process.on("warning", (warning) => {
    logger.warn("主进程警告:", warning.message, warning.stack);
    console.warn("Process Warning:", warning);
  });
  logger.info("应用启动 - 主进程错误监听已设置");
}
setupMainProcessErrorHandling();
app.whenReady().then(init);
app.on("window-all-closed", function() {
  logger.info("All windows closed, quitting app...");
  app.quit();
});
app.on("activate", function() {
  if (BrowserWindow.getAllWindows().length === 0) {
    const { createMainWindow: createMainWindow2 } = require2("./modules/window-manager.js");
    createMainWindow2(process.env.NODE_ENV === "development", "http://localhost:5173");
  }
});
export {
  logger as l
};
