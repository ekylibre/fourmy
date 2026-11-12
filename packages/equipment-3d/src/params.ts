/**
 * Paramètres de l'avatar 3D d'un matériel (docs/materiels-entretien-design.md
 * §10.1) : saisie > fiche technique > défaut du gabarit, avec la provenance
 * de chaque valeur. Fonctions pures (API et navigateur).
 */

export const AVATAR_TEMPLATES = [
  "tractor",
  "self_propelled",
  "sower",
  "rotary_harrow",
  "plough",
  "mounted_sprayer",
  "fertilizer_spreader",
  "disc_harrow",
  "roller",
  "mounted_tool",
  "trailed_tool",
  "trailed_sprayer",
  "trailer",
  "box",
] as const;
export type AvatarTemplate = (typeof AVATAR_TEMPLATES)[number];

export const AVATAR_TEMPLATE_LABELS: Record<AvatarTemplate, string> = {
  tractor: "Tracteur",
  self_propelled: "Automoteur",
  trailed_tool: "Outil traîné",
  trailed_sprayer: "Pulvérisateur traîné",
  sower: "Semoir monograine",
  rotary_harrow: "Herse rotative",
  plough: "Charrue",
  mounted_sprayer: "Pulvérisateur porté",
  fertilizer_spreader: "Distributeur d'engrais",
  disc_harrow: "Déchaumeur à disques",
  roller: "Rouleau",
  mounted_tool: "Outil porté à dents",
  trailer: "Remorque",
  box: "Équipement fixe",
};

export interface AvatarParams {
  template: AvatarTemplate;
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Tracteur, automoteur : empattement. */
  wheelbaseM: number;
  frontWheelDiameterM: number;
  rearWheelDiameterM: number;
  /** Outils : largeur de travail (attelage, FR-MAT-85). */
  workingWidthM: number;
  /** Tracteur : de l'essieu arrière au point d'attelage ; outil : longueur de la flèche. */
  hitchOffsetM: number;
  colors: { body: string; cab: string; wheels: string; accent: string };
  logo: "sides" | "none";
}

export type Provenance = "input" | "technical" | "default";
export type AvatarInput = Partial<Omit<AvatarParams, "colors">> & { colors?: Partial<AvatarParams["colors"]> };

const DEFAULTS: Record<AvatarTemplate, Omit<AvatarParams, "template" | "colors" | "logo">> = {
  tractor: { lengthM: 4.6, widthM: 2.3, heightM: 2.9, wheelbaseM: 2.5, frontWheelDiameterM: 1.25, rearWheelDiameterM: 1.6, workingWidthM: 0, hitchOffsetM: 1.1 },
  self_propelled: { lengthM: 7.5, widthM: 3, heightM: 3.6, wheelbaseM: 3.8, frontWheelDiameterM: 1.7, rearWheelDiameterM: 1.3, workingWidthM: 0, hitchOffsetM: 0 },
  trailed_tool: { lengthM: 3, widthM: 3, heightM: 1.3, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0.8, workingWidthM: 3, hitchOffsetM: 1.5 },
  trailed_sprayer: { lengthM: 5.5, widthM: 2.5, heightM: 2.6, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 1.5, workingWidthM: 24, hitchOffsetM: 1.8 },
  mounted_tool: { lengthM: 1.9, widthM: 3, heightM: 1.1, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 3, hitchOffsetM: 0 },
  sower: { lengthM: 1.6, widthM: 3, heightM: 1.6, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 3, hitchOffsetM: 0 },
  rotary_harrow: { lengthM: 1.7, widthM: 3, heightM: 1.2, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 3, hitchOffsetM: 0 },
  plough: { lengthM: 4, widthM: 1.8, heightM: 1.6, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 1.6, hitchOffsetM: 0 },
  mounted_sprayer: { lengthM: 1.6, widthM: 2.5, heightM: 2, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 12, hitchOffsetM: 0 },
  fertilizer_spreader: { lengthM: 1.3, widthM: 2.3, heightM: 1.35, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 24, hitchOffsetM: 0 },
  disc_harrow: { lengthM: 4, widthM: 3.2, heightM: 1.2, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0.8, workingWidthM: 3.2, hitchOffsetM: 1.3 },
  roller: { lengthM: 1.3, widthM: 3, heightM: 1, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 3, hitchOffsetM: 0 },
  trailer: { lengthM: 6, widthM: 2.5, heightM: 2.4, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 1.1, workingWidthM: 0, hitchOffsetM: 1.6 },
  box: { lengthM: 2, widthM: 2, heightM: 2, wheelbaseM: 0, frontWheelDiameterM: 0, rearWheelDiameterM: 0, workingWidthM: 0, hitchOffsetM: 0 },
};
const DEFAULT_COLORS: AvatarParams["colors"] = { body: "#7A8C80", cab: "#2B3A42", wheels: "#1E1E1E", accent: "#C9CDC9" };
/** Tracteur : couleurs du dessin « tracteur bleu » du kit Ekylibre (carrosserie turquoise, vitres teintées, pneus bordeaux, jantes orangées). */
const TRACTOR_COLORS: AvatarParams["colors"] = { body: "#3FBEE0", cab: "#5C2930", wheels: "#4F1F26", accent: "#E89E00" };

/**
 * Gabarit d'un outil d'après son nom ou son modèle : la reprise d'Ekylibre ne
 * donne souvent que « trailed_equipment ». Proposition seulement : la fiche
 * permet d'en choisir un autre. null si rien ne se reconnaît.
 */
export function templateFromName(text: string | null | undefined): AvatarTemplate | null {
  if (!text) return null;
  const t = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const rules: [RegExp, AvatarTemplate][] = [
    [/semoir|monosem|\bng ?\+|maxima|planter|precea|optima|seeder|\bdrill/, "sower"],
    [/herse rot|rotative|\btigre\b|maschio|power harrow|\bhr ?\d/, "rotary_harrow"],
    [/charrue|gregoire|besson|\brb ?\d|lemken|kverneland|plough|\bplow/, "plough"],
    [/pulve|sprayer|\buf ?\d|tecnoma|berthoud|hardi/, "mounted_sprayer"],
    [/engrais|epandeur|\bzav?\b|\bza-?[mvx]|bogballe|sulky|rauch|vicon/, "fertilizer_spreader"],
    [/dechaumeur|disques|discover|cover.?crop|carrier|rubin|\bxs ?\d/, "disc_harrow"],
    [/rouleau|croskill|cultipacker/, "roller"],
    [/vibroculteur|cultivateur|chisel|scarificateur|herse a dents|canadien/, "mounted_tool"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? null;
}

/** Largeur de travail écrite dans le nom (« Lansaman 4.5m », « 3 m ») ; null sinon. */
export function widthFromName(text: string | null | undefined): number | null {
  const m = text?.match(/(\d+(?:[.,]\d+)?)\s?m\b/i);
  const v = m ? Number(m[1]!.replace(",", ".")) : NaN;
  return v >= 0.5 && v <= 60 ? v : null;
}

/** Gabarit déduit de la nature Ekylibre du matériel. */
export function templateForKind(kind: string): AvatarTemplate {
  if (kind === "tractor") return "tractor";
  if (kind === "self_propelled_equipment") return "self_propelled";
  if (kind === "fixed_equipment" || kind === "connected_object") return "box";
  if (/sprayer|pulv/i.test(kind)) return "trailed_sprayer";
  if (/trailer|remorque/i.test(kind)) return "trailer";
  return "trailed_tool";
}

/**
 * Diamètre d'une roue depuis la désignation du pneu : métrique
 * « 540/65 R30 » = 30 × 25,4 mm + 2 × 540 × 0,65 mm ; en pouces
 * « 16.9 R38 » (série 85 implicite). La monte métrique entre parenthèses
 * l'emporte.
 */
export function tyreDiameterM(designation: string | null | undefined): number | null {
  if (!designation) return null;
  const metric = designation.match(/(\d{3})\s*\/\s*(\d{2})\s*[RB-]\s*(\d{2})/i);
  if (metric) return round((Number(metric[3]) * 25.4 + 2 * Number(metric[1]) * (Number(metric[2]) / 100)) / 1000);
  const inch = designation.match(/(\d{1,2}(?:[.,]\d)?)\s*[R-]\s*(\d{2})/i);
  if (inch) {
    const width = Number(inch[1]!.replace(",", ".")) * 25.4;
    return round((Number(inch[2]) * 25.4 + 2 * width * 0.85) / 1000);
  }
  return null;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Valeur numérique d'un champ de fiche technique (`{ valeur, unite }`), en mètres. */
function techMeters(technical: unknown, group: string, key: string): number | null {
  const f = (technical as Record<string, Record<string, { valeur?: unknown; unite?: string | null }>> | null)?.[group]?.[key];
  if (!f || f.valeur === null || f.valeur === undefined) return null;
  const raw = typeof f.valeur === "number" ? f.valeur : Number(String(f.valeur).split("/")[0]!.trim().replace(",", "."));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const unit = (f.unite ?? "mm").toLowerCase();
  return round(unit === "m" ? raw : unit === "cm" ? raw / 100 : raw / 1000);
}
const techText = (technical: unknown, group: string, key: string): string | null => {
  const v = (technical as Record<string, Record<string, { valeur?: unknown }>> | null)?.[group]?.[key]?.valeur;
  return typeof v === "string" ? v : null;
};

export interface ResolvedAvatar {
  params: AvatarParams;
  provenance: Record<string, Provenance>;
  /** Empreinte stable des paramètres (et du logo) : ETag, cache. */
  hash: string;
}

/** Paramètres de l'avatar : saisie > fiche technique > défaut du gabarit. */
export function resolveAvatar(input: {
  kind: string;
  /** Nom et modèle du matériel : proposent un gabarit d'outil et une largeur de travail. */
  name?: string | null;
  technical?: unknown;
  brandColor?: string | null;
  saved?: AvatarInput | null;
  logoId?: string | null;
}): ResolvedAvatar {
  const saved = input.saved ?? {};
  const byKind = templateForKind(input.kind);
  const byName = byKind === "trailed_tool" || byKind === "trailed_sprayer" ? templateFromName(input.name) : null;
  const template = saved.template ?? byName ?? byKind;
  const d = DEFAULTS[template];
  const t = input.technical;
  const fromTech: Partial<Record<keyof typeof d, number | null>> =
    template === "tractor" || template === "self_propelled"
      ? (() => {
          const rear = tyreDiameterM(techText(t, "pneumatiques", "arriere_monte_base"));
          const cabFromAxle = techMeters(t, "dimensions", "hauteur_cabine_depuis_axe_ar");
          return {
            lengthM: techMeters(t, "dimensions", "longueur"),
            widthM: techMeters(t, "dimensions", "largeur_max_arriere") ?? techMeters(t, "dimensions", "largeur_min") ?? techMeters(t, "dimensions", "largeur_cabine"),
            heightM: cabFromAxle !== null && rear !== null ? round(cabFromAxle + rear / 2) : techMeters(t, "dimensions", "hauteur"),
            wheelbaseM: techMeters(t, "dimensions", "empattement"),
            frontWheelDiameterM: tyreDiameterM(techText(t, "pneumatiques", "avant_monte_base")),
            rearWheelDiameterM: rear,
          };
        })()
      : {
          lengthM: techMeters(t, "dimensions", "longueur"),
          widthM: techMeters(t, "dimensions", "largeur") ?? widthFromName(input.name),
          heightM: techMeters(t, "dimensions", "hauteur"),
          workingWidthM: techMeters(t, "dimensions", "largeur_travail") ?? widthFromName(input.name),
        };
  const provenance: Record<string, Provenance> = { template: saved.template ? "input" : "default" };
  const pick = <K extends keyof typeof d>(k: K): number => {
    const s = saved[k];
    if (typeof s === "number" && s > 0) {
      provenance[k] = "input";
      return s;
    }
    const tv = fromTech[k];
    if (typeof tv === "number" && tv > 0) {
      provenance[k] = "technical";
      return tv;
    }
    provenance[k] = "default";
    return d[k];
  };
  const dims = Object.fromEntries((Object.keys(d) as (keyof typeof d)[]).map((k) => [k, pick(k)])) as typeof d;
  const color = (k: keyof AvatarParams["colors"]) => {
    const s = saved.colors?.[k];
    if (s && /^#[0-9a-f]{6}$/i.test(s)) {
      provenance[`colors.${k}`] = "input";
      return s;
    }
    if (k === "body" && input.brandColor && /^#[0-9a-f]{6}$/i.test(input.brandColor)) {
      provenance["colors.body"] = "technical";
      return input.brandColor;
    }
    provenance[`colors.${k}`] = "default";
    return (template === "tractor" ? TRACTOR_COLORS : DEFAULT_COLORS)[k];
  };
  const params: AvatarParams = {
    template,
    ...dims,
    colors: { body: color("body"), cab: color("cab"), wheels: color("wheels"), accent: color("accent") },
    logo: saved.logo ?? "sides",
  };
  provenance.logo = saved.logo ? "input" : "default";
  return { params, provenance, hash: fnv(JSON.stringify(params) + (input.logoId ?? "")) };
}

/** Empreinte FNV-1a 32 bits (hexadécimal), sans dépendance. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
