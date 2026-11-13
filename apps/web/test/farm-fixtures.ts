import type { FarmDisplay, FarmProfile } from "@fourmy/contracts";

/** Fiche « Ma ferme » de démonstration, préférences d'affichage au choix. */
export const demoFarmProfileFor = (display: Partial<FarmDisplay> = {}): FarmProfile => ({
  identity: { name: "Ferme de démonstration", legalName: null, legalForm: null, siret: null, vatNumber: null, nafCode: null, pacage: null, cvi: null, ede: null, phone: null, email: null, legalRep: null },
  certifications: [],
  sites: [],
  parcelsOutside: null,
  display: { basemap: "ortho", areaUnit: "ha", ...display },
  logoAssetId: null,
  canEdit: true,
});
