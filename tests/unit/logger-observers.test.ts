import { describe, expect, it, vi } from 'vitest'
import logger, { subscribeLogEvents } from '../../src/main/modules/logger.ts'

vi.mock('../../src/main/modules/app-paths.ts', () => ({ getLogDir: () => { throw new Error('Unexpected normal log write') } }))

describe('diagnostic log observers', () => {
  it('delivers DEBUG before normal filtering and isolates failing observers', () => {
    const observer = vi.fn()
    const removeFailing = subscribeLogEvents(() => { throw new Error('observer failed') })
    const remove = subscribeLogEvents(observer)
    try {
      expect(() => logger.debug('Augment full detection diagnostics', { currentIds: [3, 1, 2] })).not.toThrow()
      expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        level: 'DEBUG', message: 'Augment full detection diagnostics', args: [{ currentIds: [3, 1, 2] }],
      }))
      remove()
      logger.debug('after unsubscribe')
      expect(observer).toHaveBeenCalledOnce()
    } finally { remove(); removeFailing() }
  })
})
