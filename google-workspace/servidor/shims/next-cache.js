/* Substituto de next/cache: unstable_cache guarda o resultado no CacheService
   (até 6 h; partes de 90 KB) e revalidateTag invalida pela "versão" da tag. */
import { Promessa } from './promessa.js';

const PARTE = 90000;
const cache = () => CacheService.getScriptCache();
const versaoTag = (t) => cache().get('tag:' + t) || '0';

function ler(chave) {
  const c = cache();
  const n = c.get(chave + ':n');
  if (!n) return undefined;
  const partes = c.getAll(Array.from({ length: Number(n) }, (_, i) => chave + ':' + i));
  let s = '';
  for (let i = 0; i < Number(n); i++) { const p = partes[chave + ':' + i]; if (p === undefined) return undefined; s += p; }
  try { return JSON.parse(s); } catch { return undefined; }
}
function gravar(chave, valor, segundos) {
  const s = JSON.stringify(valor === undefined ? null : valor);
  if (s.length > PARTE * 50) return;
  const itens = {};
  let n = 0;
  for (let i = 0; i < s.length; i += PARTE, n++) itens[chave + ':' + n] = s.slice(i, i + PARTE);
  itens[chave + ':n'] = String(n);
  try { cache().putAll(itens, Math.min(segundos || 21600, 21600)); } catch (e) { /* cache cheio: segue sem */ }
}

export function unstable_cache(fn, partes = [], opts = {}) {
  return (...args) => {
    const tags = (opts.tags || []).map((t) => t + '@' + versaoTag(t)).join(',');
    const chave = 'uc:' + JSON.stringify([partes, args, tags]).slice(0, 200);
    const achado = ler(chave);
    if (achado !== undefined) return Promessa.resolve(achado);
    return Promessa.resolve(fn(...args)).then((v) => { gravar(chave, v, opts.revalidate); return v; });
  };
}
export function revalidateTag(tag) { cache().put('tag:' + tag, String(Date.now()), 21600); }
export function revalidatePath() {}
export const unstable_noStore = () => {};
