import path from 'path'
import os from 'os'
import { analyzeScreenshot } from './image-analyzer.js'
import logger from './modules/logger.js'

const q4Path = path.join(os.homedir(), '.lol-tips-client', 'screenshots', 'q4.png')
logger.info('🔍 分析q4.png（未被检测的真实海克斯截图）\n')

const result = await analyzeScreenshot(q4Path)
logger.info('\n✅ 分析完成')
