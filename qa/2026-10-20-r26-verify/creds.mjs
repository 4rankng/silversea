// Staging credentials live ONLY in testplan/testaccounts.txt (repo rule:
// never duplicate the accounts elsewhere). Drivers resolve the shared staging
// password from there at runtime instead of embedding it in this artifact.
import fs from 'node:fs';
import path from 'node:path';

export function stagingPassword(root = path.resolve(import.meta.dirname, '../..')) {
  const file = path.join(root, 'testplan', 'testaccounts.txt');
  const txt = fs.readFileSync(file, 'utf8');
  const idx = txt.indexOf('\nstaging:');
  const segment = idx >= 0 ? txt.slice(idx) : txt;
  const match = segment.match(/^[ \t]*password:[ \t]*(\S+)/m);
  if (!match) throw new Error(`staging password not found in ${file}`);
  return match[1];
}
