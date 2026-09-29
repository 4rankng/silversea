import './OpsExpenseNoteLines.css';

interface OpsExpenseNoteLinesProps {
  /** The OPS expense-note family from `loadDispatchExpenseNotes`: the
   *  not-charged reason (card 20260928_162) foremost, plus recovery notes
   *  and charged fee names. The projection guarantees free text only — no
   *  amount or fund detail ever rides this list. */
  notes?: readonly string[];
}

/**
 * Card 20260928_162 — the ONE rendering of the OPS expense-note family.
 *
 * Both ruled surfaces (the dispatch plan grids and the phơi-phiếu board)
 * render these lines through this component, so the reason of a not-charged
 * cost line reads identically wherever kế toán / CUS triage it. Lines wrap
 * and keep their stored line breaks (design law §4: a data cell wraps, never
 * clips); blank entries render nothing at all.
 *
 * House primitive, chosen with the vendored Untitled UI PRO (v8) inventory
 * open: the catalog has no multi-line note-cell family (its `tooltip`
 * primitive hides text behind a hover, which is the opposite of what the
 * ruling wants — the reason must be readable, not discoverable), so the
 * sanctioned wrapping note line from the operational table typography is the
 * one answer here.
 */
export function OpsExpenseNoteLines({ notes }: OpsExpenseNoteLinesProps) {
  const visible = notes?.filter((note) => note.trim().length > 0) ?? [];
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((note) => (
        <p key={note} className="ops-expense-note-line">
          <strong>OPS: </strong>{note}
        </p>
      ))}
    </>
  );
}
