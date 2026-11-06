/* Substituto do pacote "googleapis": as mesmas chamadas (sheets, drive, vision),
   feitas pela API REST com o token OAuth da conta do script. As credenciais de
   conta de serviço passadas pelo código são ignoradas. */
import { Buffer } from 'buffer';
import { Promessa } from './promessa.js';

function consulta(params, fora) {
  const partes = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (fora.includes(k) || v === undefined || v === null) continue;
    for (const item of Array.isArray(v) ? v : [v]) partes.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(item)));
  }
  return partes.length ? '?' + partes.join('&') : '';
}

function chamar(metodo, url, corpo, opts = {}) {
  const r = UrlFetchApp.fetch(url, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: corpo !== undefined ? 'application/json' : undefined,
    payload: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    muteHttpExceptions: true,
  });
  const status = r.getResponseCode();
  const headers = {};
  for (const [k, v] of Object.entries(r.getHeaders() || {})) headers[k.toLowerCase()] = v;
  if (status >= 300) {
    let dados; try { dados = JSON.parse(r.getContentText()); } catch { dados = r.getContentText(); }
    const msg = (dados && dados.error && dados.error.message) || `Erro ${status} na API do Google`;
    throw Object.assign(new Error(msg), { code: status, status, response: { status, data: dados, headers }, errors: dados?.error?.errors });
  }
  let data;
  if (opts.responseType === 'arraybuffer') { const b = Buffer.from(r.getContent().map((x) => x & 0xff)); data = b.buffer.slice(b.byteOffset, b.byteOffset + b.length); }
  else if (opts.responseType === 'text') data = r.getContentText();
  else { const t = r.getContentText(); try { data = t ? JSON.parse(t) : {}; } catch { data = t; } }
  return { data, status, headers, statusText: String(status) };
}

const assinc = (fn) => (...a) => { try { return Promessa.resolve(fn(...a)); } catch (e) { return Promessa.reject(e); } };
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const id = (s) => encodeURIComponent(s);

function sheets() {
  return {
    spreadsheets: {
      get: assinc((p = {}) => chamar('get', SHEETS + id(p.spreadsheetId) + consulta(p, ['spreadsheetId', 'auth']))),
      batchUpdate: assinc((p = {}) => chamar('post', SHEETS + id(p.spreadsheetId) + ':batchUpdate', p.requestBody || p.resource)),
      values: {
        get: assinc((p = {}) => chamar('get', SHEETS + id(p.spreadsheetId) + '/values/' + id(p.range) + consulta(p, ['spreadsheetId', 'range', 'auth']))),
        batchGet: assinc((p = {}) => chamar('get', SHEETS + id(p.spreadsheetId) + '/values:batchGet' + consulta(p, ['spreadsheetId', 'auth']))),
        update: assinc((p = {}) => chamar('put', SHEETS + id(p.spreadsheetId) + '/values/' + id(p.range) + consulta(p, ['spreadsheetId', 'range', 'requestBody', 'resource', 'auth']), p.requestBody || p.resource)),
        append: assinc((p = {}) => chamar('post', SHEETS + id(p.spreadsheetId) + '/values/' + id(p.range) + ':append' + consulta(p, ['spreadsheetId', 'range', 'requestBody', 'resource', 'auth']), p.requestBody || p.resource)),
        batchUpdate: assinc((p = {}) => chamar('post', SHEETS + id(p.spreadsheetId) + '/values:batchUpdate', p.requestBody || p.resource)),
        clear: assinc((p = {}) => chamar('post', SHEETS + id(p.spreadsheetId) + '/values/' + id(p.range) + ':clear', {})),
      },
    },
  };
}

function drive() {
  const BASE = 'https://www.googleapis.com/drive/v3/files/';
  return {
    files: {
      get: assinc((p = {}, opts = {}) => chamar('get', BASE + id(p.fileId) + consulta(p, ['fileId', 'auth']), undefined, opts)),
      list: assinc((p = {}) => chamar('get', 'https://www.googleapis.com/drive/v3/files' + consulta(p, ['auth']))),
      export: assinc((p = {}, opts = {}) => chamar('get', BASE + id(p.fileId) + '/export' + consulta(p, ['fileId', 'auth']), undefined, opts)),
    },
  };
}

function vision() {
  return {
    files: { annotate: assinc((p = {}) => chamar('post', 'https://vision.googleapis.com/v1/files:annotate', p.requestBody || p.resource)) },
    images: { annotate: assinc((p = {}) => chamar('post', 'https://vision.googleapis.com/v1/images:annotate', p.requestBody || p.resource)) },
  };
}

class Credencial {
  constructor(opts) { this.opts = opts; }
  authorize() { return Promessa.resolve({}); }
  getClient() { return Promessa.resolve(this); }
  getAccessToken() { return Promessa.resolve({ token: ScriptApp.getOAuthToken() }); }
}

export const google = {
  auth: { JWT: Credencial, GoogleAuth: Credencial, OAuth2: Credencial },
  sheets: () => sheets(),
  drive: () => drive(),
  vision: () => vision(),
};
export default { google };
