/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESK_MODE?: string;
  readonly VITE_DESK_API_BASE?: string;
  readonly VITE_DESK_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
