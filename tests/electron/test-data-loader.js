/**
 * 测试数据加载器
 * 用于验证数据文件路径是否正确
 */

import { app } from 'electron'
import { loadChampionStats, loadAugmentBase, getChampionAugmentStats } from '../../src/main/data-loader.js'

console.log('=== 测试数据加载器 ===')
console.log('App path:', app.getAppPath())

// 等待 app ready
app.whenReady().then(async () => {
  try {
    console.log('\n1. 测试加载英雄统计数据...')
    const championStats = await loadChampionStats(63) // Brand
    console.log('✅ 成功加载英雄统计数据:', championStats)

    console.log('\n2. 测试加载海克斯基础数据...')
    const augmentBase = await loadAugmentBase()
    console.log('✅ 成功加载海克斯基础数据，总数:', Object.keys(augmentBase).length)

    console.log('\n3. 测试加载英雄海克斯胜率数据...')
    const augmentStats = await getChampionAugmentStats(63)
    console.log('✅ 成功加载英雄海克斯胜率数据，总数:', augmentStats.length)
    console.log('前3条数据:', augmentStats.slice(0, 3))

    console.log('\n✅ 所有数据加载测试通过！')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ 数据加载失败:', error.message)
    console.error('错误详情:', error)
    process.exit(1)
  }
})

// 超时保护
setTimeout(() => {
  console.error('\n⚠️ 测试超时')
  process.exit(1)
}, 10000)
