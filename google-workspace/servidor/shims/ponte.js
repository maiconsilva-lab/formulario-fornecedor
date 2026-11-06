/* "Ponte do Drive" (docs/lancamentos/apps-script-ponte-drive.gs) rodando dentro do
   próprio app. O painel continua chamando fetch(DRIVE_PONTE_URL); aqui isso vira
   chamada local, com a conta do script — sem segredo trafegando.

   Propriedades opcionais:
     PONTE_PASTAS_PERMITIDAS  ids de pasta separados por vírgula (vazio = qualquer arquivo
                              que a conta do script enxerga)
     PONTE_PLANILHA_ID        planilha de recepção (aba "Demandas") */

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

function dentroDasPastas(arquivo, permitidas) {
  if (!permitidas.length) return true;
  const fila = [];
  const p = arquivo.getParents();
  while (p.hasNext()) fila.push({ pasta: p.next(), nivel: 1 });
  while (fila.length) {
    const item = fila.shift();
    if (permitidas.includes(item.pasta.getId())) return true;
    if (item.nivel >= 8) continue;
    const acima = item.pasta.getParents();
    while (acima.hasNext()) fila.push({ pasta: acima.next(), nivel: item.nivel + 1 });
  }
  return false;
}

function lerPlanilha(id) {
  if (!id) return { ok: false, codigo: 400, erro: 'PONTE_PLANILHA_ID não configurado' };
  const aba = SpreadsheetApp.openById(id).getSheetByName('Demandas');
  if (!aba) return { ok: false, codigo: 404, erro: 'Aba Demandas não encontrada' };
  const ultima = aba.getLastRow();
  if (ultima < 2) return { ok: true, linhas: [] };
  const valores = aba.getRange(2, 1, ultima - 1, 19).getValues();
  const numeros = aba.getRange(2, 5, ultima - 1, 1).getDisplayValues();
  const linhas = valores.map((r, i) => {
    const num = String(numeros[i][0] || '').replace(/\s/g, '');
    if (/^\d+$/.test(num)) r[4] = num;
    return [i + 2].concat(r.map((v) => (v instanceof Date ? v.toISOString() : v)));
  });
  return { ok: true, linhas, lidoEm: new Date().toISOString() };
}

export function ocrDoDrive(fileId) {
  let copia = null;
  try {
    copia = Drive.Files.copy(
      { name: 'ocr-temp-painel-' + fileId, mimeType: 'application/vnd.google-apps.document', parents: ['root'] },
      fileId,
      { ocrLanguage: 'pt', supportsAllDrives: true },
    );
    return DocumentApp.openById(copia.id).getBody().getText();
  } finally {
    if (copia) {
      try { Drive.Files.remove(copia.id); } catch (e) { try { DriveApp.getFileById(copia.id).setTrashed(true); } catch (e2) { /* ignora */ } }
    }
  }
}

export function ponteDrive(req) {
  try {
    if (req.acao === 'planilha') return lerPlanilha(prop('PONTE_PLANILHA_ID'));
    if (!/^[\w-]{10,}$/.test(req.fileId || '')) return { ok: false, codigo: 400, erro: 'Arquivo inválido' };
    let arquivo;
    try { arquivo = DriveApp.getFileById(req.fileId); } catch (err) { return { ok: false, codigo: 404, erro: 'Arquivo não encontrado ou sem acesso' }; }
    const permitidas = prop('PONTE_PASTAS_PERMITIDAS').split(',').map((s) => s.trim()).filter(Boolean);
    if (!dentroDasPastas(arquivo, permitidas)) return { ok: false, codigo: 403, erro: 'Arquivo fora das pastas permitidas' };
    if (req.acao === 'meta') return { ok: true, mimeType: arquivo.getMimeType(), size: arquivo.getSize(), nome: arquivo.getName() };
    if (req.acao === 'baixar') {
      if (arquivo.getSize() > 20 * 1024 * 1024) return { ok: false, codigo: 413, erro: 'Arquivo muito grande' };
      const blob = arquivo.getBlob();
      return { ok: true, mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
    }
    if (req.acao === 'ocr') return { ok: true, texto: ocrDoDrive(req.fileId) };
    return { ok: false, codigo: 400, erro: 'Ação inválida' };
  } catch (err) {
    return { ok: false, codigo: 500, erro: String(err && err.message || err) };
  }
}
