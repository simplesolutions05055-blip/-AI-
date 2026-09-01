/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}
