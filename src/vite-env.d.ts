/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SEQ_ENABLED?: string;
  readonly VITE_SEQ_ENDPOINT?: string;
  readonly VITE_SEQ_API_KEY?: string;
  readonly VITE_SEQ_USE_PROXY?: string;
  readonly VITE_SEQ_PROXY_ENDPOINT?: string;
  readonly VITE_SEQ_BATCH_SIZE?: string;
  readonly VITE_SEQ_BATCH_TIMEOUT?: string;
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
