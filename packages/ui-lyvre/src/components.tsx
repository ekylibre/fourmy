import type { CSSProperties } from "react";

/** Logotype « fourmy » (y en lichen, ou paille sur fond sombre). */
export function Wordmark({ onDark = false, style }: { onDark?: boolean; style?: CSSProperties }) {
  return (
    <span className="fy-wordmark" data-on-dark={onDark || undefined} style={style} aria-label="Fourmy">
      fourm<span>y</span>
    </span>
  );
}

/**
 * Jauge de cuve : volume / capacité. Accessible (role="meter"), le libellé
 * donne les valeurs exactes. Au-delà de 95 %, remplissage en paille.
 */
export function TankGauge({ volumeL, capacityL, height = 72 }: { volumeL: number; capacityL: number; height?: number }) {
  const ratio = capacityL > 0 ? Math.min(Math.max(volumeL / capacityL, 0), 1) : 0;
  const pct = Math.round(ratio * 100);
  return (
    <div
      className="fy-gauge"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={capacityL}
      aria-valuenow={Math.max(volumeL, 0)}
      aria-label={`${pct} % (${formatLiters(volumeL)} sur ${formatLiters(capacityL)})`}
      data-full={ratio >= 0.95 || undefined}
      style={{ height }}
    >
      <div className="fy-gauge-fill" style={{ height: `${pct}%` }} />
    </div>
  );
}

/** « 3 000 L », « 12,5 hL » au-delà de 100 L — chiffres français. */
export function formatLiters(l: number): string {
  if (Math.abs(l) >= 100) return `${(l / 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} hL`;
  return `${l.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} L`;
}

/** Surface en hectares, à partir de m². */
export function formatHa(m2: number): string {
  return `${(m2 / 10_000).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
}
