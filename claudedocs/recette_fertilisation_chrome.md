# Recette de la fertilisation azotée dans Chrome (avant envoi à Pierre)

*Préparée le 2026-11-11. Ferme de test : copie locale de la ferme de Pierre (`phaurigot`), base de dev (port 5434), web http://localhost:5180.*

Chaque scénario donne le chemin, ce qu'on fait et ce qu'on doit voir. Une donnée de test saisie pendant la recette est retirée à la fin. Les saisies de vérification du blocage sont faites sur des dates passées et annulées ensuite.

## A. Page Fertilisation azotée (Réglementaire → Fertilisation azotée)

1. **Obligations** : 11 parcelles en zone vulnérable (37,37 ha), plan et cahier obligatoires, analyse annuelle au-delà de 3 ha.
2. **Encadré « À compléter pour la campagne 2026 »** : 6 étapes, avancement affiché.
   - Type de sol : 11 liens « Sol de … » vers l'onglet Sol.
   - Analyse de terre 2026 : lien vers l'onglet Sol.
   - Fertilisants : 14-48 liquide, Magnolac, Rosaliq Zinc, Sulfate de zinc, Sulfozinc, Zintrac 850.
   - Organiques : faite (aucun organique utilisé).
   - Plans : 11 plans « à compléter ».
   - Couverture des sols : 8 liens « saisir le broyage des cannes (récolte du 16/09/2025) ».
3. **Liens** : chaque lien ouvre le bon écran ; le lien du broyage ouvre une intervention de broyage des résidus, réalisée, sur la parcelle 2025 à la date de récolte.
4. **Zone climatique (APLSH)** : « D'après le département » ; changer de valeur puis revenir.
5. **Plans prévisionnels de fumure** : tableau des 11 plans, sélecteur de campagne, « Préparer les plans », liens d'impression.
6. **Suivi de la campagne** : 11 plans à établir, couverture des sols à vérifier, apports à compléter.
7. **Parcelles** et **Points d'eau** : tableau, zonage, sols.

## B. Onglet Sol d'une parcelle

1. Zonage nitrates (commune, zones).
2. Type de sol régional : choisir, enregistrement immédiat.
3. Analyses : ajouter une analyse de terre (pH, CEC), la voir, joindre un bulletin PDF, la retirer.

## C. Fiche d'un plan (Braquet Maïs 2026)

1. « Ce que Fourmy sait » : sol, précédent, objectif, reliquat, pluie, ouverture, implantation (semée le 07/04/2026).
2. Saisies : objectif, ouverture du bilan, période d'implantation.
3. Bilan azoté : termes sourcés, manques nommés, dose calculée une fois le sol renseigné.
4. Produits organiques : vide ; « Prévoir un apport » (liste vide : pas d'organique chez Pierre).
5. Couvert d'interculture : saisir, voir, retirer.
6. Dose d'un outil ou d'un conseiller : saisir, justificatif, retirer.
7. Apports prévus : proposition de fractionnement, « Moduler » ouvre la carte pré-remplie.
8. Établir le plan, puis pilotage (mesure), versions.

## D. Fertilisants (Stocks → Fertilisants)

1. Liste : compositions proposées, confirmées, à compléter.
2. Fiche du 14-48 liquide : type III, enregistrer.
3. Fiche d'un organique : champs annexe 5, APLSH, C/N visibles.

## E. Saisie d'une intervention de fertilisation

1. Nouvelle intervention « Fertilisation », parcelle en zone vulnérable, Urée 46.
2. Encadré « Directive nitrates » : azote apporté, calendrier, plan, efficacité (grille COMIFER), conditions d'épandage.
3. Date en période d'interdiction (janvier) : enregistrer réalisée → fenêtre « Feu rouge réglementaire » → motif obligatoire.
4. Fiche de l'intervention : section « Directive nitrates » avec le motif.

## F. Éditions

1. Plans imprimables de la campagne 2026.
2. Cahier d'enregistrement 2026 : apports, efficacité, couverture des sols, total ; lien CSV.

## G. Cartes de modulation

1. Depuis « Moduler » : bandeau de l'apport du plan, case de moyenne conservée, zonage, doses, enregistrement, rappel sur la fiche.

## À noter pour chaque écran

Erreurs de la console, appels en échec (4xx ou 5xx), textes tronqués ou ambigus, mise en page sur un écran de portable.

## Résultats de la recette du 2026-11-11 (Chrome, compte de recette local, supprimé ensuite)

**Passés** :
- A1 à A3 et A5 à A7 : obligations, encadré « À compléter », liens, plans, suivi, parcelles. Tous les appels de l'API répondent 200.
- B2 et B3 : type de sol, analyse de terre. L'encadré passe à « 2 sur 6 ».
- C1 à C3, C5, C7 : plan, dose de 243 kg N/ha une fois le sol renseigné, couvert (MrCi demande la biomasse, Ri passe en « après culture intermédiaire »), apports, « Moduler ».
- D1 et D2 : fertilisants.
- E1 à E3 : contrôle nitrates complet ; la fenêtre « Feu rouge réglementaire » bloque sans motif.
- F1 et F2 : plans imprimables, cahier, CSV.
- G1 : bandeau de l'apport et case de moyenne conservée.

**Corrigés** (branche `fix/recette-fertilisation`) :
1. Carte de modulation : la dose maximale de la machine (400 kg/ha par défaut) bornait sans le dire un apport de 643 kg/ha (moyenne de 400). Depuis le plan, les bornes valent maintenant la moitié et une fois et demie de la dose, et un avertissement s'affiche si la moyenne s'écarte de la dose du plan.
2. Cahier et CSV : unités en clair (« 55 kg/ha », « 1 L/ha » au lieu de « kilogram/ha », « liter/ha »).
3. Détails du bilan avec une virgule décimale (« 87,5 », « 107 × b 2,2 », « 0,6 avant 4 feuilles », APL).
4. Analyses de sol : virgule décimale et CEC affichée.

**À noter, non corrigés** :
- Redites sur la page Fertilisation azotée : la couverture des sols et le type de sol y figurent deux ou trois fois (obligations, encadré, suivi).
- Le starter de 14-48 liquide semé avec le maïs n'alimente pas « azote minéral avant 4 feuilles », qui reste une saisie du plan.
- Carte de modulation : l'image proposée par défaut est la plus récente (novembre), pas une image proche de la date de l'apport.
- « Retirer » (couvert, analyse) supprime sans confirmation.
- Plans imprimables : environ 8 s pour 11 plans (météo de chaque plan).
- Données de Pierre : le « 14-48 liquide » porte une composition 10-34-0 reprise d'Ekylibre, à vérifier avec lui.
- Non vérifiés dans Chrome : l'envoi d'un justificatif (sélecteur de fichier), l'affichage sur un écran de téléphone (le redimensionnement de la fenêtre n'a pas pris) et l'établissement d'un plan réel (non fait pour ne pas créer de version sur la ferme de Pierre). Ces points sont couverts par les tests automatisés.

### Deuxième série de corrections (branche `fix/recette-fertilisation-2`)

1. **Redites** : le bandeau ne garde que l'obligation. Le bandeau d'analyse annuelle disparaît : l'encadré « À compléter » dit la période et, une fois l'analyse faite, laquelle. Le suivi de campagne ne répète plus la couverture des sols ni les apports sans composition.
2. **Starter du maïs** : l'azote minéral réalisé du semis à 30 jours après remplit « azote avant 4 feuilles » (« calculé », avec la période), sauf saisie. Chez Pierre, le 14-48 liquide ne comptera qu'une fois son type renseigné.
3. **Image de la carte de modulation** : un apport du plan avec une date prévue propose l'image qui la précède de plus près.
4. **Confirmation** avant de retirer un justificatif, un couvert, une mesure de pilotage, une analyse de sol ou de produit, ou de supprimer un point d'eau.
5. **Plans imprimables** : 0,7 s au lieu de 8 s, vérifié dans Chrome. Côté serveur, les 11 plans se chargeaient déjà en 0,3 s, même avec un cache météo périmé : les 8 s venaient d'un premier chargement après redémarrage. Garde-fous ajoutés : un seul rafraîchissement de la météo à la fois par ferme, et la pluie lue une fois pour tous les plans d'une liste.

Au passage, le test de synchronisation « attelages » prend maintenant l'heure de la base au lieu de celle de Node : quelques millisecondes d'écart le rendaient instable.
