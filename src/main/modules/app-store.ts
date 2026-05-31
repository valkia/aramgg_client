// @ts-nocheck
import Store from 'electron-store'
import { getConfigDir } from './app-paths.ts'

const store = new Store({ cwd: getConfigDir() })

export default store
