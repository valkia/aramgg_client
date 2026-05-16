/**
 * 测试胜率查询功能
 */

import { app, ipcMain } from 'electron'

console.log('=== 测试胜率查询 ===')

app.whenReady().then(async () => {
  try {
    // 导入 data-loader
    const { getChampionAugmentStats } = await import('../../src/main/data-loader.js')

    console.log('\n1. 测试加载英雄63（Brand）的海克斯胜率数据...')
    const augmentStats = getChampionAugmentStats(63)
    console.log('✅ 成功加载，总数:', augmentStats.length)
    console.log('前3条:', augmentStats.slice(0, 3))

    console.log('\n2. 测试过滤特定海克斯ID...')
    const testAugmentIds = [1205, 1103, 1180]
    const augmentIdSet = new Set(testAugmentIds.map(id => parseInt(id)))
    const filtered = augmentStats.filter(a => augmentIdSet.has(a.augmentId))
    console.log('✅ 过滤后的数据:', filtered)

    console.log('\n✅ 胜率查询测试通过！')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ 胜率查询失败:', error.message)
    console.error('错误详情:', error)
    process.exit(1)
  }
})

setTimeout(() => {
  console.error('\n⚠️ 测试超时')
  process.exit(1)
}, 10000)
