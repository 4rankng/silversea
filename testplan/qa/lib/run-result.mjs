/** A topic is verified only when every planned case actually passes. */
export function runExitCode(results) {
  return results.length > 0 && results.every((result) => result?.verdict === 'PASS') ? 0 : 1;
}
