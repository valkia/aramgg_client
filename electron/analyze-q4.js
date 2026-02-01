import path from 'path'
import os from 'os'
import { analyzeScreenshot } from './image-analyzer.js'

const q4Path = path.join(os.homedir(), '.lol-tips-client', 'screenshots', 'q4.png')
console.log('🔍 分析q4.png（未被检测的真实海克斯截图）\n')

const result = await analyzeScreenshot(q4Path)
console.log('\n✅ 分析完成')
