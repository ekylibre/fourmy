/**
 * Connexion défaite côté fournisseur (agrirouter : autorisation retirée,
 * point de terminaison supprimé), constatée pendant une synchro :
 * l'intégration passe « déconnectée », sans secret, au lieu d'« en erreur ».
 */
export class ProviderDisconnected extends Error {
  constructor(
    readonly reason: "revoked" | "endpoint_deleted",
    message: string,
  ) {
    super(message);
    this.name = "ProviderDisconnected";
  }
}
