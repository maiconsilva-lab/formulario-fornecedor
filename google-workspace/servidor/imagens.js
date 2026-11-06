/* Imagens do painel (logo, fotos de login, telas dos POPs) ficam numa pasta do Drive
   e são entregues ao navegador como data URL, com cache. */
import { Buffer } from 'buffer';

export function lerImagem(caminho) {
  const cache = CacheService.getScriptCache();
  const chave = 'img:' + String(caminho).slice(0, 80);
  const guardada = cache.get(chave);
  if (guardada) return guardada;
  const pastaId = PropertiesService.getScriptProperties().getProperty('PASTA_IMAGENS');
  if (!pastaId || !/^[\w./-]+$/.test(String(caminho)) || String(caminho).includes('..')) return null;
  let pasta = DriveApp.getFolderById(pastaId);
  const partes = String(caminho).replace(/^\/+/, '').split('/');
  const nome = partes.pop();
  for (const p of partes) { const it = pasta.getFoldersByName(p); if (!it.hasNext()) return null; pasta = it.next(); }
  const it = pasta.getFilesByName(nome);
  if (!it.hasNext()) return null;
  const blob = it.next().getBlob();
  const url = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  if (url.length < 95000) cache.put(chave, url, 21600);
  return url;
}
