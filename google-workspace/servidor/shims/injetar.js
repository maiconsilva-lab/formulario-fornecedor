/* Globais injetadas em todo o código empacotado (esbuild "inject").
   Substituem o que o Node/Vercel oferecia e o Apps Script não tem. */
export { Buffer } from 'buffer';
export {
  Promessa as Promise, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
} from './promessa.js';
export {
  process, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, Headers,
  AbortController, AbortSignal, structuredClone, Blob, ReadableStream,
} from './ambiente.js';
export { fetch, Request } from './fetch.js';
export { NextResponse as Response } from './next-server.js';
export const global = globalThis;
