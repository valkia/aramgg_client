import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('feedback widget morph animation', () => {
  it('keeps the original morph and reduced-motion boundaries', () => {
    const component = readFileSync('src/renderer/components/FeedbackWidget.vue', 'utf8')
    const styles = readFileSync('src/renderer/styles/feedback-widget.css', 'utf8')

    expect(component).toContain('compressFeedbackImage')
    expect(component).toContain("electronAPI.feedback.submit")
    expect(styles).toContain('--morph-open-dur: 350ms')
    expect(styles).toContain('translateX(var(--morph-slide)) scale(var(--morph-scale))')
    expect(styles).toContain(".feedback-morph[data-open='true']")
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
