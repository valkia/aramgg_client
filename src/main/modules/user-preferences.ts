import store from './app-store.ts'

export const USER_PREFERENCE_KEYS = {
    showChampionDetails: 'championInsight.showDetails',
    showAugmentTopOverlay: 'augments.showTopOverlay',
    showAugmentSidePanel: 'augments.showSidePanel',
}

export function getBooleanPreference(key: string, defaultValue = true): boolean {
    const value = store.get(key)
    if (value == null) {
        return defaultValue
    }

    return value !== false
}

export function shouldShowChampionDetails(): boolean {
    return getBooleanPreference(USER_PREFERENCE_KEYS.showChampionDetails, true)
}

export function shouldShowAugmentTopOverlay(): boolean {
    return getBooleanPreference(USER_PREFERENCE_KEYS.showAugmentTopOverlay, true)
}

export function shouldShowAugmentSidePanel(): boolean {
    return getBooleanPreference(USER_PREFERENCE_KEYS.showAugmentSidePanel, true)
}
