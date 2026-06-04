const getElectronAPI = () => window.electronAPI

export const hasElectronAPI = () => !!getElectronAPI()

export const requireElectronAPI = () => {
  const api = getElectronAPI()
  if (!api) {
    throw new Error('Electron API is not available')
  }
  return api
}

export const electronAPI = {
  store: {
    get: (...args) => requireElectronAPI().store.get(...args),
    set: (...args) => requireElectronAPI().store.set(...args),
    delete: (...args) => requireElectronAPI().store.delete(...args),
  },
  windows: {
    showPopup: (...args) => requireElectronAPI().windows.showPopup(...args),
    hidePopup: (...args) => requireElectronAPI().windows.hidePopup(...args),
    hideFloating: (...args) => requireElectronAPI().windows.hideFloating(...args),
    toggleMain: (...args) => requireElectronAPI().windows.toggleMain(...args),
    confirmQuit: (...args) => requireElectronAPI().windows.confirmQuit(...args),
    restart: (...args) => requireElectronAPI().windows.restart(...args),
  },
  appInfo: {
    getVersionInfo: (...args) => requireElectronAPI().appInfo.getVersionInfo(...args),
  },
  analytics: {
    getStatus: (...args) => requireElectronAPI().analytics.getStatus(...args),
    setEnabled: (...args) => requireElectronAPI().analytics.setEnabled(...args),
    track: (...args) => requireElectronAPI().analytics.track(...args),
  },
  screenshot: {
    capture: (...args) => requireElectronAPI().screenshot.capture(...args),
    analyze: (...args) => requireElectronAPI().screenshot.analyze(...args),
  },
  winrate: {
    get: (...args) => requireElectronAPI().winrate.get(...args),
    loadChampionData: (...args) => requireElectronAPI().winrate.loadChampionData(...args),
  },
  autoScreenshot: {
    start: (...args) => requireElectronAPI().autoScreenshot.start(...args),
    stop: (...args) => requireElectronAPI().autoScreenshot.stop(...args),
    setConfig: (...args) => requireElectronAPI().autoScreenshot.setConfig(...args),
    getStats: (...args) => requireElectronAPI().autoScreenshot.getStats(...args),
    getConfig: (...args) => requireElectronAPI().autoScreenshot.getConfig(...args),
  },
  dialogs: {
    selectLolDirectory: (...args) => requireElectronAPI().dialogs.selectLolDirectory(...args),
    validateLolDirectory: (...args) => requireElectronAPI().dialogs.validateLolDirectory(...args),
  },
  itemSets: {
    getAramStatus: (...args) => requireElectronAPI().itemSets.getAramStatus(...args),
    installAramChampion: (...args) => requireElectronAPI().itemSets.installAramChampion(...args),
  },
  lcu: {
    getChampionId: (...args) => requireElectronAPI().lcu.getChampionId(...args),
    getStatus: (...args) => requireElectronAPI().lcu.getStatus(...args),
    getCurrentSession: (...args) => requireElectronAPI().lcu.getCurrentSession(...args),
    getChampSelectSnapshot: (...args) => requireElectronAPI().lcu.getChampSelectSnapshot(...args),
    getAramBenchRecommendation: (...args) =>
      requireElectronAPI().lcu.getAramBenchRecommendation(...args),
    getPerkList: (...args) => requireElectronAPI().lcu.getPerkList(...args),
    applyPerk: (...args) => requireElectronAPI().lcu.applyPerk(...args),
    getGameflowPhase: (...args) => requireElectronAPI().lcu.getGameflowPhase(...args),
  },
  diagnostics: {
    testShowFloating: (...args) => requireElectronAPI().diagnostics.testShowFloating(...args),
    testShowRandomFloating: (...args) =>
      requireElectronAPI().diagnostics.testShowRandomFloating(...args),
    testShowRandomPopup: (...args) =>
      requireElectronAPI().diagnostics.testShowRandomPopup(...args),
    testShowBenchRecommendation: (...args) =>
      requireElectronAPI().diagnostics.testShowBenchRecommendation(...args),
    logRendererError: (...args) => requireElectronAPI().diagnostics.logRendererError(...args),
    logRendererInfo: (...args) => requireElectronAPI().diagnostics.logRendererInfo(...args),
    testDatabaseLoad: (...args) => requireElectronAPI().diagnostics.testDatabaseLoad(...args),
  },
  shell: {
    openExternal: (...args) => requireElectronAPI().shell.openExternal(...args),
  },
  events: {
    on: (...args) => requireElectronAPI().events.on(...args),
    once: (...args) => requireElectronAPI().events.once(...args),
  },
}
