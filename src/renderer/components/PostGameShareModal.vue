<template>
  <div class="post-share-overlay" @click.self="emit('close')">
    <section class="post-share-modal" role="dialog" aria-modal="true" aria-labelledby="post-share-title">
      <header class="post-share-header">
        <div>
          <p class="post-share-kicker">{{ t('postGame.kicker') }}</p>
          <h2 id="post-share-title">{{ t('postGame.title') }}</h2>
        </div>
        <button class="post-share-icon-button" type="button" :title="t('common.close')" @click="emit('close')">
          <X class="post-share-icon" />
        </button>
      </header>

      <div class="post-share-preview">
        <canvas
          ref="canvasRef"
          class="post-share-canvas"
          :width="POSTER_WIDTH"
          :height="POSTER_HEIGHT"
        ></canvas>
      </div>

      <div class="post-share-actions">
        <button
          class="post-share-action"
          type="button"
          :title="t('postGame.copyTitle')"
          :disabled="actionPending"
          @click="copyPoster"
        >
          <Copy class="post-share-action-icon" />
          <span>{{ t('postGame.copy') }}</span>
        </button>
        <button
          class="post-share-action accent"
          type="button"
          :title="t('postGame.saveTitle')"
          :disabled="actionPending"
          @click="savePoster"
        >
          <Download class="post-share-action-icon" />
          <span>{{ t('postGame.save') }}</span>
        </button>
      </div>
    </section>

    <Transition name="post-share-toast">
      <div v-if="toast.visible" class="post-share-toast" :class="toast.type" role="status">
        <CheckCircle2 v-if="toast.type === 'success'" class="post-share-toast-icon" />
        <CircleAlert v-else class="post-share-toast-icon" />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CheckCircle2, CircleAlert, Copy, Download, X } from 'lucide-vue-next'
import { electronAPI } from '../native/electron-api.ts'
import { trackAnalyticsEvent } from '../services/analytics.ts'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  poster: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close'])
const { t, locale } = useI18n()

const POSTER_WIDTH = 750
const POSTER_HEIGHT = 1334
const FONT_FAMILY = '"Microsoft YaHei", "Segoe UI", Arial, sans-serif'

const canvasRef = ref(null)
const actionPending = ref(false)
const toast = ref({
  visible: false,
  message: '',
  type: 'success',
})
let drawToken = 0
let toastTimer = null

const resultLabel = computed(() => {
  if (props.poster?.result === 'victory') return t('postGame.victory')
  if (props.poster?.result === 'defeat') return t('postGame.defeat')
  return t('postGame.result')
})

const resultColor = computed(() => {
  if (props.poster?.result === 'victory') return '#35d6b2'
  if (props.poster?.result === 'defeat') return '#ff6b6b'
  return '#e2c08f'
})

function buildChampionDisplayName(champion) {
  const name = String(champion?.name || '').trim()
  const title = String(champion?.title || '').trim()

  if (!name && !title) return t('postGame.championFallback')
  if (!name) return title
  if (!title || title === name || title.includes(name)) return name
  return `${title} ${name}`
}

const championName = computed(() => buildChampionDisplayName(props.poster?.champion))

function hasPosterStats(poster) {
  const stats = poster?.stats
  if (!stats) return false

  return [stats.kills, stats.deaths, stats.assists].every((value) => {
    if (value == null) return false
    if (typeof value === 'string' && !value.trim()) return false
    return Number.isFinite(Number(value))
  })
}

function getPosterAnalyticsParams(extra = {}) {
  const poster = props.poster || {}
  return {
    status: poster.status || 'unknown',
    result: poster.result || 'unknown',
    champion_id: poster.champion?.id ?? null,
    augment_count: Array.isArray(poster.augments) ? poster.augments.length : 0,
    has_stats: hasPosterStats(poster),
    ...extra,
  }
}

function trackPostGameShareEvent(name, params = {}) {
  try {
    trackAnalyticsEvent(name, getPosterAnalyticsParams(params))
  } catch (error) {
    console.warn('Failed to track post-game share event:', error)
  }
}

function safeNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function formatLargeNumber(value) {
  const numberValue = safeNumber(value)
  if (numberValue == null) return '-'
  if (Math.abs(numberValue) >= 1000) {
    return `${(numberValue / 1000).toFixed(numberValue >= 10000 ? 1 : 2).replace(/\.0+$/, '')}K`
  }
  return String(Math.round(numberValue))
}

function formatKdaValue(value) {
  const numberValue = safeNumber(value)
  if (numberValue == null) return '-'
  return numberValue.toFixed(2)
}

function formatDuration(seconds) {
  const numberValue = safeNumber(seconds)
  if (numberValue == null || numberValue <= 0) return 'ARAM'
  const minutes = Math.floor(numberValue / 60)
  const rest = Math.round(numberValue % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function getKdaParts() {
  const stats = props.poster?.stats || {}
  return [
    safeNumber(stats.kills),
    safeNumber(stats.deaths),
    safeNumber(stats.assists),
  ].map((value) => value == null ? '-' : String(Math.round(value)))
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
  drawRoundedRect(ctx, x, y, width, height, radius)
  ctx.fillStyle = fillStyle
  ctx.fill()
}

function strokeRoundedRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
  drawRoundedRect(ctx, x, y, width, height, radius)
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

function drawText(ctx, text, x, y, options = {}) {
  const {
    size = 28,
    weight = 500,
    color = '#f6fbff',
    align = 'left',
    baseline = 'alphabetic',
    maxWidth = null,
  } = options
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = baseline

  let output = String(text || '')
  if (maxWidth && ctx.measureText(output).width > maxWidth) {
    while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
      output = output.slice(0, -1)
    }
    output = `${output}...`
  }
  ctx.fillText(output, x, y)
}

function drawHexIcon(ctx, x, y, radius, fillStyle, strokeStyle) {
  ctx.beginPath()
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI / 6 + index * Math.PI / 3
    const px = x + Math.cos(angle) * radius
    const py = y + Math.sin(angle) * radius
    if (index === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = fillStyle
  ctx.fill()
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = 3
  ctx.stroke()
}

function loadImage(src) {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function drawCircularImage(ctx, image, x, y, radius, fallbackText) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  if (image) {
    const size = Math.min(image.width, image.height)
    const sx = Math.max(0, (image.width - size) / 2)
    const sy = Math.max(0, (image.height - size) / 2)
    ctx.drawImage(image, sx, sy, size, size, x - radius, y - radius, radius * 2, radius * 2)
  } else {
    const fallbackGradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius)
    fallbackGradient.addColorStop(0, '#203040')
    fallbackGradient.addColorStop(1, '#c8573f')
    ctx.fillStyle = fallbackGradient
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    drawText(ctx, fallbackText.slice(0, 2), x, y + 10, {
      size: 42,
      weight: 800,
      color: '#ffffff',
      align: 'center',
      baseline: 'middle',
    })
  }

  ctx.restore()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.lineWidth = 3
  ctx.stroke()
}

function drawBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  gradient.addColorStop(0, '#121a22')
  gradient.addColorStop(0.5, '#0b1016')
  gradient.addColorStop(1, '#191b20')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

  const glow = ctx.createRadialGradient(140, 110, 0, 140, 110, 460)
  glow.addColorStop(0, 'rgba(41, 210, 188, 0.25)')
  glow.addColorStop(1, 'rgba(41, 210, 188, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

  const ember = ctx.createRadialGradient(690, 310, 0, 690, 310, 420)
  ember.addColorStop(0, 'rgba(232, 100, 64, 0.28)')
  ember.addColorStop(1, 'rgba(232, 100, 64, 0)')
  ctx.fillStyle = ember
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'
  ctx.lineWidth = 1
  for (let x = 60; x < POSTER_WIDTH; x += 70) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x - 260, POSTER_HEIGHT)
    ctx.stroke()
  }
}

function drawStatCell(ctx, x, y, width, height, label, value, accent) {
  fillRoundedRect(ctx, x, y, width, height, 18, 'rgba(255, 255, 255, 0.055)')
  strokeRoundedRect(ctx, x, y, width, height, 18, 'rgba(255, 255, 255, 0.09)')
  drawText(ctx, label, x + 26, y + 34, {
    size: 22,
    weight: 600,
    color: 'rgba(214, 226, 238, 0.72)',
  })
  drawText(ctx, value, x + 26, y + 86, {
    size: 38,
    weight: 800,
    color: accent,
    maxWidth: width - 52,
  })
}

function getAugmentAccent(augment) {
  const rarity = String(augment?.rarity || '').toLowerCase()
  if (rarity.includes('prismatic')) return '#caa8ff'
  if (rarity.includes('gold')) return '#e7bd68'
  if (rarity.includes('silver')) return '#f6fbff'
  return '#7fd7ff'
}

function getAugmentRarityLabel(augment) {
  const rarity = String(augment?.rarity || '').toLowerCase()
  if (rarity.includes('prismatic')) return t('postGame.rarityPrismatic')
  if (rarity.includes('gold')) return t('postGame.rarityGold')
  if (rarity.includes('silver')) return t('postGame.raritySilver')
  if (rarity.includes('unknown')) return t('postGame.rarityUnknown')
  return t('postGame.augment')
}

function drawAugmentCard(ctx, augment, image, y) {
  const x = 58
  const width = 634
  const height = 112
  const accent = getAugmentAccent(augment)
  const rarityLabel = getAugmentRarityLabel(augment)

  fillRoundedRect(ctx, x, y, width, height, 20, 'rgba(255, 255, 255, 0.06)')
  strokeRoundedRect(ctx, x, y, width, height, 20, 'rgba(255, 255, 255, 0.1)')
  drawHexIcon(ctx, x + 62, y + 56, 38, 'rgba(13, 20, 28, 0.95)', accent)

  if (image) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + 62, y + 56, 29, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(image, x + 33, y + 27, 58, 58)
    ctx.restore()
  } else {
    drawText(ctx, rarityLabel.slice(0, 2), x + 62, y + 65, {
      size: 24,
      weight: 800,
      color: accent,
      align: 'center',
      baseline: 'middle',
    })
  }

  drawText(ctx, augment?.name || t('postGame.unknownAugment'), x + 122, y + 50, {
    size: 30,
    weight: 800,
    color: '#f8fcff',
    maxWidth: width - 164,
  })
  drawText(ctx, t('postGame.augmentSuffix', { rarity: rarityLabel }), x + 122, y + 82, {
    size: 20,
    weight: 600,
    color: 'rgba(214, 226, 238, 0.66)',
  })
}

function drawCompactAugmentCard(ctx, augment, image, x, y) {
  const width = 306
  const height = 92
  const accent = getAugmentAccent(augment)
  const rarityLabel = getAugmentRarityLabel(augment)

  fillRoundedRect(ctx, x, y, width, height, 18, 'rgba(255, 255, 255, 0.06)')
  strokeRoundedRect(ctx, x, y, width, height, 18, 'rgba(255, 255, 255, 0.1)')
  drawHexIcon(ctx, x + 46, y + 46, 30, 'rgba(13, 20, 28, 0.95)', accent)

  if (image) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + 46, y + 46, 23, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(image, x + 23, y + 23, 46, 46)
    ctx.restore()
  } else {
    drawText(ctx, rarityLabel.slice(0, 2), x + 46, y + 52, {
      size: 18,
      weight: 800,
      color: accent,
      align: 'center',
      baseline: 'middle',
    })
  }

  drawText(ctx, augment?.name || t('postGame.unknownAugment'), x + 88, y + 39, {
    size: 22,
    weight: 800,
    color: '#f8fcff',
    maxWidth: width - 112,
  })
  drawText(ctx, t('postGame.augmentSuffix', { rarity: rarityLabel }), x + 88, y + 67, {
    size: 16,
    weight: 700,
    color: 'rgba(214, 226, 238, 0.62)',
    maxWidth: width - 112,
  })
}

function getPosterAugments(poster) {
  const augments = Array.isArray(poster?.augments) ? poster.augments.slice(0, 6) : []
  while (augments.length < 3) {
    augments.push({ name: t('postGame.unknownAugment'), rarity: 'unknown', imageDataUrl: null })
  }
  return augments
}

async function drawPoster() {
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return

  const token = ++drawToken
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const poster = props.poster || {}
  const stats = poster.stats || {}
  const [kills, deaths, assists] = getKdaParts()
  const posterAugments = getPosterAugments(poster)
  const championImagePromise = loadImage(poster.champion?.imageDataUrl)
  const augmentImagePromises = posterAugments.map((augment) =>
    loadImage(augment.imageDataUrl)
  )
  const [championImage, augmentImages] = await Promise.all([
    championImagePromise,
    Promise.all(augmentImagePromises),
  ])

  if (token !== drawToken) return

  ctx.clearRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  drawBackground(ctx)

  drawText(ctx, t('postGame.title'), 58, 70, {
    size: 24,
    weight: 800,
    color: '#9be8dc',
  })
  drawText(ctx, formatDuration(poster.durationSeconds), 58, 104, {
    size: 18,
    weight: 600,
    color: 'rgba(214, 226, 238, 0.58)',
  })

  fillRoundedRect(ctx, 580, 46, 112, 46, 23, 'rgba(255, 255, 255, 0.08)')
  strokeRoundedRect(ctx, 580, 46, 112, 46, 23, resultColor.value)
  drawText(ctx, resultLabel.value, 636, 76, {
    size: 24,
    weight: 900,
    color: resultColor.value,
    align: 'center',
  })

  fillRoundedRect(ctx, 52, 132, 646, 132, 28, 'rgba(255, 255, 255, 0.065)')
  strokeRoundedRect(ctx, 52, 132, 646, 132, 28, 'rgba(255, 255, 255, 0.1)')
  drawCircularImage(ctx, championImage, 126, 198, 50, championName.value)
  drawText(ctx, championName.value, 200, 188, {
    size: 34,
    weight: 900,
    color: '#ffffff',
    maxWidth: 390,
  })
  drawText(ctx, poster.summonerName || poster.queueName || 'ARAM', 202, 225, {
    size: 22,
    weight: 600,
    color: 'rgba(214, 226, 238, 0.68)',
    maxWidth: 340,
  })
  drawText(ctx, poster.queueName || 'ARAM', 640, 208, {
    size: 22,
    weight: 800,
    color: '#e86440',
    align: 'right',
  })

  fillRoundedRect(ctx, 52, 300, 646, 156, 24, 'rgba(255, 255, 255, 0.07)')
  strokeRoundedRect(ctx, 52, 300, 646, 156, 24, 'rgba(255, 255, 255, 0.11)')
  drawText(ctx, t('postGame.stats'), 84, 346, {
    size: 22,
    weight: 800,
    color: '#9be8dc',
  })
  drawText(ctx, `${kills} / ${deaths} / ${assists}`, 84, 414, {
    size: 58,
    weight: 900,
    color: '#ffffff',
    maxWidth: 582,
  })
  const cellWidth = 306
  drawStatCell(ctx, 52, 494, cellWidth, 118, t('postGame.damage'), formatLargeNumber(stats.damageDealtToChampions), '#9be8dc')
  drawStatCell(ctx, 392, 494, cellWidth, 118, t('postGame.damageTaken'), formatLargeNumber(stats.damageTaken), '#ffb06e')
  drawStatCell(ctx, 52, 636, cellWidth, 118, t('postGame.gold'), formatLargeNumber(stats.goldEarned), '#e7bd68')
  drawStatCell(ctx, 392, 636, cellWidth, 118, 'KDA', formatKdaValue(stats.kda), '#caa8ff')

  drawText(ctx, t('postGame.augments'), 58, 820, {
    size: 28,
    weight: 900,
    color: '#ffffff',
  })
  drawText(ctx, 'Hextech Augments', 58, 852, {
    size: 18,
    weight: 700,
    color: 'rgba(214, 226, 238, 0.5)',
  })

  if (posterAugments.length <= 3) {
    posterAugments.forEach((augment, index) => {
      drawAugmentCard(ctx, augment, augmentImages[index], 882 + index * 126)
    })
  } else {
    posterAugments.forEach((augment, index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      drawCompactAugmentCard(ctx, augment, augmentImages[index], 58 + column * 328, 882 + row * 100)
    })
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.beginPath()
  ctx.moveTo(58, 1260)
  ctx.lineTo(692, 1260)
  ctx.stroke()
  drawText(ctx, t('postGame.footer'), 375, 1300, {
    size: 22,
    weight: 800,
    color: 'rgba(246, 251, 255, 0.86)',
    align: 'center',
  })
}

function exportPosterDataUrl() {
  const canvas = canvasRef.value
  if (!canvas) {
    throw new Error(t('postGame.notGenerated'))
  }
  return canvas.toDataURL('image/png')
}

function buildSuggestedFilename() {
  const name = championName.value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
  return `aramgg-${name || 'post-game'}-${Date.now()}.png`
}

function showToast(message, type = 'success') {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }

  toast.value = {
    visible: true,
    message,
    type,
  }

  toastTimer = setTimeout(() => {
    toast.value = {
      ...toast.value,
      visible: false,
    }
    toastTimer = null
  }, 2200)
}

async function runPosterAction(action, actionName) {
  actionPending.value = true
  try {
    await drawPoster()
    await action(exportPosterDataUrl())
  } catch (error) {
    if (actionName) {
      trackPostGameShareEvent(`post_game_share_${actionName}_failure`, {
        button: actionName,
        error_message: error?.message || String(error || 'unknown'),
      })
    }
    showToast(error?.message || t('postGame.operationFailed'), 'error')
  } finally {
    actionPending.value = false
  }
}

async function copyPoster() {
  trackPostGameShareEvent('post_game_share_copy_click', {
    button: 'copy',
  })
  await runPosterAction(async (dataUrl) => {
    const result = await electronAPI.postGameShare.copyImage(dataUrl)
    if (!result?.success) {
      throw new Error(result?.error || t('postGame.copyFailed'))
    }
    trackPostGameShareEvent('post_game_share_copy_success', {
      button: 'copy',
    })
    showToast(t('postGame.copied'))
  }, 'copy')
}

async function savePoster() {
  trackPostGameShareEvent('post_game_share_save_click', {
    button: 'save',
  })
  await runPosterAction(async (dataUrl) => {
    const result = await electronAPI.postGameShare.saveImage(dataUrl, buildSuggestedFilename())
    if (result?.cancelled) {
      trackPostGameShareEvent('post_game_share_save_cancel', {
        button: 'save',
      })
      return
    }
    if (!result?.success) {
      throw new Error(result?.error || t('postGame.saveFailed'))
    }
    trackPostGameShareEvent('post_game_share_save_success', {
      button: 'save',
    })
    showToast(t('postGame.saved'))
  }, 'save')
}

watch(
  () => [props.poster, locale.value],
  () => {
    drawPoster()
  },
  { deep: true }
)

onMounted(() => {
  drawPoster()
})

onBeforeUnmount(() => {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
})
</script>

<style scoped>
.post-share-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(10px);
}

.post-share-modal {
  width: min(100%, 360px);
  max-height: calc(100dvh - 36px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  border-radius: 8px;
  padding: 12px;
  background:
    linear-gradient(180deg, rgba(21, 31, 40, 0.98), rgba(8, 14, 20, 0.98)),
    #0b1016;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

.post-share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 0;
}

.post-share-kicker {
  margin: 0 0 4px;
  color: #9be8dc;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

.post-share-header h2 {
  margin: 0;
  color: #f7fbff;
  font-size: 17px;
  line-height: 1.15;
  text-wrap: balance;
}

.post-share-icon-button {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  color: #d7e4f1;
  background: rgba(255, 255, 255, 0.07);
  cursor: pointer;
  transition-property: scale, background-color;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}

.post-share-icon-button:hover {
  background: rgba(255, 255, 255, 0.11);
}

.post-share-icon-button:active {
  scale: 0.96;
}

.post-share-icon {
  width: 18px;
  height: 18px;
}

.post-share-preview {
  min-height: 0;
  display: flex;
  justify-content: center;
  overflow: auto;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.post-share-canvas {
  width: min(100%, 260px);
  height: auto;
  border-radius: 8px;
  outline: 1px solid rgba(255, 255, 255, 0.1);
  outline-offset: -1px;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.38);
}

.post-share-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.post-share-action {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  color: #071015;
  background: #9be8dc;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition-property: scale, background-color, opacity;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}

.post-share-action.accent {
  background: #e7bd68;
}

.post-share-action:hover:not(:disabled) {
  background: #b8fff4;
}

.post-share-action.accent:hover:not(:disabled) {
  background: #ffd98a;
}

.post-share-action:active:not(:disabled) {
  scale: 0.96;
}

.post-share-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.post-share-action-icon {
  width: 16px;
  height: 16px;
}

.post-share-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 60;
  transform: translate(-50%, 0);
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border-radius: 21px;
  color: #071015;
  background: #9be8dc;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.16),
    0 16px 34px rgba(0, 0, 0, 0.38);
  font-size: 13px;
  font-weight: 900;
  text-wrap: pretty;
}

.post-share-toast.error {
  color: #22090a;
  background: #ffb4ab;
}

.post-share-toast-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.post-share-toast-enter-active,
.post-share-toast-leave-active {
  transition-property: opacity, transform, filter;
  transition-duration: 180ms;
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

.post-share-toast-enter-from,
.post-share-toast-leave-to {
  opacity: 0;
  filter: blur(4px);
  transform: translate(-50%, 12px);
}

.post-share-toast-enter-to,
.post-share-toast-leave-from {
  opacity: 1;
  filter: blur(0);
  transform: translate(-50%, 0);
}

</style>
