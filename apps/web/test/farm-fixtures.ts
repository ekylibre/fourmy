import type { FarmDisplay } from "@fourmy/contracts";

/** Fiche « Ma ferme » de démonstration, préférences d'affichage au choix. */
export const demoFarmProfileFor = (display: Partial<FarmDisplay> = {}) => ({
  identity: { name: "Ferme de démonstration", legalName: null, legalForm: null, siret: null, vatNumber: null, nafCode: null, pacage: null, cvi: null, ede: null, phone: null, email: null, legalRep: null },
  certifications: [],
  sites: [],
  parcelsOutside: null,
  display: { basemap: "ortho", areaUnit: "ha", ...display },
  canEdit: true,
});
