<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3 text-[var(--lol-text)]" data-testid="in-game-guide">
    <header class="flex items-center gap-3 border-b border-[var(--lol-border-soft)] pb-2">
      <img :src="getChampionSquareIconUrl(championId)" :alt="championName" class="h-8 w-8 shrink-0 rounded border border-[var(--lol-border-soft)]" />
      <div class="min-w-0">
        <h2 class="m-0 text-base font-bold text-[var(--lol-gold-2)]">{{ championName || t('augment.championFallback', { id: championId }) }}</h2>
        <p class="m-0 text-xs text-[var(--lol-muted)]">{{ route?.title || t('inGameGuide.title') }}</p>
      </div>
    </header>
    <p v-if="loading" class="text-xs text-[var(--lol-muted)]">{{ t('augment.loadingChampion') }}</p>
    <template v-else>
      <section>
        <h3 class="mb-2 mt-0 text-xs font-bold text-[var(--lol-gold-2)]">{{ t('inGameGuide.core') }}</h3>
        <div v-if="core.length" class="grid grid-cols-3 gap-2">
          <div v-for="id in core" :key="id" class="flex min-w-0 items-center gap-1">
            <img :src="itemIcon(id)" :alt="itemName(id)" class="h-8 w-8 shrink-0 rounded border border-[var(--lol-border-soft)]" />
            <span class="line-clamp-2 text-[11px] leading-4">{{ itemName(id) }}</span>
          </div>
        </div>
        <p v-else class="m-0 text-xs text-[var(--lol-muted)]">{{ t('augment.noBuilds') }}</p>
      </section>
      <section v-if="later.length">
        <h3 class="mb-2 mt-0 text-xs font-bold text-[var(--lol-gold-2)]">{{ t('augment.laterItems') }}</h3>
        <div class="grid grid-cols-3 gap-2">
          <div v-for="id in later" :key="id" class="flex min-w-0 items-center gap-1">
            <img :src="itemIcon(id)" :alt="itemName(id)" class="h-8 w-8 shrink-0 rounded border border-[var(--lol-border-soft)]" />
            <span class="line-clamp-2 text-[11px] leading-4">{{ itemName(id) }}</span>
          </div>
        </div>
      </section>
      <section v-if="skills.length" class="border-y border-[var(--lol-border-soft)] py-2">
        <div class="mb-2 flex items-center justify-between gap-2 text-xs">
          <h3 class="m-0 font-bold text-[var(--lol-gold-2)]">{{ t('augment.skillOrder') }}</h3>
          <strong>{{ priority }}</strong>
        </div>
        <div class="flex items-center gap-1">
          <span class="mr-1 text-[11px] text-[var(--lol-muted)]">{{ t('inGameGuide.firstLevels') }}</span>
          <span v-for="(skill, index) in skills.slice(0, 6)" :key="index" class="flex h-6 w-6 items-center justify-center rounded bg-white/10 text-xs font-bold">{{ getSkillKey(skill) }}</span>
        </div>
      </section>
      <section class="min-h-0">
        <h3 class="mb-2 mt-0 text-xs font-bold text-[var(--lol-gold-2)]">{{ t('inGameGuide.augments') }}</h3>
        <div v-for="group in groups" :key="group.rarity" class="mb-2 flex items-start gap-2 text-[11px] leading-4">
          <span class="w-14 shrink-0 text-[var(--lol-muted)]">{{ t(`augment.rarities.${group.label}`) }}</span>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span v-for="augment in group.rows" :key="augment.augmentId || augment.id" class="flex items-center gap-2">
              <img v-if="augment.iconPath" :src="getAugmentIconUrl(augment.iconPath)" alt="" class="h-5 w-5 shrink-0" />
              <span class="truncate">{{ augment.name }}</span>
            </span>
            <span v-if="!group.rows.length" class="text-[var(--lol-muted)]">—</span>
          </div>
        </div>
      </section>
      <p class="mb-0 mt-auto text-[10px] leading-4 text-[var(--lol-muted)]">{{ t('inGameGuide.note') }}</p>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAugmentIconUrl, getChampionSquareIconUrl } from '../service/cdn'
import { getSkillKey, getSkillPriority } from '../service/champion-build-routes.js'

const props = defineProps({
  championId: Number,
  championName: String,
  route: Object,
  augments: { type: Array, default: () => [] },
  loading: Boolean,
  itemName: { type: Function, required: true },
  itemIcon: { type: Function, required: true },
})
const { t } = useI18n()
// Each core record is one complete combination; do not mix competing builds.
const core = computed(() => (props.route?.coreItems?.[0]?.items || props.route?.fullItems?.[0]?.items || []).slice(0, 3))
const later = computed(() => (props.route?.itemExtensions || []).map(item => item.itemId).filter(id => !core.value.includes(id)).slice(0, 3))
const skills = computed(() => props.route?.skillOrders?.[0]?.skillOrder || [])
const priority = computed(() => {
  const [primary, secondary, tertiary] = getSkillPriority(skills.value)
  return t('augment.skillPriority', { primary, secondary, tertiary })
})
const groups = computed(() => [{ rarity: 'kSilver', label: 'silver' }, { rarity: 'kGold', label: 'gold' }, { rarity: 'kPrismatic', label: 'prismatic' }].map(({ rarity, label }) => ({
  rarity, label, rows: props.augments.filter(augment => augment.rarity === rarity).slice(0, 2),
})))
</script>
