import { getProcedure, SHAPE_ICONS } from "@fourmy/contracts";
import { AGRIC_GLYPHS } from "../icons/agric";

/**
 * Icône d'une procédure (jeu Agric d'Ekylibre, exigence INT-UI-1). Prend la
 * couleur du texte. Décorative par défaut (le libellé est à côté) ; avec
 * `title`, elle est annoncée aux lecteurs d'écran.
 */
export function ProcedureIcon({ procedure, size = 20, title }: { procedure: string; size?: number; title?: string }) {
  const p = getProcedure(procedure);
  const glyph = AGRIC_GLYPHS[p.icon] ?? AGRIC_GLYPHS[SHAPE_ICONS[p.shape]]!;
  return (
    <svg
      viewBox={`0 0 ${glyph.w} ${glyph.h}`}
      width={size}
      height={size}
      fill="currentColor"
      style={{ flexShrink: 0, verticalAlign: "middle" }}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: false })}
      data-icon={p.icon}
    >
      {title && <title>{title}</title>}
      <path d={glyph.d} />
    </svg>
  );
}
