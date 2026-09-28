/// <reference types="vite/client" />

import type { JackpopTestApi } from "./test-api";

declare global {
  interface ImportMetaEnv {
    readonly VITE_APP_COMMIT?: string;
    readonly VITE_APP_BUILT_AT?: string;
  }

  interface Window {
    __jackpopTest?: JackpopTestApi;
  }
}

export {};
