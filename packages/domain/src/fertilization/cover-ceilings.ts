/**
 * Épandage sur les couverts d'interculture (lot AM) : guide du PAR 7
 * Nouvelle-Aquitaine (16/10/2026), page 15 et tableau 4 « Apports possibles
 * avant ou pendant la présence du couvert d'interculture ». Doses maximales
 * d'apports cumulés en kg d'azote efficace par hectare.
 *
 * Fourmy ne calcule pas de dose prévisionnelle pour un couvert : là où le
 * tableau permet une dose calculée (bilan ou pivot), c'est la valeur par
 * défaut (70 kg) qui s'applique.
 */

export interface CoverSpreadingInput {
  date: string;
  /** Type du fertilisant épandu (0, Ia, Ib, II, III). */
  type: string | null;
  cover: {
    kind: "sown" | "regrowth_cereal" | "regrowth_rapeseed";
    pureLegumes: boolean;
    exported: boolean;
    sownOn: string;
    destroyedOn: string | null;
  };
  /** Interculture courte (culture suivante semée à l'automne) ou longue. */
  interculture: "short" | "long";
  zar: boolean;
  /** Zone ouest du calendrier : 50 kg au plus avant une culture d'automne. */
  west: boolean;
}

export type CoverSpreading =
  | { allowed: false; reason: string }
  | {
      allowed: true;
      /** Plafond cumulé (kg N efficace/ha) et apports cumulés : organiques seuls, ou organiques et minéraux. */
      ceiling: number;
      cumulates: "organic" | "all";
      label: string;
    };

/**
 * Dose d'un couvert exporté sans calcul de dose prévisionnelle (lot AQ) : le
 * plafond du tableau 4 en cumulant organiques et minéraux. Avec un bilan (outil
 * ou conseiller), la dose calculée s'applique, jusqu'à 100 kg pour un couvert
 * exporté l'année suivante hors ZAR.
 */
export function exportedCoverDefault(i: { sownOn: string; destroyedOn: string | null; interculture: "short" | "long"; zar: boolean; west: boolean }): { dose: number; label: string; withBilanMax: number | null } {
  const sameYear = i.destroyedOn !== null && i.destroyedOn.slice(0, 4) === i.sownOn.slice(0, 4);
  const westCap = i.west && i.interculture === "short" ? 50 : Infinity;
  if (i.zar) {
    const z = i.interculture === "short" ? 30 : sameYear ? 50 : 70;
    return { dose: Math.min(z, westCap), label: `ZAR : ${z} kg d'azote efficace au plus`, withBilanMax: Math.min(z, westCap) };
  }
  if (i.interculture === "short" || sameYear) return { dose: Math.min(70, westCap), label: "sans dose calculée : 70 kg d'azote efficace en cumulant organiques et minéraux", withBilanMax: null };
  return { dose: 70, label: "exporté l'année suivante, sans dose calculée : 70 kg (100 kg au plus avec un bilan)", withBilanMax: 100 };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function coverSpreading(i: CoverSpreadingInput): CoverSpreading {
  const c = i.cover;
  if (c.kind !== "sown") return { allowed: false, reason: `Épandage interdit sur les repousses de ${c.kind === "regrowth_cereal" ? "céréales" : "colza"} (PAR 7 Nouvelle-Aquitaine).` };
  if (c.pureLegumes) return { allowed: false, reason: "Épandage interdit sur un couvert de légumineuses pures (PAR 7 Nouvelle-Aquitaine)." };
  const start = addDays(c.sownOn, -15);
  if (i.date < start) return { allowed: false, reason: `Épandage sur couvert permis à partir de 15 jours avant son semis (${fr(start)}).` };
  if (c.destroyedOn && i.date > addDays(c.destroyedOn, -30)) return { allowed: false, reason: `Épandage sur couvert interdit dans les 30 jours avant sa destruction (à partir du ${fr(addDays(c.destroyedOn, -29))}).` };
  const mineral = i.type === "III";
  const westCap = i.west && i.interculture === "short" ? 50 : Infinity;
  const cap = (ceiling: number, cumulates: "organic" | "all", label: string): CoverSpreading => ({
    allowed: true,
    ceiling: Math.min(ceiling, westCap),
    cumulates,
    label: westCap < ceiling ? `${label} ; zone ouest, avant une culture d'automne : 50 kg` : label,
  });

  if (!c.exported) {
    // CINE : 50 kg hors ZAR pour les types I et II ; interdit en ZAR et pour le type III.
    if (mineral) return { allowed: false, reason: "Engrais minéral (type III) interdit sur un couvert non exporté (CINE)." };
    if (i.zar) return { allowed: false, reason: "En ZAR, épandage interdit sur un couvert non exporté (CINE)." };
    return cap(50, "organic", "CINE hors ZAR, types I et II : 50 kg d'azote efficace");
  }
  const sameYear = c.destroyedOn !== null && c.destroyedOn.slice(0, 4) === c.sownOn.slice(0, 4);
  if (i.interculture === "short" || sameYear) {
    // CIE d'interculture courte, ou longue exportée avant la fin de l'année.
    if (mineral) {
      if (i.zar) return { allowed: false, reason: "En ZAR, engrais minéral (type III) interdit sur ce couvert exporté." };
      if (sameYear && i.interculture === "long" && i.date.slice(5, 10) >= "10-15")
        return { allowed: false, reason: "Engrais minéral (type III) interdit à partir du 15 octobre sur un couvert exporté avant la fin de l'année." };
      return cap(70, "all", "CIE, type III sans dose calculée : 70 kg d'azote efficace en cumulant organiques et minéraux");
    }
    if (i.zar) return cap(i.interculture === "short" ? 30 : 50, "organic", `CIE en ZAR, types I et II : ${i.interculture === "short" ? 30 : 50} kg d'azote efficace`);
    return cap(70, "organic", "CIE hors ZAR, types I et II : 70 kg d'azote efficace");
  }
  // CIE d'interculture longue exportée l'année suivante.
  if (mineral && i.zar && i.date < `${Number(c.sownOn.slice(0, 4)) + 1}-02-01`)
    return { allowed: false, reason: "En ZAR, engrais minéral (type III) interdit sur un couvert exporté avant le 1er février." };
  return cap(70, "all", `CIE exportée l'année suivante${i.zar ? " en ZAR" : " sans dose calculée"} : 70 kg d'azote efficace en cumulant organiques et minéraux`);
}
