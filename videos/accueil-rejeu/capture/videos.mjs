// Les boucles tournées avec ces scripts : `VIDEO=<nom>` choisit la boucle (pulverisation par défaut).
// FROM, SECONDS, RANGE, PITCH, DH et ORBIT remplacent au besoin les réglages de la boucle.
export const VIDEOS = {
  pulverisation: {
    intervention: "68e602b1-a7db-4efa-a5e3-97fc522684f1",
    jour: "2026-10-05",
    fuseau: "+02:00",
    debut: "16:46:20",
    camera: { range: 56, pitch: -0.4, dh: 0.45, orbit: 0.35 },
    donnees: "intervention",
    sortie: "accueil-pulverisation",
    affiche: "accueil-3d",
    titre: "Pulvérisation",
    couleur: "#7B2CBF", // SWATH_COLORS.treatment (apps/web/src/3d/replay.ts)
    outil: "Rampe",
    participe: "traités",
    culture: "maïs",
  },
  broyage: {
    intervention: "e92d6478-7d7a-46a9-bba6-66ba16d509b6",
    jour: "2026-10-28",
    fuseau: "+01:00",
    debut: "14:07:00",
    camera: { range: 40, pitch: -0.4, dh: 0.45, orbit: 0.35 },
    donnees: "broyage",
    sortie: "accueil-broyage",
    affiche: "accueil-broyage",
    titre: "Broyage",
    couleur: "#E85D04", // SWATH_COLORS.work
    outil: "Broyeur",
    participe: "broyés",
    culture: "prairie permanente",
  },
};

const v = VIDEOS[process.env.VIDEO ?? "pulverisation"];
if (!v) throw new Error(`VIDEO inconnue : ${process.env.VIDEO} (${Object.keys(VIDEOS).join(", ")})`);
const num = (k, d) => (process.env[k] === undefined ? d : Number(process.env[k]));
export const video = {
  ...v,
  debut: process.env.FROM ?? v.debut,
  secondes: num("SECONDS", 200),
  camera: { range: num("RANGE", v.camera.range), pitch: num("PITCH", v.camera.pitch), dh: num("DH", v.camera.dh), orbit: num("ORBIT", v.camera.orbit) },
};
/** Instant local de la journée filmée (`hh:mm[:ss]`) en millisecondes. */
export const instant = (hms) => Date.parse(`${video.jour}T${hms}${video.fuseau}`);
