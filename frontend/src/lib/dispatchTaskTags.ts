/**
 * Thin re-point to the shared format-v2 helpers (@tingting/shared): line 1 =
 * selected tag labels '; '-joined, remainder after the first newline = the
 * manual text. Empty parts skipped. Legacy single-line notes parse
 * identically to the previous local lib (dedicated compat coverage in
 * shared) and migrate to v2 on the next composer save — compose ∘ parse is
 * the identity on well-formed notes, so an untouched reopen+save round-trips
 * byte-identical and never bumps the shipment version.
 */
export {
  composeDriverTaskNote as composeNote,
  parseDriverTaskNote as parseNote,
} from '@tingting/shared';
