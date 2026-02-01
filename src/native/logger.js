// Use require for Node.js modules in Electron renderer
const log = window.require ? window.require('electron-log') : { functions: {} };
const isDev = window.require ? window.require('electron-is-dev') : true;

if (!isDev && log.functions) {
  Object.assign(console, log.functions);
}
