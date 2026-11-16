-- agrirouter, lot AR1 (claudedocs/conception_agrirouter.md §3) : une
-- intégration peut être « déconnectée » par le fournisseur (autorisation
-- révoquée ou point de terminaison supprimé dans agrirouter). La ligne reste,
-- sans secret, pour afficher la date et proposer de reconnecter.
ALTER TABLE integrations DROP CONSTRAINT integrations_status_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_status_check
  CHECK (status IN ('pending', 'ok', 'error', 'disconnected'));
