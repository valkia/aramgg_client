import { l as logger } from "./main.js";
import fs from "fs";
import path from "path";
import { app } from "electron";
const cache = /* @__PURE__ */ new Map();
function getDataPath(filename) {
  if (typeof process !== "undefined" && process.resourcesPath) {
    const resourcePath = path.join(process.resourcesPath, "data", filename);
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }
  }
  let appPath = app.getAppPath();
  if (appPath.endsWith("electron")) {
    appPath = path.dirname(appPath);
  }
  return path.resolve(appPath, "electron", "data", filename);
}
function loadJsonFile(filename) {
  if (cache.has(filename)) {
    return cache.get(filename);
  }
  const filePath = getDataPath(filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);
  cache.set(filename, data);
  return data;
}
function loadChampionStats(championId) {
  const allStats = loadJsonFile("champions-stats.json");
  const stat = allStats.find((s) => s.championId === String(championId));
  if (!stat) {
    throw new Error(`Champion stats not found for ID: ${championId}`);
  }
  return stat;
}
function loadChampionName(championId) {
  const names = loadJsonFile("champions-names-cn.json");
  const champion = names[String(championId)];
  if (!champion) {
    return { nameCN: `英雄 ${championId}`, nameEN: "", title: "" };
  }
  return champion;
}
function loadAugmentBase() {
  return loadJsonFile("augments-base.json");
}
function loadChampionAugments(championId) {
  const championIdStr = String(championId);
  const filename = `champion-augments/${championIdStr}.json`;
  try {
    const allData = loadJsonFile(filename);
    if (Array.isArray(allData) && allData.length > 0) {
      const firstElement = allData[0];
      if (Array.isArray(firstElement) && firstElement.length >= 2) {
        const augmentDataStr = firstElement[1];
        const augmentData = JSON.parse(augmentDataStr);
        return augmentData.augments || {};
      }
    }
    return {};
  } catch (error) {
    logger.warn(`Failed to load augments for champion ${championId}:`, error.message);
    return {};
  }
}
function parseBuildRow(row) {
  return {
    patch: row[0],
    championId: row[1],
    buildTags: row[7] ? JSON.parse(row[7])?.primary_tags_f3pie || "" : "",
    coreItems: row[8] ? JSON.parse(row[8]) : [],
    situationalItems: row[10] ? JSON.parse(row[10]) : [],
    startingItems: row[11] ? JSON.parse(row[11]) : [],
    games: parseInt(row[12]) || 0,
    wins: parseInt(row[13]) || 0,
    pickRate: parseFloat(row[14]) || 0,
    winRate: parseFloat(row[15]) || 0
  };
}
function loadChampionBuild(championId) {
  const championIdStr = String(championId);
  const filename = `builds_aram/${championIdStr}.json`;
  try {
    const buildData = loadJsonFile(filename);
    if (buildData.data && buildData.data.result && buildData.data.result.dataArray) {
      const rows = buildData.data.result.dataArray;
      if (rows.length > 0) {
        const builds = rows.map(parseBuildRow).sort((a, b) => b.games - a.games);
        return {
          ...builds[0],
          recommended: builds[0].coreItems,
          allBuilds: builds
        };
      }
    }
    return null;
  } catch (error) {
    logger.warn(`Failed to load build for champion ${championId}:`, error.message);
    return null;
  }
}
function loadItems() {
  return loadJsonFile("items-i18n.json");
}
function getChampionAugmentStats(championId) {
  const championIdStr = String(championId);
  const augments = loadChampionAugments(championIdStr);
  const augmentBase = loadAugmentBase();
  const augmentStats = Object.entries(augments).map(([augmentId, data]) => {
    const baseInfo = augmentBase.find((a) => a.id === parseInt(augmentId));
    return {
      augmentId: parseInt(augmentId),
      name: baseInfo?.name || "未知",
      rarity: baseInfo?.rarity || "unknown",
      iconUrl: baseInfo?.iconUrl || null,
      winRate: parseFloat(data.win_rate) || 0,
      pickRate: parseFloat(data.pick_rate) || 0,
      playCount: parseInt(data.num_games) || 0,
      winCount: parseInt(data.num_win_games) || 0,
      // 推荐指数 = 胜率 * 0.6 + 选择率 * 0.2 + min(场次/1000, 1) * 0.2
      recommendScore: parseFloat(data.win_rate) * 0.6 + parseFloat(data.pick_rate) * 0.2 + Math.min(parseInt(data.num_games) / 1e3, 1) * 0.2
    };
  }).sort((a, b) => b.recommendScore - a.recommendScore);
  return augmentStats;
}
function filterAugmentsByRarity(augmentStats, rarity) {
  if (!rarity || rarity === "all") {
    return augmentStats;
  }
  return augmentStats.filter((a) => a.rarity === rarity);
}
export {
  filterAugmentsByRarity,
  getChampionAugmentStats,
  loadAugmentBase,
  loadChampionAugments,
  loadChampionBuild,
  loadChampionName,
  loadChampionStats,
  loadItems
};
