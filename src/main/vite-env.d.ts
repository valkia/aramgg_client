/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ARAMGG_DATA_API_ORIGIN: string
  readonly ARAMGG_DISTRIBUTION_CHANNEL?: string
  readonly ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
