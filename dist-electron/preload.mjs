import { shell, ipcRenderer } from "electron";
import fs$1 from "fs";
import fs from "fs-extra";
import * as cheerio from "cheerio";
import PromisePool from "es6-promise-pool";
import path from "path";
import os from "os";
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
logger.info("Preload script loaded successfully");
window.electron = {
  shell
};
window.require = require;
window.fs = fs$1;
window.fse = fs;
window.cheerio = cheerio;
window.PromisePool = PromisePool;
window.electronStore = {
  get: (key) => ipcRenderer.invoke("store-get", key),
  set: (key, value) => ipcRenderer.invoke("store-set", key, value),
  delete: (key) => ipcRenderer.invoke("store-delete", key),
  clear: () => ipcRenderer.invoke("store-clear")
};
logger.info("window.electronStore exposed");
window.ipcRenderer = {
  send: (channel, data) => {
    let validChannels = ["toMain", "show-popup", "hide-popup", "hide-floating", "toggle-main-window", "restart-app", "broadcast"];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    let validChannels = [
      "fromMain",
      "for-popup",
      "screenshot-taken",
      "winrate-updated",
      "auto-screenshot-taken",
      "game-phase-changed",
      "game-started",
      "game-in-progress",
      "augment-detection-started",
      "augment-detected",
      "game-ended",
      "end-of-game"
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  once: (channel, func) => {
    let validChannels = [
      "fromMain",
      "for-popup",
      "screenshot-taken",
      "winrate-updated",
      "auto-screenshot-taken",
      "game-phase-changed",
      "game-started",
      "game-in-progress",
      "augment-detection-started",
      "augment-detected",
      "game-ended",
      "end-of-game"
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => func(...args));
    }
  },
  invoke: (channel, ...args) => {
    logger.info("ipcRenderer.invoke called:", channel, args);
    const validChannels = [
      "store-get",
      "store-set",
      "store-delete",
      "store-clear",
      "screenshot-capture",
      "analyze-screenshot",
      "get-winrate",
      "load-champion-data",
      "auto-screenshot-start",
      "auto-screenshot-stop",
      "auto-screenshot-set-config",
      "auto-screenshot-get-stats",
      "auto-screenshot-get-config",
      "select-lol-directory",
      "get-champion-id",
      "test-show-floating",
      "log-renderer-error"
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Invalid channel: ${channel}`));
  }
};
logger.info("window.ipcRenderer exposed");
window.ipc = window.ipcRenderer;
logger.info("Preload script initialization complete");
