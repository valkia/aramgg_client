import log from './logger.js'

const storageKey = (key) => `lol-tips:${key}`

const readValue = (key) => {
  const rawValue = localStorage.getItem(storageKey(key))
  if (rawValue == null) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return rawValue
  }
}

const writeValue = (key, value) => {
  localStorage.setItem(storageKey(key), JSON.stringify(value))
}

const config = {
  get: (key) => {
    try {
      return readValue(key)
    } catch (error) {
      log.warn(`读取配置失败: ${key}`, error)
      return null
    }
  },
  set: (key, value) => {
    try {
      writeValue(key, value)
    } catch (error) {
      log.warn(`写入配置失败: ${key}`, error)
    }
  },
  delete: (key) => {
    localStorage.removeItem(storageKey(key))
  },
  clear: () => {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('lol-tips:'))
      .forEach((key) => localStorage.removeItem(key))
  },
  defaults: {
    userId: '',
    lolVer: '',
    appLang: 'zh-CN',
    keepOldItems: true,
    selectedSources: [],
    ignoreSystemScale: false,
  },
}

export default config
