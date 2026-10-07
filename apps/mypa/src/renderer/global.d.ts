import type { MypaApi } from "../shared/api";

declare global {
  interface Window {
    mypa: MypaApi;
  }
}

export {};
