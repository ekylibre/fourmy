-- Assolement, lot AS5 : reconduction du parcellaire de la campagne précédente
-- (fermes reprises d'Ekylibre, une parcelle par culture et par campagne).
ALTER TABLE land_parcel_lineage DROP CONSTRAINT land_parcel_lineage_kind_check;
ALTER TABLE land_parcel_lineage ADD CONSTRAINT land_parcel_lineage_kind_check CHECK (kind IN ('split', 'merge', 'carry'));
