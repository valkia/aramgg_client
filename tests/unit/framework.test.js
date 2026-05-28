// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'

describe('unit test framework', () => {
  it('mounts Vue components in a DOM-like environment', () => {
    const Component = defineComponent({
      props: {
        label: {
          type: String,
          required: true,
        },
      },
      template: '<button type="button">{{ label }}</button>',
    })

    const wrapper = mount(Component, {
      props: {
        label: 'ready',
      },
    })

    expect(wrapper.get('button').text()).toBe('ready')
  })
})
