// Digest the UI-verify log into a compact per-defect summary.
import { readFileSync, writeFileSync } from 'node:fs';
const log = readFileSync(process.argv[2], 'utf8');
const lines = log.split('\n');
const out = [];
for (const line of lines) {
  if (line.startsWith('UI-01')) {
    const arr = JSON.parse(line.slice('UI-01 measure '.length));
    for (const col of arr) {
      out.push(`UI-01 ${col.header}: found=${col.found} hdr='${col.headerText ?? ''}' hdrClip=${col.headerClipped} ${col.headerScrollW}/${col.headerClientW} tableOverflowRight=${col.tableOverflowRight} clippedCells=${col.clippedCells}`);
      for (const c of (col.sampleClipped ?? [])) out.push(`   CLIP '${c.text}' ${c.scrollW}/${c.clientW} ov=${c.overflow}/${c.textOverflow}/${c.whiteSpace}`);
      for (const c of (col.sampleFirst ?? [])) out.push(`   first '${c.text}' ${c.scrollW}/${c.clientW}`);
    }
  }
  if (line.startsWith('UI-02')) {
    const m = JSON.parse(line.slice('UI-02 measure '.length));
    for (const t of m.tables) {
      out.push(`UI-02 table heads=[${t.heads.join(' | ')}] overflowRight=${t.tableOverflowRight}`);
      if (t.lapPhieu) {
        out.push(`   LậpPhiếu hdrClip=${t.lapPhieu.headerClipped}`);
        for (const c of t.lapPhieu.cells) out.push(`   cell '${c.text}' clip=${c.clipped} cellRight=${c.cellRight} tableRight=${c.tableRight} btn='${c.btnText}' btnClip=${c.btnClipped} btnRect=${JSON.stringify(c.btnRect)}`);
      }
    }
  }
  if (line.startsWith('UI-03')) {
    const arr = JSON.parse(line.slice('UI-03 measure '.length));
    for (const col of arr) out.push(`UI-03 ${col.header}: found=${col.found} hdrClip=${col.headerClipped} ${col.headerScrollW}/${col.headerClientW} tableOverflowRight=${col.tableOverflowRight} clippedCells=${col.clippedCells} first=${JSON.stringify((col.sampleFirst ?? []).map(c => c.text + ' ' + c.scrollW + '/' + c.clientW))}`);
  }
  if (line.startsWith('UI-04')) {
    const arr = JSON.parse(line.slice('UI-04 measure '.length));
    for (const col of arr) out.push(`UI-04 ${col.header}: found=${col.found} hdrClip=${col.headerClipped} ${col.headerScrollW}/${col.headerClientW} tableOverflowRight=${col.tableOverflowRight} clippedCells=${col.clippedCells} first=${JSON.stringify((col.sampleFirst ?? []).map(c => c.text + ' ' + c.scrollW + '/' + c.clientW))} clipped=${JSON.stringify((col.sampleClipped ?? []).map(c => c.text + ' ' + c.scrollW + '/' + c.clientW))}`);
  }
}
writeFileSync(process.argv[3], out.join('\n') + '\n');
console.log(out.join('\n'));
