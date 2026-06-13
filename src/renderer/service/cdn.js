/**
 * Get the champion loading screen image URL
 * @param {string|number} championId - Champion ID
 * @returns {string} Champion image URL
 */
export function getChampionIconUrl(championId) {
  if (/^https?:\/\//i.test(String(championId))) {
    return championId;
  }

  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championId}_0.jpg`;
}

/**
 * Get champion square (portrait) image URL
 * @param {string|number} championId - Champion ID
 * @returns {string} Champion portrait URL
 */
export function getChampionPortraitUrl(championId) {
  return `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${championId}.png`;
}

/**
 * Get champion square icon from Community Dragon by numeric champion ID
 * @param {string|number} championId - Champion ID
 * @returns {string} Champion square icon URL
 */
export function getChampionSquareIconUrl(championId) {
  if (/^https?:\/\//i.test(String(championId))) {
    return championId;
  }

  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`;
}

/**
 * Get item icon URL
 * @param {string|number} itemId - Item ID
 * @returns {string} Item icon URL
 */
export function getItemIconUrl(itemId) {
  if (/^https?:\/\//i.test(String(itemId))) {
    return itemId;
  }

  return `https://cdn.dtodo.cn/hextech/item-icons/${itemId}.png`;
}

/**
 * Get augment icon URL from Community Dragon CDN
 * @param {string} iconPath - Icon path from augment data
 * @returns {string} Augment icon URL
 */
export function getAugmentIconUrl(iconPath) {
  if (!iconPath) {
    return '';
  }

  if (/^https?:\/\//i.test(iconPath)) {
    return iconPath;
  }

  // Community Dragon CDN base URL
  const baseUrl = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';

  // Clean up and normalize the path
  const cleanPath = iconPath.toLowerCase().replace(/\\/g, '/');

  return `${baseUrl}/${cleanPath}`;
}

/**
 * Get spell icon URL
 * @param {string|number} spellId - Spell ID
 * @returns {string} Spell icon URL
 */
export function getSpellIconUrl(spellId) {
  return `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/spell/${spellId}.png`;
}
