interface ImportMetaEnv {
  readonly VITE_RELAY?: string;
  readonly VITE_LOCAL?: string;
  readonly VITE_OWNABLE_EXAMPLES_URL?: string;
  readonly VITE_OBUILDER?: string;
  readonly VITE_OBUILDER_API_SECRET_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
