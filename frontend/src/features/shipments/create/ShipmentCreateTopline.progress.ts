/**
 * Card 121026084623 (QA1-007): the "Bắt buộc" chip and the "Cần bổ sung N thông
 * tin" panel were two different denominators shown side by side. With the three
 * `*`-marked identity fields filled, the chip read "3/3" — done — while the panel
 * listed six more blockers.
 *
 * `validateShipmentCreate` returns the missing identity fields INSIDE its issue
 * list, so the distinct set of things blocking submission is
 * `requiredDone + issueCount`: every issue is something not yet done, on top of
 * the identity fields already completed.
 *
 * The issue list is only populated once the operator actually submits, so before
 * that `issueCount` is 0 and the denominator must still stand at the identity
 * fields themselves — otherwise the chip would read "0/0". Hence the floor.
 */
export function requiredCompletion(
  requiredDone: number,
  issueCount: number,
  identityTotal = 3,
): { done: number; total: number } {
  const done = Math.max(0, requiredDone);
  const total = Math.max(identityTotal, done + Math.max(0, issueCount));
  return { done, total };
}