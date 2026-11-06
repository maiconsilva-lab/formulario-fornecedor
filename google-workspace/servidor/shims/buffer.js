/* Buffer (pacote "buffer") + suporte a 'base64url', que o Node tem e o pacote não. */
import { Buffer as B } from 'buffer-original';

const paraUrl = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deUrl = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return t + '='.repeat((4 - (t.length % 4)) % 4); };

const toStringOriginal = B.prototype.toString;
B.prototype.toString = function (enc, ...resto) {
  if (enc === 'base64url') return paraUrl(toStringOriginal.call(this, 'base64', ...resto));
  return toStringOriginal.call(this, enc, ...resto);
};
const fromOriginal = B.from;
B.from = function (v, enc, ...resto) {
  if (enc === 'base64url' && typeof v === 'string') return fromOriginal.call(B, deUrl(v), 'base64');
  return fromOriginal.call(B, v, enc, ...resto);
};
const isEncodingOriginal = B.isEncoding;
B.isEncoding = (e) => e === 'base64url' || isEncodingOriginal(e);
const byteLengthOriginal = B.byteLength;
B.byteLength = (s, enc) => (enc === 'base64url' ? byteLengthOriginal(deUrl(s), 'base64') : byteLengthOriginal(s, enc));

export const Buffer = B;
export default { Buffer: B };
