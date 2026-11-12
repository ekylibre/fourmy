import { z } from "zod";
import { isoDate, uuid } from "./primitives.js";
import { person } from "./entities/interventions.js";

/**
 * Équipe et personnes, lot P1 (docs/equipe-personnes-design.md §3, §4) :
 * la personne porte l'identité, la photo, le Certiphyto ; ses données
 * personnelles (`private`) ne sont envoyées qu'au responsable et à elle-même.
 */

/** Rôle d'un compte sur la ferme. */
export const memberRole = z.enum(["owner", "worker", "reader"]);
export type MemberRole = z.infer<typeof memberRole>;
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = { owner: "Responsable", worker: "Salarié", reader: "Lecture seule" };

export const certiphytoCategory = z.enum(["decideur_entreprise", "decideur_prestation", "operateur", "conseil", "vente"]);
export type CertiphytoCategory = z.infer<typeof certiphytoCategory>;
export const CERTIPHYTO_CATEGORY_LABELS: Record<CertiphytoCategory, string> = {
  decideur_entreprise: "Décideur en entreprise non soumise à agrément",
  decideur_prestation: "Décideur en entreprise soumise à agrément",
  operateur: "Opérateur",
  conseil: "Conseil",
  vente: "Mise en vente, vente",
};

export const contractType = z.enum(["farmer", "permanent", "fixed_term", "seasonal", "apprentice", "volunteer", "contractor"]);
export type ContractType = z.infer<typeof contractType>;
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  farmer: "Exploitant",
  permanent: "CDI",
  fixed_term: "CDD",
  seasonal: "Saisonnier",
  apprentice: "Apprenti",
  volunteer: "Bénévole",
  contractor: "Prestataire",
};

export const certiphytoStatus = z.enum(["none", "valid", "expiring", "expired"]);
export type CertiphytoStatus = z.infer<typeof certiphytoStatus>;
/** Jours avant la fin de validité où le Certiphyto passe en alerte. */
export const CERTIPHYTO_ALERT_DAYS = 90;

/** État du Certiphyto à une date (AAAA-MM-JJ) : expiré, expire dans moins de 90 jours, valide. */
export function certiphytoStatusAt(validUntil: string | null | undefined, at: string): CertiphytoStatus {
  if (!validUntil) return "none";
  const day = at.slice(0, 10);
  if (validUntil < day) return "expired";
  const alert = new Date(Date.parse(`${day}T00:00:00Z`) + CERTIPHYTO_ALERT_DAYS * 86_400_000).toISOString().slice(0, 10);
  return validUntil < alert ? "expiring" : "valid";
}

export const accountStatus = z.enum(["none", "invited", "active"]);
export const personAccount = z.object({ status: accountStatus, role: memberRole.nullable() });

/** Pavé de la grille Équipe : visible de tous les membres. */
export const personCard = person.extend({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  photo: z.object({ hash: z.string() }).nullable(),
  account: personAccount,
  certiphyto: z.object({ status: certiphytoStatus, validUntil: isoDate.nullable() }),
  /** Heures du mois de la frise (lot P2) ; null tant qu'elles ne sont pas calculées. */
  monthHours: z.number().nullable(),
  /** Dernière intervention réalisée jusqu'à la frise (lot P2). */
  lastIntervention: z.object({ id: uuid, date: isoDate, procedure: z.string() }).nullable(),
});
export type PersonCard = z.infer<typeof personCard>;

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional();

export const personAddress = z.object({
  line1: optionalText(120),
  line2: optionalText(120),
  postalCode: optionalText(12),
  city: optionalText(80),
  country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
});

/** Données personnelles : responsable et personne elle-même seulement. */
export const personPrivate = z.object({
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  address: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
  }),
  birthDate: isoDate.nullable(),
  contract: z.object({ type: contractType.nullable(), startedOn: isoDate.nullable(), endedOn: isoDate.nullable() }),
});
export type PersonPrivate = z.infer<typeof personPrivate>;

/** Fiche d'une personne : `private` est absent quand le lecteur n'y a pas droit. */
export const personSheet = personCard.extend({
  certiphyto: z.object({
    status: certiphytoStatus,
    category: certiphytoCategory.nullable(),
    number: z.string().nullable(),
    validUntil: isoDate.nullable(),
  }),
  external: z.object({ ekylibre: z.boolean() }),
  /** Le lecteur peut modifier les coordonnées (responsable, ou sa propre fiche). */
  canEditContact: z.boolean(),
  private: personPrivate.optional(),
});
export type PersonSheet = z.infer<typeof personSheet>;

const mobile = z
  .string()
  .trim()
  .regex(/^[0-9 +().-]{4,30}$/, "Numéro de portable invalide")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

/** Coordonnées : ce que la personne peut modifier elle-même. */
export const personContactWrite = z.object({
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional().or(z.literal("").transform(() => null)),
  mobile,
  address: personAddress.optional(),
});

/** Création ou modification par le responsable. */
export const personProfileWrite = z.object({
  firstName: optionalText(80),
  lastName: optionalText(80),
  /** Nom affiché quand ni prénom ni nom ne sont saisis. */
  name: text(200).optional(),
  active: z.boolean().optional(),
  certiphyto: z
    .object({ category: certiphytoCategory.nullable().optional(), number: optionalText(40), validUntil: isoDate.nullable().optional() })
    .optional(),
  private: personContactWrite
    .extend({
      birthDate: isoDate.nullable().optional(),
      contract: z
        .object({ type: contractType.nullable().optional(), startedOn: isoDate.nullable().optional(), endedOn: isoDate.nullable().optional() })
        .refine((c) => !c.startedOn || !c.endedOn || c.startedOn <= c.endedOn, "La fin du contrat doit suivre son début.")
        .optional(),
    })
    .optional(),
});
export type PersonProfileWrite = z.infer<typeof personProfileWrite>;

/** Nom affiché : « Prénom Nom », sinon le nom saisi. */
export function displayName(p: { firstName?: string | null; lastName?: string | null; name?: string | null }): string {
  const full = [p.firstName, p.lastName].map((s) => s?.trim()).filter(Boolean).join(" ");
  return full || p.name?.trim() || "";
}

// ---------------------------------------------------------------------------
// Temps de travaux (lot P2, design §5)
// ---------------------------------------------------------------------------

const bucket = z.object({ from: isoDate, to: isoDate, hours: z.number() });

/** Résumé des heures d'une personne à la date de la frise. */
export const personWork = z.object({
  at: isoDate,
  periods: z.object({
    week: bucket,
    month: bucket,
    campaign: bucket.extend({ label: z.string() }),
    last12: bucket,
  }),
  /** 12 derniers mois, du plus ancien au plus récent. */
  byMonth: z.array(z.object({ month: z.string(), hours: z.number() })),
  /** Sur la campagne : au prorata des surfaces travaillées ; null = sans activité. */
  byActivity: z.array(z.object({ activityId: uuid.nullable(), name: z.string(), hours: z.number() })),
  byProcedure: z.array(z.object({ procedure: z.string(), hours: z.number() })),
});
export type PersonWork = z.infer<typeof personWork>;

/** Une intervention de la personne, avec sa part d'heures. */
export const personIntervention = z.object({
  id: uuid,
  date: isoDate,
  procedure: z.string(),
  hours: z.number(),
  parcels: z.array(z.string()),
  equipments: z.array(z.string()),
});
export type PersonIntervention = z.infer<typeof personIntervention>;
