/**
 * Deterministic match identifier generators.
 * IDs encode structural position so they can be reconstructed from bracket
 * metadata without querying every match document.
 */

/** Single-elim / group-KO knockout match: "{categoryId}-R{round}-{slotIndex}" */
export function matchId(
  categoryId: string,
  round: number,
  slotIndex: number,
): string {
  return `${categoryId}-R${round}-${slotIndex}`;
}

/** Within-group round-robin match: "{categoryId}-G{groupKey}-M{matchIndex}" */
export function groupMatchId(
  categoryId: string,
  groupKey: string,
  matchIndex: number,
): string {
  return `${categoryId}-G${groupKey}-M${matchIndex}`;
}

/** Pure round-robin (no groups): "{categoryId}-RR-{matchIndex}" */
export function rrMatchId(categoryId: string, matchIndex: number): string {
  return `${categoryId}-RR-${matchIndex}`;
}
