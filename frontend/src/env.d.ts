/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PAYLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
