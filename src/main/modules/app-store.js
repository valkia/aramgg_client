import Store from 'electron-store'
import { getConfigDir } from './app-paths.js'

const store = new Store({ cwd: getConfigDir() })

export default store
