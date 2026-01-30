"use strict";
const { ipcRenderer, shell } = require("electron");
const fs = require("fs");
const fse = require("fs-extra");
const cheerio = require("cheerio");
const PromisePool = require("es6-promise-pool").default || require("es6-promise-pool");
window.electron = {
  shell
};
window.require = require;
window.fs = fs;
window.fse = fse;
window.cheerio = cheerio;
window.PromisePool = PromisePool;
window.electronStore = {
  get: (key) => ipcRenderer.invoke("store-get", key),
  set: (key, value) => ipcRenderer.invoke("store-set", key, value),
  delete: (key) => ipcRenderer.invoke("store-delete", key),
  clear: () => ipcRenderer.invoke("store-clear")
};
window.ipcRenderer = {
  send: (channel, data) => {
    let validChannels = ["toMain", "show-popup", "hide-popup", "toggle-main-window", "restart-app", "broadcast"];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    let validChannels = ["fromMain", "for-popup", "screenshot-taken", "winrate-updated", "auto-screenshot-taken"];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  once: (channel, func) => {
    let validChannels = ["fromMain", "for-popup", "screenshot-taken", "winrate-updated", "auto-screenshot-taken"];
    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => func(...args));
    }
  },
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args);
  }
};
window.ipc = window.ipcRenderer;
