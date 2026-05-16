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
    clear: (...args) => requireElectronAPI().store.clear(...args),
  },
  windows: {
    showPopup: (...args) => requireElectronAPI().windows.showPopup(...args),
    hidePopup: (...args) => requireElectronAPI().windows.hidePopup(...args),
    hideFloating: (...args) => requireElectronAPI().windows.hideFloating(...args),
    toggleMain: (...args) => requireElectronAPI().windows.toggleMain(...args),
    restart: (...args) => requireElectronAPI().windows.restart(...args),
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
  },
  lcu: {
    getChampionId: (...args) => requireElectronAPI().lcu.getChampionId(...args),
    getStatus: (...args) => requireElectronAPI().lcu.getStatus(...args),
    getCurrentSession: (...args) => requireElectronAPI().lcu.getCurrentSession(...args),
    getPerkList: (...args) => requireElectronAPI().lcu.getPerkList(...args),
    applyPerk: (...args) => requireElectronAPI().lcu.applyPerk(...args),
    getGameflowPhase: (...args) => requireElectronAPI().lcu.getGameflowPhase(...args),
  },
  diagnostics: {
    testShowFloating: (...args) => requireElectronAPI().diagnostics.testShowFloating(...args),
    logRendererError: (...args) => requireElectronAPI().diagnostics.logRendererError(...args),
    testDatabaseLoad: (...args) => requireElectronAPI().diagnostics.testDatabaseLoad(...args),
  },
  events: {
    on: (...args) => requireElectronAPI().events.on(...args),
    once: (...args) => requireElectronAPI().events.once(...args),
  },
}
