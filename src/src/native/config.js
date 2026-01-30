const Store = window.electronStore;

const config = {
  get: (key) => Store.get(key),
  set: (key, value) => Store.set(key, value),
  delete: (key) => Store.delete(key),
  clear: () => Store.clear(),
  defaults: {
    userId: '',
    lolDir: '',
    lolVer: '',
    appLang: 'zh-CN',
    keepOldItems: true,
    selectedSources: [],
    ignoreSystemScale: false,
  },
};

export default config;
