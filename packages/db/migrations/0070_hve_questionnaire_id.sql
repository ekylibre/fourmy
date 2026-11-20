-- Contrôle HVE, lot CT4b : identifiant du questionnaire annuel, pour y
-- rattacher des justificatifs (regulatory_documents.owner_id).
ALTER TABLE hve_questionnaires ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
