<template>
  <TooltipProvider :delay-duration="0">
    <TooltipRoot v-model:open="open" :disabled="disabled">
      <TooltipTrigger
        as="span"
        :tabindex="disabled ? -1 : 0"
        :aria-label="t('matchAnalysis.assetDescription', { name })"
        class="inline-flex min-w-0 cursor-help rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          side="top"
          :side-offset="8"
          :collision-padding="12"
          hide-when-detached
          class="match-asset-tooltip analysis-panel z-[100] overflow-y-auto p-3 text-xs"
          style="width: min(20rem, calc(100vw - 24px)); max-width: var(--reka-tooltip-content-available-width); max-height: min(24rem, var(--reka-tooltip-content-available-height)); overflow-wrap: anywhere"
        >
          <div class="flex items-start gap-2">
            <img v-if="asset.iconUrl" :src="asset.iconUrl" alt="" class="h-8 w-8 shrink-0 rounded border border-border object-contain" />
            <div class="min-w-0">
              <p class="break-words font-bold" :class="rarityClass">{{ name }}</p>
              <p v-if="kind === 'augment'" class="mt-1" :class="rarityClass">{{ rarityLabel }}</p>
            </div>
          </div>
          <p class="mt-2 whitespace-pre-line break-words leading-relaxed text-muted-foreground">{{ description || t('augment.noDescription') }}</p>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
import type { HextechAramMatchHistoryAsset } from '../../shared/ipc-contract.ts'
import { normalizeTooltipText } from '../service/overlay-formatters.ts'

const props = defineProps<{
  asset: HextechAramMatchHistoryAsset
  kind: 'item' | 'augment'
  disabled?: boolean
}>()
const { t } = useI18n()
const open = ref(false)
const name = computed(() => props.asset.name || t(props.kind === 'item' ? 'matchHistory.itemFallback' : 'matchHistory.augmentFallback', { id: props.asset.id }))
const description = computed(() => normalizeTooltipText(props.asset.description))
const rarities: Record<string, { label: string; color: string }> = {
  kSilver: { label: 'augment.rarities.silver', color: 'text-slate-300' },
  kGold: { label: 'augment.rarities.gold', color: 'text-primary' },
  kPrismatic: { label: 'augment.rarities.prismatic', color: 'text-violet-300' },
}
const rarity = computed(() => props.kind === 'augment' ? rarities[props.asset.rarity || ''] : undefined)
const rarityLabel = computed(() => t(rarity.value?.label || 'matchAnalysis.unknownRarity'))
const rarityClass = computed(() => rarity.value?.color || 'text-foreground')
function close() { open.value = false }

watch(() => [props.asset, props.disabled], close)
watch(open, (visible, _, onCleanup) => {
  if (!visible) return
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
  document.addEventListener('visibilitychange', close)
  onCleanup(() => {
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
    document.removeEventListener('visibilitychange', close)
  })
})
onDeactivated(close)
</script>

<style scoped>
:global(.match-asset-tooltip) { background: var(--lol-panel-raised); border-color: var(--lol-border); box-shadow: var(--lol-shadow); }
</style>
