interface ImportMetaEnv {
  readonly VITE_OBUILDER?: string;
  readonly VITE_OBUILDER_API_SECRET_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
