import type { MultiPolygon, Point, Polygon, Position } from "geojson";
import { IsoxmlReadError, parseXml, type XmlNode } from "@fourmy/isoxml";
import { corruptFile } from "./errors.js";
import { closeRing, gmlCoordinates, lambert93, type Projection } from "./geo.js";
import { emptyBundle, type BundleCapRef, type BundleLandscapeFeature, type BundleParcel, type ImportBundle } from "./model.js";

/**
 * Lecteur du dossier PAC exporté de TelePAC (XML « Echanges-producteur »),
 * lot IM3 — claudedocs/conception_import_onboarding.md §4.1, §5.5.
 *
 * - demandeur → identité de la ferme (raison sociale, SIRET, PACAGE, courriel) ;
 * - îlots et parcelles PAC → références PAC (et parcelles, si la ferme n'en a pas) ;
 * - surfaces non agricoles (SNA) et zones de densification des haies (ZDH)
 *   → éléments du paysage déclarés ;
 * - effectifs animaux → mentionnés, non importés.
 *
 * Géométries GML 2 (`gml:coordinates`) en Lambert 93 (métropole). Surfaces
 * en ares (surface admissible, surface graphique des SNA).
 */

export type LandscapeKind = "hedge" | "tree_row" | "tree" | "grove" | "woodland" | "pond" | "ditch" | "stone_wall" | "hedge_densification" | "other";

/**
 * Types de SNA (TelePAC) → éléments du paysage. Les notices TelePAC décrivent
 * les types (haies, alignements, arbres isolés, bosquets, mares, fossés non
 * maçonnés, murs traditionnels) sans en publier les codes : la table est
 * **déduite** d'un dossier réel (2026) d'après la géométrie et la largeur de
 * chaque type. Le code d'origine est toujours gardé (`cap_type`).
 */
export const SNA_TYPES: Record<string, { kind: LandscapeKind; label: string }> = {
  V1: { kind: "tree", label: "Arbre isolé" }, // points, largeur de houppier
  V2: { kind: "tree_row", label: "Alignement d'arbres" },
  V3: { kind: "grove", label: "Bosquet" }, // compact, 50 ares au plus
  V4: { kind: "hedge", label: "Haie" }, // linéaire, largeur calculée
  V5: { kind: "woodland", label: "Bois" }, // plusieurs hectares
  B2: { kind: "ditch", label: "Fossé non maçonné" }, // linéaire
  B3: { kind: "pond", label: "Mare" }, // compact
  A2: { kind: "stone_wall", label: "Mur traditionnel en pierres" }, // linéaire
};

export const LANDSCAPE_LABELS: Record<LandscapeKind, string> = {
  hedge: "Haie",
  tree_row: "Alignement d'arbres",
  tree: "Arbre isolé",
  grove: "Bosquet",
  woodland: "Bois",
  pond: "Mare",
  ditch: "Fossé",
  stone_wall: "Mur en pierres",
  hedge_densification: "Zone de densification des haies",
  other: "Autre élément",
};

const local = (tag: string) => tag.split(":").pop()!;
const kids = (n: XmlNode | undefined, tag: string) => (n?.children ?? []).filter((c) => local(c.tag) === tag);
const kid = (n: XmlNode | undefined, tag: string) => kids(n, tag)[0];
const txt = (n: XmlNode | undefined, tag: string): string | null => kid(n, tag)?.text?.trim() || null;
const num = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null);

/** Tous les descendants d'un nom donné. */
function all(n: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) {
    if (local(c.tag) === tag) out.push(c);
    all(c, tag, out);
  }
  return out;
}

/** Décodage selon la déclaration XML (ISO-8859-1 chez TelePAC ; UTF-8 sinon). */
export function decodeXml(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 200)).toString("latin1");
  const enc = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  const label = /8859-1|latin-?1|windows-1252|cp1252/.test(enc) ? "windows-1252" : "utf-8";
  return new TextDecoder(label).decode(bytes);
}

/** Polygone GML 2 (anneau extérieur et trous). */
function polygon(n: XmlNode, project: Projection): Position[][] {
  const ring = (b: XmlNode | undefined) => {
    const c = b ? all(b, "coordinates")[0]?.text : undefined;
    return c ? closeRing(gmlCoordinates(c, project)) : null;
  };
  const outer = ring(kid(n, "outerBoundaryIs"));
  if (!outer) return [];
  return [outer, ...kids(n, "innerBoundaryIs").map(ring).filter((r): r is Position[] => !!r)];
}

/** Géométrie d'un élément `geometrie` : Polygon, MultiPolygon ou Point. */
function geometryOf(geo: XmlNode | undefined, project: Projection): Polygon | MultiPolygon | Point | null {
  if (!geo) return null;
  const point = all(geo, "Point")[0];
  if (point) {
    const c = all(point, "coordinates")[0]?.text;
    const p = c ? gmlCoordinates(c, project)[0] : undefined;
    return p ? { type: "Point", coordinates: p } : null;
  }
  const multi = all(geo, "MultiPolygon")[0];
  if (multi) {
    const polys = all(multi, "Polygon").map((p) => polygon(p, project)).filter((r) => r.length);
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  const poly = all(geo, "Polygon")[0];
  const rings = poly ? polygon(poly, project) : [];
  return rings.length ? { type: "Polygon", coordinates: rings } : null;
}

const multi = (g: Polygon | MultiPolygon | Point | null): MultiPolygon | null =>
  g?.type === "Polygon" ? { type: "MultiPolygon", coordinates: [g.coordinates] } : g?.type === "MultiPolygon" ? g : null;

export function readTelepac(bytes: Uint8Array, fileName: string): ImportBundle {
  let doc: XmlNode;
  try {
    doc = parseXml(decodeXml(bytes));
  } catch (e) {
    throw corruptFile(fileName, e instanceof IsoxmlReadError ? e.message : "XML illisible.");
  }
  const root = doc.children.find((c) => local(c.tag) === "producteurs");
  const producer = kid(root, "producteur");
  if (!producer) throw corruptFile(fileName, "élément « producteur » absent.");

  const bundle = emptyBundle("telepac");
  const xsd = producer.attrs["fichier-xsd"] ?? "";
  bundle.producedBy = xsd ? `TelePAC (${xsd})` : "TelePAC";
  // Campagne : celle du schéma d'échange (« …-export-2026-V1 »), sinon celle du nom du fichier.
  const campaign = Number(/(20\d{2})/.exec(xsd)?.[1] ?? /(20\d{2})/.exec(fileName)?.[1] ?? new Date().getFullYear());
  bundle.campaigns = [campaign];

  const applicant = kid(producer, "demandeur");
  const siret = txt(applicant, "siret");
  const pacage = producer.attrs["numero-pacage"]?.trim() ?? null;
  bundle.farm = {
    siret: siret && /^\d{14}$/.test(siret) ? siret : null,
    pacage: pacage && /^\d{9}$/.test(pacage) ? pacage : null,
    name: txt(kid(applicant, "identification-societe"), "exploitation") ?? txt(kid(applicant, "identification-individuelle"), "nom"),
    email: txt(applicant, "courriel"),
    address: null,
  };

  const project = lambert93;
  const rpg = kid(producer, "rpg");

  // --- Îlots et parcelles PAC -----------------------------------------------------
  for (const islet of kids(rpg, "ilot")) {
    const isletNumber = islet.attrs["numero-ilot"]?.trim() ?? "?";
    const isletRef = islet.attrs["numero-ilot-reference"]?.trim() || `ilot-${isletNumber}`;
    const commune = txt(islet, "commune");
    const shape = multi(geometryOf(kid(islet, "geometrie"), project));
    const isletItem: BundleCapRef = {
      kind: "islet",
      ref: isletRef,
      campaign,
      isletNumber,
      parcelNumber: null,
      capCode: null,
      admissibleAreaM2: null,
      shape,
      attrs: { commune },
    };
    bundle.capRefs.push(isletItem);
    for (const parcel of all(islet, "parcelle")) {
      const descr = kid(parcel, "descriptif-parcelle");
      const parcelNumber = descr?.attrs["numero-parcelle"]?.trim() ?? "?";
      const main = kid(descr, "culture-principale");
      const capCode = txt(main, "code-culture");
      const admissibleAres = num(txt(parcel, "surface-admissible"));
      const pShape = multi(geometryOf(kid(parcel, "geometrie"), project));
      const key = `${isletNumber}/${parcelNumber}`;
      bundle.capRefs.push({
        kind: "parcel",
        ref: `${isletRef}/${parcelNumber}`,
        campaign,
        isletNumber,
        parcelNumber,
        capCode,
        admissibleAreaM2: admissibleAres === null ? null : admissibleAres * 100,
        shape: pShape,
        attrs: { isletRef, commune, secondaryCrop: main?.attrs["culture-secondaire"] ?? null, ...(capCode ? {} : { note: "sans code culture" }) },
      });
      // Parcelle Fourmy proposée (créée seulement si la ferme n'a pas de parcelle à cet endroit).
      const parcelItem: BundleParcel = {
        key,
        landKey: key,
        secondary: false,
        campaign,
        name: `Îlot ${isletNumber} – parcelle ${parcelNumber}`,
        shape: pShape,
        areaM2: admissibleAres === null ? null : admissibleAres * 100,
        islet: isletNumber,
        inseeCode: commune,
        crop: {
          aeeCode: null,
          aeeComplement: null,
          aeeSowingPeriod: null,
          aeeUsage: null,
          capCode,
          label: capCode ? `Culture PAC ${capCode}` : "Culture PAC inconnue",
          variety: null,
          sownOn: null,
          harvestedOn: null,
          destination: null,
        },
        soil: null,
        yield: null,
        advice: null,
        spreadable: null,
        sourceIds: { "telepac.parcel": `${campaign}:${isletRef}/${parcelNumber}` },
      };
      if (!pShape) bundle.warnings.push({ level: "warning", message: `Parcelle PAC ${key} sans contour.`, ref: key });
      bundle.parcels.push(parcelItem);
    }
  }

  // --- Surfaces non agricoles (SNA) -------------------------------------------------
  for (const sna of kids(rpg, "sna-declaree")) {
    const geometry = geometryOf(kid(sna, "geometrie"), project);
    // SNA créée dans la campagne : pas encore de `numeroSna`, son numéro de création en tient lieu.
    const created = txt(sna, "numeroSnacreationTas");
    const ref = txt(sna, "numeroSna") ?? (created ? `${campaign}-creation-${created}` : null);
    if (!geometry || !ref) continue;
    const capType = txt(sna, "typeSna") ?? "?";
    const known = SNA_TYPES[capType];
    const width = num(txt(sna, "largeur")) ?? num(txt(sna, "largeur-calculee"));
    const item: BundleLandscapeFeature = {
      source: "telepac.sna",
      ref,
      category: txt(sna, "categorieSna"),
      capType,
      widthM: width,
      areaM2: num(txt(sna, "surfaceGraphique")) === null ? null : num(txt(sna, "surfaceGraphique"))! * 100,
      geometry,
      attrs: {
        kind: known?.kind ?? "other",
        label: known?.label ?? `SNA ${capType}`,
        islets: kids(kid(sna, "intersectionsSnaIlots"), "intersectionSnaIlot").map((i) => txt(i, "numeroIlot")),
        parcels: kids(kid(sna, "intersectionsSnaParcelles"), "intersectionSnaParcelle").map((i) => `${txt(i, "numeroIlot")}/${txt(i, "numeroParcelle")}`),
        updatedAt: txt(sna, "dateMiseAjour"),
      },
    };
    bundle.landscape.push(item);
  }
  const unknownTypes = [...new Set(bundle.landscape.filter((l) => !SNA_TYPES[l.capType]).map((l) => l.capType))];
  if (unknownTypes.length) bundle.warnings.push({ level: "info", message: `Types de SNA sans correspondance (gardés comme « autre élément ») : ${unknownTypes.join(", ")}.` });

  // --- Zones de densification des haies (ZDH) ---------------------------------------
  for (const zdh of kids(rpg, "zdh-declaree")) {
    const geometry = geometryOf(kid(zdh, "geometrie"), project);
    const ref = txt(zdh, "numeroZdh");
    if (!geometry || !ref) continue;
    bundle.landscape.push({
      source: "telepac.zdh",
      ref,
      category: null,
      capType: "ZDH",
      widthM: null,
      areaM2: null,
      geometry,
      attrs: { kind: "hedge_densification", label: LANDSCAPE_LABELS.hedge_densification, density: txt(zdh, "densiteVegetation") },
    });
  }

  // --- Ce que Fourmy n'importe pas ---------------------------------------------------
  for (const e of all(producer, "effectif-present")) {
    const type = e.children.find((c) => /^type-animal/.test(local(c.tag)))?.text?.trim();
    const count = Number(e.children.find((c) => /^nb-animaux/.test(local(c.tag)))?.text ?? NaN);
    if (type && Number.isFinite(count)) bundle.notImported.push({ kind: "animals", label: `Animaux déclarés (${type})`, count });
  }
  return bundle;
}
