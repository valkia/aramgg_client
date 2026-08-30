import { afterEach, describe, expect, it, vi } from 'vitest'

describe('augment match prefilter', () => {
  afterEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('skips fuzzy work for entries that cannot plausibly match the OCR text', async () => {
    vi.doMock('../../src/main/data-loader.ts', () => ({
      DEFAULT_DATA_LOCALE: 'zh-CN',
      SUPPORTED_DATA_LOCALES: [{ code: 'zh-CN' }],
      getDataLocale: () => 'zh-CN',
      loadAugmentBaseForOcrLocale: vi.fn(),
      tryNormalizeDataLocale: () => null,
    }))
    vi.doMock('../../src/main/services/lcu/process-auth-discovery.ts', () => ({
      discoverLcuAuthFromProcess: vi.fn(async () => [null, null]),
    }))

    const { prefilterAugmentMatchEntries } = await import('../../src/main/image-analyzer.ts')
    const entries = [
      { normalizedName: '永治观' },
      { normalizedName: '台风帽' },
      { normalizedName: '攻' },
      { normalizedName: '超长名称超过当前文本长度' },
      { normalizedName: '永冠王' },
    ]

    const result = prefilterAugmentMatchEntries(entries, '永治观 66 16/6/8')

    expect(result.map(entry => entry.normalizedName)).toEqual(['永治观', '永冠王'])
  })
})
