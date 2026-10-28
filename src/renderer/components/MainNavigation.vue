<template>
  <div class="main-navigation">
    <div class="section-tabs" role="tablist" :aria-label="t('mainNavigation.label')">
      <button
        v-for="(section, index) in sections" :id="`main-tab-${section.id}`" :key="section.id"
        type="button" role="tab" :aria-selected="modelValue === section.id"
        :aria-controls="`main-panel-${section.id}`" :tabindex="modelValue === section.id ? 0 : -1"
        @click="emit('update:modelValue', section.id)" @keydown="navigate($event, index)"
      >
        <component :is="section.icon" aria-hidden="true" />
        <span>{{ t(`mainNavigation.${section.id}`) }}</span>
      </button>
    </div>
    <div class="connection-status" :data-connection="state.connection" role="status" aria-live="polite" aria-atomic="true">
      <div class="connection-heading">
        <span class="connection-dot" aria-hidden="true"></span>
        <span>{{ t('mainNavigation.client') }}</span>
        <strong>{{ t(`mainNavigation.${state.connection}`) }}</strong>
        <span v-if="state.connection === 'connected'" class="connection-phase">
          {{ t(`mainNavigation.phase${state.phase || 'Unknown'}`) }}
        </span>
      </div>
      <p v-if="state.connection !== 'connected'">{{ connectionHint }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { History, Settings, Trophy } from 'lucide-vue-next'
import { useLcuConnectionState } from '../composables/use-lcu-connection-state.ts'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [section: string] }>()
const { t } = useI18n()
const state = useLcuConnectionState()
const sections = [
  { id: 'history', icon: History }, { id: 'champions', icon: Trophy }, { id: 'settings', icon: Settings },
]
const connectionHint = computed(() => t(`mainNavigation.${state.value.connection === 'disconnected'
  ? 'offline' : state.value.connection === 'checking' ? 'checkingHint' : 'unavailableHint'}`))

function navigate(event: KeyboardEvent, index: number) {
  const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!offset && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
    : (index + offset + sections.length) % sections.length
  const section = sections[next]!
  if (props.modelValue !== section.id) emit('update:modelValue', section.id)
  const tablist = (event.currentTarget as HTMLElement).parentElement
  tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
</script>

<style scoped>
.main-navigation { position: relative; z-index: 1; flex: 0 0 auto; border-bottom: 1px solid var(--lol-border-soft); background: var(--lol-surface); }
.section-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 8px 12px 0; }
.section-tabs button { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 38px; padding: 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--lol-muted); font-size: 12px; cursor: pointer; }
.section-tabs button svg { width: 15px; height: 15px; flex: 0 0 auto; }
.section-tabs button:hover { color: var(--lol-ivory); background: var(--lol-surface-2); }
.section-tabs button[aria-selected='true'] { color: var(--lol-gold-2); border-color: var(--lol-border-soft); background: var(--lol-surface-2); }
.section-tabs button:focus-visible { outline: 2px solid var(--lol-gold-2); outline-offset: 2px; }
.connection-status { padding: 9px 16px 10px; color: var(--lol-muted); font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
.connection-heading { display: flex; align-items: center; flex-wrap: wrap; column-gap: 7px; row-gap: 2px; }
.connection-heading strong { color: var(--lol-ivory); font-weight: 600; }
.connection-phase { margin-left: auto; color: var(--lol-gold-2); }
.connection-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--lol-muted); }
[data-connection='connected'] .connection-dot { background: var(--lol-success); }
.connection-status p { margin: 3px 0 0 13px; }
</style>
