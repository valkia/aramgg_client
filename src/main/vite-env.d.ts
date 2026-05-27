/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ARAMGG_DATA_API_ORIGIN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
