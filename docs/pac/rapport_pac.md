# Conditionnalité PAC dans l'assolement : lecture de la fiche BCAE 7 2026

Rapport du 20/11/2026, pour le contrôle BCAE 7 de l'assolement prévisionnel
(`claudedocs/conception_assolement.md` §4.2, décision A6). Référentiel :
`packages/certification-refs/src/pac/bcae7-2026.ts` ; contrôle :
`packages/domain/src/crop-plan/checks/bcae7.ts`.

## 1. Source

| Réf. | Source | Lecture |
|---|---|---|
| **BCAE 7 2026** | `docs/pac/Conditionnalite-2026_fiche-technique_BCAE7_rotation.pdf` : « Fiche conditionnalité 2026 - Métropole, BCAE 7 La rotation et la diversification des cultures », 23 pages, téléchargée de Télépac le 20/11/2026 (hors dépôt, comme les pièces HVE et AB) | Lue en entier. Extraction `pdftotext -layout`, puis relecture à l'image (OCR `tesseract`, 300 dpi) des pages 3 à 5, 10, 18 à 23 : la police du PDF perd les apostrophes et les mots qui les entourent (« Blé tendre d'hiver », « Avoine d'hiver », barème de l'annexe 5). |
| Nomenclature | Codes cultures PAC 2026 du jeu Lexicon `productions` (`lexicon_cap_codes`, 143 codes) | Tous les codes de l'annexe 4 existent en 2026. |

Les tables sont recopiées à la main de la fiche (51 catégories, 96 codes) ;
les tests vérifient leur cohérence (un code par catégorie, annexe 1 classée,
terres arables et non arables disjointes) plutôt qu'une extraction outillée,
le texte du PDF étant incomplet.

## 2. Ce que dit la fiche

- **Qui** (§2, p. 2-3) : bénéficiaires d'aides soumises à la conditionnalité, avec des terres arables. **Exemptions** : toute l'exploitation en AB ou en conversion ; terres arables ≤ 10 ha ; plus de 75 % des terres arables en herbe, légumineuses ou jachère ; plus de 75 % de la surface admissible en prairies permanentes, herbe ou cultures sous eau. **Pas de contrôle** des exploitations de moins de 30 ha de SAU à partir de 2026. Plaine du Rhin : diversification à points obligatoire.
- **Rotation, critère annuel** (§3 A, p. 4-5) : sur au moins 35 % des terres arables cultivées (hors pluriannuelles, prairies temporaires, jachères, cultures sous eau : annexe 1), culture principale différente de l'an passé, ou culture principale suivie d'une culture secondaire. Culture principale : en place au moins en partie du 1er mars au 15 juillet ; date pivot hiver/printemps : 31 décembre. Culture secondaire : implantée au plus tard le 15 novembre, en place jusqu'au 15 février, différente des deux cultures principales qui l'encadrent ; CIPAN admises ; cannes, chaumes, mulch, repousses exclus.
- **Rotation, critère pluriannuel** (§3 B, p. 6-9) : par parcelle, au moins deux cultures principales différentes sur n-3 à n, ou une culture secondaire chaque année. Années SNE ou non déclarées : respectées par défaut. Parcelles en pluriannuelle, jachère ou prairie temporaire en n : non concernées ; présence d'une telle culture sur la période : critère respecté.
- **Diversification** (§5, p. 10-11), hors plaine du Rhin : 10 à 30 ha de terres arables, au moins 2 cultures, la principale ≤ 75 % ; plus de 30 ha, au moins 3 cultures, la principale ≤ 75 %, les deux principales ≤ 95 %. Les terres arables comprennent pluriannuelles, prairies temporaires et jachères. Le choix de la diversification dispense du critère pluriannuel l'année concernée.
- **Sanctions** (§6, p. 12-15) : écart ≤ 3 % ou ≤ 2 ha (rotation), ≤ 0,5 ha (diversification 10-30 ha), ≤ 2 ha (plus de 30 ha) : alerte informative ; au-delà : réduction de 1 % à 3 % au 1er constat, 3 % à 9 % au 2e.
- **Catégories** (annexes 3 et 4, p. 18-21) : hiver et printemps distincts (sauf féverole) ; fruits, légumes, fleurs et plantes à parfum comptés par code culture ; cultures associées (CIT, CID) et maraîchage diversifié (MDI) respectent la rotation par nature.

## 3. Choix d'interprétation dans Fourmy

1. **Les deux critères sont calculés** et le verdict retient le meilleur ; le critère non retenu reste affiché, en information. La fiche demande de choisir l'un des deux à la déclaration : Fourmy montre lequel passe.
2. **Écart faible** : niveau « à vérifier » (orange), écart plus fort : « non conforme » (rouge). Sous 30 ha de SAU, un rouge devient orange avec la mention « pas de contrôle ».
3. **Année inconnue de Fourmy** (pas d'historique) : « données manquantes », jamais conforme d'office, même si la fiche répute respectée une année non déclarée : Fourmy ne sait pas distinguer une année non déclarée d'une année non saisie. Les années SNE sont respectées par défaut.
4. **Légumineuses de l'exemption** (annexe 2, « liste 1.3 de la notice Cultures et précisions ») : la liste n'est pas dans la fiche ; elle est reconstituée d'après les catégories de légumineuses de l'annexe 4 (`BCAE7_ANNEX2_LEGUMES`). À vérifier sur la notice Télépac 2026.
5. **Exemption de surface** : non conclue tant qu'une parcelle a un code culture inconnu.
6. **Parcelle fusionnée** : chaque parcelle d'origine est vérifiée avec sa part de surface ; la part en monoculture compte dans l'écart.
7. **Culture principale du brouillon** : la culture prévue en place au 1er juin de l'année de récolte ; « sans culture » sans code : jachère (JAC). Couvert d'interculture : culture secondaire s'il est semé au plus tard le 15 novembre et détruit au plus tôt le 15 février.

## 4. Non repris

- **Plaine du Rhin** : barème à points de l'annexe 5 (minimum 3 points) non calculé ; la liste des communes est dans l'arrêté BCAE, pas dans la fiche. Réglage « plaine du Rhin » : constat « à vérifier ».
- **Dérogation maïs semence** (§3 B, p. 7) : texte incomplet à l'extraction, non reprise.
- **Exemption d'une année passée** (§3 B, p. 7) : une année où l'exploitation était exemptée compte comme respectée ; Fourmy ne garde pas les exemptions passées.
- **Alternance entre rotation et diversification** d'une année sur l'autre (§5, p. 11).
- **Contrôle sur place de la culture secondaire** (dates réelles, nature du couvert) : l'assolement ne vérifie que les dates prévues.
