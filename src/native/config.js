const Store = window.electronStore || {
  get: () => null,
  set: () => {},
  delete: () => {},
  clear: () => {}
};

const config = {
  get: (key) => {
    if (!Store) {
      console.warn('Store is not available in browser environment');
      return null;
    }
    return Store.get(key);
  },
  set: (key, value) => {
    if (!Store) {
      console.warn('Store is not available in browser environment');
      return;
    }
    return Store.set(key, value);
  },
  delete: (key) => {
    if (!Store) {
      console.warn('Store is not available in browser environment');
      return;
    }
    return Store.delete(key);
  },
  clear: () => {
    if (!Store) {
      console.warn('Store is not available in browser environment');
      return;
    }
    return Store.clear();
  },
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
