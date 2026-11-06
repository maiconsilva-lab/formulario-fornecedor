/* Substituto de read-excel-file/node: converte o .xlsx numa Planilha Google
   temporária (Drive API), lê a aba pedida e apaga a cópia. */
import { Buffer } from 'buffer';
import { Promessa } from './promessa.js';

const convertidos = {};
function converter(buf) {
  const bytes = Array.from(Buffer.from(buf)).map((x) => (x > 127 ? x - 256 : x));
  const md5 = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes).map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  if (convertidos[md5]) return convertidos[md5];
  const blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'temp.xlsx');
  const arq = Drive.Files.create({ name: 'temp-leitura-xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' }, blob);
  const ss = SpreadsheetApp.openById(arq.id);
  const abas = {};
  for (const sh of ss.getSheets()) abas[sh.getName()] = sh.getDataRange().getValues().map((l) => l.map((v) => (v === '' ? null : v)));
  try { Drive.Files.remove(arq.id); } catch (e) { try { DriveApp.getFileById(arq.id).setTrashed(true); } catch (e2) { /* ignora */ } }
  convertidos[md5] = abas;
  return abas;
}

export default function readXlsxFile(buf, opts = {}) {
  try {
    const abas = converter(buf);
    const nomes = Object.keys(abas);
    const nome = typeof opts.sheet === 'number' ? nomes[opts.sheet - 1] : (opts.sheet || nomes[0]);
    if (!(nome in abas)) return Promessa.reject(new Error(`Sheet "${nome}" not found`));
    return Promessa.resolve(abas[nome]);
  } catch (e) { return Promessa.reject(e); }
}
export function readSheetNames(buf) {
  try { return Promessa.resolve(Object.keys(converter(buf))); } catch (e) { return Promessa.reject(e); }
}
