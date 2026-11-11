# Brouillon : demande d'accord de réutilisation au COMIFER

*À relire et envoyer par Ekylibre, au nom du projet Fourmy. Rédigé le 2026-11-11 ; non envoyé.*

**À** : COMIFER, Groupe Azote (contact via https://comifer.asso.fr/contact/)
**Copie** : INRA / INRAE, pour la table Rf (AZOBIL)
**Objet** : réutilisation des références du bilan azoté dans un logiciel libre de gestion d'exploitation (Fourmy)

Madame, Monsieur,

Ekylibre développe **Fourmy**, un logiciel libre (licence AGPL) de gestion d'exploitation agricole. Il succède à Ekylibre, que des exploitations utilisent depuis 2012.

Nous préparons un module de **plan prévisionnel de fumure et de cahier d'enregistrement** pour les exploitations en zone vulnérable. Il suit le référentiel régional en vigueur ; pour la Nouvelle-Aquitaine, c'est l'arrêté du 29 juillet 2025 et ses annexes. Chaque terme du bilan y est affiché avec sa source.

Pour paramétrer le calcul, nous souhaitons **embarquer dans le logiciel** des références du COMIFER, en citant à chaque ligne la source et la date de mise à jour. Les éléments suivants sont repris tels quels, sans modification :
- la table des coefficients d'équivalence engrais (Keq) des produits organiques, mise à jour du 09/12/2024 ;
- la table de composition des produits organiques (brochure 2013) ;
- les tables Mr, MrCi, Mhp et Pi des céréales d'hiver ;
- le tableau Rf (AZOBIL © INRA, 2012) ;
- les besoins unitaires des cultures et le classement annuel des variétés de blé (avec Arvalis).

Ces références servent aussi de valeurs par défaut quand le référentiel régional y renvoie. La ferme ou son conseiller peut les remplacer par des valeurs locales justifiées.

Nous vous demandons :
1. votre **accord** pour cette reprise, et la mention que vous souhaitez voir affichée ;
2. le **cahier des charges de la labellisation** des outils de calcul de dose. Nous souhaitons la demander pour Fourmy : le référentiel Nouvelle-Aquitaine l'exige après la période transitoire, qui se termine le 8 août 2027 ;
3. si possible, les tables en **format tableur**. Plusieurs ne sont publiées qu'en image dans les PDF ; la brochure 2013 indique que le tableau des Keq est « disponible en téléchargement ».

Nous pouvons vous présenter la méthode, nos cas de test chiffrés (exemples des annexes régionales recalculés) et le code, qui est public.

Avec nos remerciements,

[Nom, fonction]
Ekylibre — projet Fourmy
