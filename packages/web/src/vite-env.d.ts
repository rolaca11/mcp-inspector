/// <reference types="vite/client" />

declare const __PKG_VERSION__: string;
declare module "*.css" {}

interface ImportMetaEnv {
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_POSTHOG_HOST?: string;
}
