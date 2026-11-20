/**
 * Provenance d'une donnée de référentiel : texte, version ou date, et
 * emplacement précis (page, article, cellule). Chaque table du paquet en
 * porte une ; un contrôle la cite dans son constat (NFR-1).
 */
export interface RefSource {
  /** Texte d'origine (« Règlement (UE) 2018/848 », « INAO-DEC-CONT-AB-4 »). */
  text: string;
  /** Version ou date du texte (« v10 du 17/09/2026 »). */
  version: string;
  /** Emplacement : article, annexe, page, ligne, cellule. */
  at: string;
}

export const cite = (s: RefSource): string => `${s.text} (${s.version}), ${s.at}`;
