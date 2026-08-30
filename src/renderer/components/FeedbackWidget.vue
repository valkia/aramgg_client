<template>
  <aside
    ref="root"
    class="feedback-morph"
    :data-open="String(isOpen)"
  >
    <div
      class="feedback-morph-menu"
      role="dialog"
      aria-labelledby="feedback-title"
      aria-describedby="feedback-description"
      :aria-hidden="String(!isOpen)"
      :inert="!isOpen"
    >
      <form ref="form" class="feedback-form" @submit.prevent="submit">
        <header class="feedback-form-header">
          <div>
            <p class="feedback-form-kicker">{{ t('feedback.kicker') }}</p>
            <h2 id="feedback-title">{{ t('feedback.title') }}</h2>
            <p id="feedback-description">{{ t('feedback.description') }}</p>
          </div>
          <button type="button" class="feedback-close" :aria-label="t('common.close')" @click="close">
            <X aria-hidden="true" />
          </button>
        </header>

        <div class="feedback-form-fields">
          <label class="feedback-field" for="feedback-category">
            <span>{{ t('feedback.categoryLabel') }}</span>
            <select id="feedback-category" v-model="category">
              <option value="suggestion">{{ t('feedback.categorySuggestion') }}</option>
              <option value="question">{{ t('feedback.categoryQuestion') }}</option>
              <option value="bug">{{ t('feedback.categoryBug') }}</option>
              <option value="other">{{ t('feedback.categoryOther') }}</option>
            </select>
          </label>

          <label class="feedback-field" for="feedback-message">
            <span>{{ t('feedback.messageLabel') }}</span>
            <textarea
              id="feedback-message"
              ref="messageInput"
              v-model="message"
              required
              minlength="2"
              maxlength="2000"
              rows="4"
              :placeholder="t('feedback.messagePlaceholder')"
            />
            <span class="feedback-counter">{{ message.length }} / 2000</span>
          </label>

          <label class="feedback-field" for="feedback-contact">
            <span>{{ t('feedback.contactLabel') }}</span>
            <input
              id="feedback-contact"
              v-model="contact"
              type="text"
              maxlength="200"
              autocomplete="email"
              :placeholder="t('feedback.contactPlaceholder')"
            />
          </label>

          <div class="feedback-image-field">
            <input
              id="feedback-image"
              ref="imageInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :disabled="isBusy"
              @change="selectImage"
            />
            <label class="feedback-image-button" for="feedback-image" :data-disabled="String(isBusy)">
              <Plus aria-hidden="true" />
              <span>{{ t('feedback.imageLabel') }}</span>
            </label>
            <p>{{ t('feedback.imageHint') }}</p>
            <figure v-if="previewUrl" class="feedback-image-preview">
              <img :src="previewUrl" :alt="t('feedback.previewAlt')" />
              <figcaption>{{ imageMeta }}</figcaption>
              <button type="button" @click="clearImage">{{ t('feedback.removeImage') }}</button>
            </figure>
          </div>
        </div>

        <footer class="feedback-form-footer">
          <p class="feedback-privacy">{{ t('feedback.privacyNote') }}</p>
          <p v-if="status" class="feedback-status" :data-error="String(statusError)" role="status">
            {{ status }}
          </p>
          <button type="submit" class="feedback-submit" :disabled="isBusy">
            <span>{{ isSubmitting ? t('feedback.submitting') : t('feedback.submit') }}</span>
            <Send aria-hidden="true" />
          </button>
        </footer>
      </form>
    </div>

    <button
      type="button"
      class="feedback-morph-trigger"
      :aria-expanded="String(isOpen)"
      :aria-label="t('feedback.button')"
      :title="t('feedback.button')"
      @click="open"
    >
      <span class="feedback-trigger-label">{{ t('feedback.button') }}</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Plus, Send, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { FeedbackCategory, SupportedDataLocale } from '../../shared/ipc-contract.ts'
import { electronAPI } from '../native/electron-api.js'
import {
  compressFeedbackImage,
  formatFeedbackImageBytes,
} from '../services/feedback-image.ts'

const emit = defineEmits<{ 'open-change': [open: boolean] }>()
const { locale, t } = useI18n()
const root = ref<HTMLElement | null>(null)
const form = ref<HTMLFormElement | null>(null)
const messageInput = ref<HTMLTextAreaElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const isSubmitting = ref(false)
const isCompressing = ref(false)
const category = ref<FeedbackCategory>('suggestion')
const message = ref('')
const contact = ref('')
const compressedImage = ref<Blob | null>(null)
const previewUrl = ref('')
const imageMeta = ref('')
const status = ref('')
const statusError = ref(false)
const isBusy = computed(() => isSubmitting.value || isCompressing.value)

function setOpen(opened: boolean): void {
  if (isOpen.value === opened) return
  isOpen.value = opened
  emit('open-change', opened)
  if (opened) {
    window.setTimeout(() => void nextTick(() => messageInput.value?.focus()), 360)
  }
}

function open(): void {
  setOpen(true)
}

function close(): void {
  setOpen(false)
}

function showStatus(text: string, error = false): void {
  status.value = text
  statusError.value = error
}

function clearImage(): void {
  compressedImage.value = null
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  imageMeta.value = ''
  if (imageInput.value) imageInput.value.value = ''
}

async function selectImage(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  clearImage()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showStatus(t('feedback.compressionError'), true)
    return
  }

  isCompressing.value = true
  showStatus(t('feedback.compressing'))
  try {
    const blob = await compressFeedbackImage(file)
    compressedImage.value = blob
    previewUrl.value = URL.createObjectURL(blob)
    imageMeta.value = t('feedback.imageReady', {
      size: formatFeedbackImageBytes(blob.size, locale.value),
    })
    showStatus(imageMeta.value)
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const key = code === 'source_too_large'
      ? 'feedback.sourceTooLarge'
      : code === 'compressed_too_large'
        ? 'feedback.compressedTooLarge'
        : 'feedback.compressionError'
    showStatus(t(key), true)
    clearImage()
  } finally {
    isCompressing.value = false
  }
}

async function submit(): Promise<void> {
  if (isBusy.value || !form.value?.reportValidity()) return
  isSubmitting.value = true
  status.value = ''
  try {
    const image = compressedImage.value
      ? new Uint8Array(await compressedImage.value.arrayBuffer())
      : undefined
    const result = await electronAPI.feedback.submit({
      category: category.value,
      message: message.value,
      contact: contact.value,
      locale: locale.value as SupportedDataLocale,
      image,
    })
    if (!result.success) throw new Error(result.error || 'submit_failed')

    category.value = 'suggestion'
    message.value = ''
    contact.value = ''
    clearImage()
    showStatus(t('feedback.success'))
  } catch (error) {
    console.warn('Failed to submit feedback:', error)
    showStatus(t('feedback.submitError'), true)
  } finally {
    isSubmitting.value = false
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isOpen.value) close()
}

function handlePointerDown(event: PointerEvent): void {
  if (isOpen.value && root.value && !event.composedPath().includes(root.value)) close()
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('pointerdown', handlePointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('pointerdown', handlePointerDown)
  clearImage()
})

defineExpose({ open })
</script>

<style scoped src="../styles/feedback-widget.css"></style>
