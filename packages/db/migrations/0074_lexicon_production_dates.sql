-- Assolement, retours de test du 20/11 : dates types de semis et de récolte
-- des productions Lexicon (année 2000 pour le semis, 2000 ou 2001 pour la
-- récolte), pour pré-remplir les dates prévues d'une culture.
ALTER TABLE lexicon_productions ADD COLUMN started_on date, ADD COLUMN stopped_on date;
