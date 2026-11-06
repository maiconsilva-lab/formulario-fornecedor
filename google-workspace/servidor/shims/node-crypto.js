/* Substituto de node:crypto para o Apps Script (só o que o painel usa). */
import { Buffer } from 'buffer';
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/sha1';

const paraBytes = (v, enc) => {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v.map((x) => x & 0xff));
  return Buffer.from(String(v), enc || 'utf8');
};

export function randomBytes(n) {
  const out = Buffer.alloc(n);
  if (typeof Utilities !== 'undefined') {
    // UUIDs do Apps Script vêm de um gerador seguro; cada um rende 15 bytes aleatórios.
    let i = 0;
    while (i < n) {
      const hex = Utilities.getUuid().replace(/-/g, '');
      const b = Buffer.from(hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17), 'hex');
      for (let j = 0; j < b.length && i < n; j++) out[i++] = b[j];
    }
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}
export function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  const faixa = max - min;
  const b = randomBytes(6);
  const n = b.readUIntBE(0, 6);
  return min + (n % faixa);
}
export function randomUUID() {
  if (typeof Utilities !== 'undefined') return Utilities.getUuid();
  const b = randomBytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const getRandomValues = (arr) => { const b = randomBytes(arr.length); for (let i = 0; i < arr.length; i++) arr[i] = b[i]; return arr; };
export const webcrypto = { getRandomValues, randomUUID };

function saida(bytes, enc) {
  const b = Buffer.from(bytes);
  return enc ? b.toString(enc) : b;
}

/* MD5 pelo próprio Apps Script (acumula e calcula no digest). */
const md5 = {
  create() {
    const partes = [];
    return {
      update(b) { partes.push(Buffer.from(b)); return this; },
      digest() {
        const bytes = Array.from(Buffer.concat(partes)).map((x) => (x > 127 ? x - 256 : x));
        return Uint8Array.from(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes).map((x) => x & 0xff));
      },
    };
  },
};
const ALGS = { sha256, sha1, md5 };

export function createHash(alg) {
  const f = ALGS[String(alg).toLowerCase().replace('-', '')];
  if (!f) throw new Error('Hash não suportado: ' + alg);
  const h = f.create();
  return { update(d, enc) { h.update(paraBytes(d, enc)); return this; }, digest: (enc) => saida(h.digest(), enc) };
}

export function createHmac(alg, chave) {
  const f = ALGS[String(alg).toLowerCase().replace('-', '')];
  if (!f || f === md5) throw new Error('HMAC não suportado: ' + alg);
  const h = hmac.create(f, paraBytes(chave));
  return { update(d, enc) { h.update(paraBytes(d, enc)); return this; }, digest: (enc) => saida(h.digest(), enc) };
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export function hkdfSync(alg, ikm, salt, info, tamanho) {
  return hkdf(sha256, paraBytes(ikm), paraBytes(salt), paraBytes(info), tamanho).buffer;
}

/* AES-256-GCM no estilo stream do Node: update() acumula, final() cifra/decifra. */
export function createCipheriv(alg, chave, iv) {
  if (alg !== 'aes-256-gcm') throw new Error('Cifra não suportada: ' + alg);
  const partes = []; let tag = null;
  return {
    update(d, enc) { partes.push(paraBytes(d, enc)); return Buffer.alloc(0); },
    final() {
      const out = gcm(paraBytes(chave), paraBytes(iv)).encrypt(Buffer.concat(partes));
      tag = Buffer.from(out.slice(out.length - 16));
      return Buffer.from(out.slice(0, out.length - 16));
    },
    getAuthTag: () => tag,
  };
}
export function createDecipheriv(alg, chave, iv) {
  if (alg !== 'aes-256-gcm') throw new Error('Cifra não suportada: ' + alg);
  const partes = []; let tag = null;
  return {
    setAuthTag(t) { tag = paraBytes(t); return this; },
    update(d, enc) { partes.push(paraBytes(d, enc)); return Buffer.alloc(0); },
    final() {
      const dados = Buffer.concat([...partes, Buffer.from(tag)]);
      return Buffer.from(gcm(paraBytes(chave), paraBytes(iv)).decrypt(dados));
    },
  };
}

export default {
  randomBytes, randomInt, randomUUID, getRandomValues, webcrypto, createHash, createHmac,
  timingSafeEqual, hkdfSync, createCipheriv, createDecipheriv,
};
