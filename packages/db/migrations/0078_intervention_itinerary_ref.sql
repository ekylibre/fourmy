-- Assolement, temps 2, lot IT3 (claudedocs/conception_assolement_itk.md §7) :
-- lien d'une intervention prévue avec l'étape d'ITK qui l'a proposée.
--   { itineraryId, revision, stepId, occurrence, productionId, campaign, hash }
-- `hash` : empreinte de ce que la génération a écrit ; une empreinte
-- différente du contenu actuel signale une modification à la main (jamais
-- régénérée en silence). L'origine reste celle de l'écriture (web) : c'est ce
-- lien qui distingue une intervention générée.

ALTER TABLE interventions ADD COLUMN itinerary_ref jsonb
  CHECK (itinerary_ref IS NULL OR (itinerary_ref ? 'productionId' AND itinerary_ref ? 'stepId' AND itinerary_ref ? 'occurrence' AND itinerary_ref ? 'hash'));

-- Une intervention vivante par production, étape et passage : la génération est idempotente.
CREATE UNIQUE INDEX interventions_itinerary_ux ON interventions
  (farm_id, (itinerary_ref->>'productionId'), (itinerary_ref->>'stepId'), ((itinerary_ref->>'occurrence')::int))
  WHERE itinerary_ref IS NOT NULL AND status <> 'cancelled';
CREATE INDEX interventions_itinerary_campaign ON interventions (farm_id, ((itinerary_ref->>'campaign')::int))
  WHERE itinerary_ref IS NOT NULL;
