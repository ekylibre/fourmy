import type { StockMovement, ContainerContents, LotLineage } from "@fourmy/contracts";

/**
 * Stocks et contenu des cuves (architecture §4.4).
 * Le stock est la **somme des mouvements** jusqu'à une date ; une correction
 * se fait par contre-passation, jamais par mutation. Fonctions pures.
 */

type Loc = { placeId: string | null; containerId: string | null };

function locKey(m: Loc): string {
  return `${m.placeId ?? ""}|${m.containerId ?? ""}`;
}

export interface StockLine {
  lotId: string;
  placeId: string | null;
  containerId: string | null;
  quantity: number;
  unit: string;
}

/** Stock par (lot, lieu) à la date `at` : somme des mouvements ≤ at. */
export function computeStock(
  movements: StockMovement[],
  at: string,
): StockLine[] {
  const acc = new Map<string, StockLine>();
  for (const m of movements) {
    if (m.occurredAt > at) continue;
    const key = `${m.lotId}|${locKey(m)}|${m.unit}`;
    const line = acc.get(key);
    if (line) {
      line.quantity += m.quantity;
    } else {
      acc.set(key, {
        lotId: m.lotId,
        placeId: m.placeId,
        containerId: m.containerId,
        quantity: m.quantity,
        unit: m.unit,
      });
    }
  }
  return [...acc.values()].filter((l) => l.quantity !== 0);
}

/**
 * Contenu d'une cuve à une date (US-9) : volume total, composition par lot
 * (parts), et derniers mouvements. La composition fine (cépages, millésime)
 * se déduit de `lot_lineage` via {@link resolveComposition}.
 */
export function computeContainerContents(
  containerId: string,
  movements: StockMovement[],
  at: string,
): ContainerContents {
  const inContainer = movements
    .filter((m) => m.containerId === containerId && m.occurredAt <= at)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const byLot = new Map<string, number>();
  for (const m of inContainer) {
    byLot.set(m.lotId, (byLot.get(m.lotId) ?? 0) + m.quantity);
  }

  let volumeL = 0;
  for (const q of byLot.values()) volumeL += Math.max(q, 0);

  const composition = [...byLot.entries()]
    .filter(([, q]) => q > 0)
    .map(([lotId, q]) => ({
      lotId,
      lotCode: lotId,
      share: volumeL > 0 ? q / volumeL : 0,
      attrs: undefined,
    }));

  const lastMovements = inContainer
    .slice(-5)
    .reverse()
    .map((m) => ({ occurredAt: m.occurredAt, quantityL: m.quantity, cause: m.cause }));

  return { containerId, at, volumeL, composition, lastMovements };
}

/**
 * Déplie la filiation des lots (assemblages viticoles) en parts d'origine.
 * Ex. un lot assemblé 60/40 remonte vers ses lots parents récursivement.
 */
export function resolveComposition(
  lotId: string,
  lineage: LotLineage[],
): Record<string, number> {
  const parents = lineage.filter((l) => l.childLotId === lotId);
  if (parents.length === 0) return { [lotId]: 1 };
  const out: Record<string, number> = {};
  for (const p of parents) {
    const sub = resolveComposition(p.parentLotId, lineage);
    for (const [root, share] of Object.entries(sub)) {
      out[root] = (out[root] ?? 0) + share * p.share;
    }
  }
  return out;
}
