// Fichier généré par scripts/extract-copper.mjs : ne pas modifier à la main.
import type { RefSource } from "../source.js";

export const COPPER_EPHY_SOURCE: RefSource = {
  text: "Catalogue E-Phy (ANSES), données ouvertes data.gouv.fr, produits_utf8.csv",
  version: "2026-11-17",
  at: "colonne « Substances actives », composés du cuivre",
};

/** Substances cupriques de chaque produit, par n° d'AMM, telles qu'E-Phy les libelle. */
export const COPPER_EPHY: Record<string, string[]> = {
  "2000087": ["cuivre (Copper compounds) 375.0 g/kg"], // COPLESS
  "2000089": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE SP
  "2000125": ["cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE EXPRESS
  "2000196": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 400.0 g/kg"], // ORACLE
  "2000210": ["oxychlorure de cuivre (Copper compounds) 377.5 g/L"], // YUCCA
  "2000231": ["sulfate de cuivre (Copper compounds) 20.0 %"], // MACC CYMAL
  "2000325": ["sulfate de cuivre (Copper compounds) 125.0 g/kg"], // MACC CYFOR
  "2000358": ["sulfate de cuivre (Copper compounds) 125.0 g/kg"], // VEZIR
  "2000360": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 35.0 %"], // NOAH
  "2000363": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // GYPSY 50
  "2000375": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 16.0 %"], // MANCOCUIVRE
  "2000450": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 400.0 g/kg"], // UTILIS
  "2000517": ["hydroxyde de cuivre (Copper compounds) 553.3 g/L"], // CHAMP FLO AMPLI
  "2010029": ["sulfate de cuivre (Copper compounds) 20.0 %"], // EQUILIBRE DISPERSS
  "2010036": ["sulfate de cuivre (Copper compounds) 11.0 %"], // CAIMAN PLUS
  "2010053": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SARMAN C2
  "2010057": ["sulfate de cuivre (Copper compounds) 20.2 %"], // CIGALE
  "2010079": ["sulfate de cuivre tribasique (Copper compounds) 0.85 g/L"], // QUADRIMEX TRAITEMENT TOTAL BIO-PIM
  "2010130": ["cuivre (Copper compounds) 750.0 g/kg"], // NORDOX 75 WG
  "2010209": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SOBIOCUIVRE 20
  "2010423": ["sulfate de cuivre (Copper compounds) 11.0 %"], // CUPROR TRIPLE PLUS
  "2010424": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 22.0 %"], // CUPROR MZ
  "2010509": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BOUILLIE BORDELAISE NC 20 K
  "2010520": ["sulfate de cuivre (Copper compounds) 11.0 %"], // CUPROR JARDIN
  "2010553": ["sulfate de cuivre (Copper compounds) 125.0 g/kg"], // SARMAN FC
  "2010611": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE CHEMINOVA
  "2010618": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE MANICA N.C.
  "2020027": ["sulfate de cuivre (Copper compounds) 20.0 %"], // CHJ BOUILLIE BORDELAISE
  "2020321": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // MYCELIS
  "2020443": ["sulfate de cuivre (Copper compounds) 8.33 %"], // SULFADOR CM
  "2030026": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.3 %","cuivre du carbonate de cuivre (Copper compounds) 4.3 %","sulfate de cuivre (Copper compounds) 3.9 %"], // CUPROCURE TRIPLE M
  "2030054": ["sulfate de cuivre (Copper compounds) 17.0 %"], // SAFECAP DG
  "2030114": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 33.0 %"], // SULFATEX XM
  "2040207": ["cuivre (Copper compounds) 20.2 %"], // BOUILLIE BORDELAISE CAFFARO NC
  "2040213": ["cuivre (Copper compounds) 20.2 %"], // BOUILLIE BORDELAISE COOPER
  "2040314": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE PHYTEUROP NC
  "2040368": ["sulfate de cuivre (Copper compounds) 8.8 %"], // MANTANA
  "2050134": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 397.5 g/kg"], // CURZATE R
  "2050135": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 397.5 g/kg"], // CURZATE R NC
  "2070143": ["cuivre (Copper compounds) 300.0 g/L"], // DWEELER
  "2070193": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 300.0 g/L"], // RISSE
  "2090098": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // HYDROMICRON SALDECO
  "2090119": ["sulfate de cuivre tribasique (Copper compounds) 345.0 g/L"], // CUPROXAT SC
  "2090121": ["cuivre (Copper compounds) 124.0 g/L"], // MANIFLOW
  "2090130": ["sulfate de cuivre tribasique (Copper compounds) 375.0 g/kg"], // VINTAGE C DISPERSS
  "2090132": ["sulfate de cuivre tribasique (Copper compounds) 483.8 g/L"], // AMALINE FLOW
  "2090133": ["hydroxyde de cuivre (Copper compounds) 337.5 g/kg"], // BLUE SHIELD HI BIO WG
  "2090134": ["hydroxyde de cuivre (Copper compounds) 383.5 g/kg"], // COPERNICO HI BIO WG
  "2090135": ["hydroxyde de cuivre (Copper compounds) 306.9 g/kg"], // NUCOP HI BIO WG
  "2090137": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BORDO 20 MICRO
  "2090170": ["hydroxyde de cuivre (Copper compounds) 460.7 g/kg"], // KOCIDE OPTI
  "2090184": ["sulfate de cuivre (Copper compounds) 200.0 g/kg"], // BOUILLIE BORDELAISE SALDECO
  "2100075": ["cuivre (Copper compounds) 406.0 g/kg"], // OCARINA UD
  "2100147": ["cuivre (Copper compounds) 157.5 g/kg"], // SARMAN MC WG
  "2100248": ["cuivre de l'oxyde cuivreux (Copper compounds) 50.0 %"], // CHEM COPP 50
  "2110006": ["cuivre (Copper compounds) 200.0 g/kg"], // BOUILLIE BORDELAISE CAFFARO WG
  "2110021": ["cuivre (Copper compounds) 400.0 g/kg"], // KENTAN 40 WG
  "2110083": ["sulfate de cuivre tribasique (Copper compounds) 0.85 g/L"], // QDX TRAITEMENT TOTAL BIO PLM
  "2110173": ["oxychlorure de cuivre (Copper compounds) 13.95 %"], // PERGADO C PEPITE
  "2110180": ["cuivre de l'oxyde cuivreux (Copper compounds) 750.0 g/kg"], // NORDOX 75 WG JARDIN
  "2140168": ["sulfate de cuivre tribasique (Copper compounds)"], // COPSEED
  "2150087": ["cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE RSR DISPERSS JARDIN
  "2160433": ["hydroxyde de cuivre (Copper compounds)","oxychlorure de cuivre (Copper compounds)"], // VALIS PLUS
  "2160694": ["sulfate de cuivre tribasique (Copper compounds) 810.0 g/kg"], // NOVICURE
  "2170458": ["sulfate de cuivre tribasique (Copper compounds) 150.0 g/kg"], // PANGOLIN DG
  "2170702": ["cuivre (Copper compounds) 450.0 g/kg"], // NORDOX VITIS
  "2171245": ["oxychlorure de cuivre (Copper compounds) 533.66 g/L"], // COPPER KEY FLOW
  "2171246": ["oxychlorure de cuivre (Copper compounds) 533.66 g/L"], // CODIMUR SC
  "2171247": ["cuivre (Copper compounds) 520.0 g/L"], // CUPRA
  "2180246": ["cuivre (Copper compounds) 300.0 g/kg"], // EVO TRIBASIC
  "2180319": ["sulfate de cuivre tribasique (Copper compounds) 1.36 g/L"], // CUPROXAT PRET A L'EMPLOI
  "2180657": ["hydroxyde de cuivre (Copper compounds) 307.2 g/kg"], // CUIVRISTAL
  "2180670": ["cuivre (Copper compounds) 280.0 g/kg"], // CUPROCOL DUO
  "2180671": ["bouillie bordelaise (Copper compounds)"], // LIMPIC 124 SC
  "2180679": ["oxychlorure de cuivre (Copper compounds) 1177.1 g/L"], // OUROUK SC
  "2180829": ["cuivre (Copper compounds) 272.0 g/L"], // AIRONE SC
  "2180834": ["hydroxyde de cuivre (Copper compounds) 255.3 g/kg","oxychlorure de cuivre (Copper compounds) 253.2 g/kg"], // FANTIC A
  "2180888": ["sulfate de cuivre tribasique (Copper compounds) 345.0 g/L"], // CUPROXAT JARDIN
  "2180889": ["oxychlorure de cuivre (Copper compounds) 588.8 g/kg"], // CUPROZIN 35 WP
  "2180893": ["oxychlorure de cuivre (Copper compounds) 483.6 g/kg"], // CYMCO
  "2180894": ["oxychlorure de cuivre (Copper compounds) 438.6 g/kg"], // CURAME 25WG
  "2180897": ["cuivre (Copper compounds) 150.0 g/kg"], // SOPILA
  "2180899": ["cuivre (Copper compounds) 150.0 g/kg"], // CURAME BORDEAUX
  "2180901": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BORMIX
  "2189993": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BOUILLIE BORDELAISE NC 20 K JARDIN
  "2189994": ["sulfate de cuivre (Copper compounds) 200.0 g/kg"], // BOUILLIE BORDELAISE MANICA NC JARDIN
  "2189995": ["sulfate de cuivre (Copper compounds) 200.0 g/kg"], // BOUILLIE BORDELAISE MANICA JARDIN
  "2190168": ["hydroxyde de cuivre (Copper compounds) 330.1 g/L"], // ACTLET C
  "2250161": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BOUILLIE BORDELAISE 20 MICRO JARDIN
  "2250162": ["hydroxyde de cuivre (Copper compounds)"], // KUPPER 20 WG
  "2250191": ["hydroxyde de cuivre (Copper compounds) 614.2 g/kg"], // VITRA 40 WG
  "4000109": ["sulfate de cuivre (Copper compounds) 2.5 %"], // FRUIDORINE
  "4000328": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 2.5 %"], // SOUFRE CHARGE CUPRIQUE BOB
  "4000761": ["sulfate de cuivre (Copper compounds) 2.5 %"], // MICROLINE
  "4000771": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 2.5 %"], // STEATITE CUPRIQUE MOP
  "4100228": ["sulfate de cuivre (Copper compounds) 15.0 %"], // BOUILLIE MICHEL PERRET 15
  "4100423": ["cuivre de l'oxyde cuivreux (Copper compounds) 50.0 %"], // SANDOZ CUIVRE 407
  "4500171": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 12.5 %"], // C C D 12 50
  "4600233": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CLOROFIX 50
  "4700304": ["sulfate de cuivre (Copper compounds) 15.0 %"], // BOUILLIE MACCLESFIELD
  "4800324": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 2.5 %"], // CESARINE
  "4800332": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // OXYCHLOR 50 MICRONISE
  "4900217": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 3.5 %"], // CUPROFLEUR
  "5000233": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // VIRICUIVRE MICRONISE
  "5200041": ["sulfate de cuivre (Copper compounds) 15.0 %"], // BOUILLIE BAROUSSE 15
  "5200294": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 650.0 %","cuivre de l'oxyde cuivreux (Copper compounds) 650.0 g/L"], // OLEOCUIVRE
  "5500195": ["sulfate de cuivre (Copper compounds) 2.5 %"], // CUPROTHIOL 70
  "5500281": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 2.5 %"], // CUPRIC
  "5600025": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // VITIGRAN CONCENTRE
  "5700188": ["sulfate de cuivre (Copper compounds) 17.0 %"], // BORTENE
  "5700220": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // SEPICUIVRE
  "5900053": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // PLANTIMATE
  "5900151": ["cuivre de l'acetate de cuivre (Copper compounds) 12.6 %"], // ZINAVER 2
  "5900183": ["sulfate de cuivre (Copper compounds) 5.0 %"], // CUPROTHIOL 50
  "5900224": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 14.9 %"], // MALICUSOJACH
  "5900334": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // BOUILLIE AZUREE
  "5900341": ["cuivre de l'hydrocarbonate de cuivre (Copper compounds) 2.5 %"], // CUPROFOG
  "6000081": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // OCD MACCLESFIELD
  "6000243": ["sulfate de cuivre (Copper compounds) 5.0 %"], // MICROLINE 5
  "6000339": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 36.0 %"], // CUPRINEBE
  "6000370": ["cuivre de l'acetate de cuivre (Copper compounds) 3.15 %","cuivre de l'oxychlorure de cuivre (Copper compounds) 14.8 %"], // ZINAVEROX 18 FORMULE N 1
  "6000371": ["cuivre de l'acetate de cuivre (Copper compounds) 3.15 %","cuivre de l'oxychlorure de cuivre (Copper compounds) 14.8 %"], // ZINAVEROX 18 FORMULE N 2
  "6000453": ["sulfate de cuivre (Copper compounds) 17.0 %"], // CUPROFIX Z
  "6100049": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUIVROCHIM
  "6100063": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 165.0 g/L"], // CUIVRAL
  "6100069": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 25.0 %"], // SILOXYL
  "6100274": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPRO-PHYNEBE
  "6100416": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPRAVIT
  "6100417": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPRADOR I
  "6100475": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 40.0 %"], // SILOXYL R 40
  "6200015": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // UMUCUIVRE MICRONISE
  "6200075": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE RSR
  "6200171": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // OXYLDIOU
  "6200183": ["cuivre de l'acetate de cuivre (Copper compounds) 5.0 %","cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // ZINACETOX
  "6200394": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // ZINOMOP SUPER
  "6300007": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 27.0 %","sulfate de cuivre (Copper compounds) 3.0 %"], // MICOSEN
  "6300022": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 23.0 %"], // EFFICAN S
  "6300023": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // EFFICAN
  "6300128": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUIVROSAN 50
  "6300130": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUIVRONEB
  "6300147": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // HYPER CUIVRE 63
  "6300340": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // VIGNEBELLE I
  "6300413": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // RYL CUIVRE S
  "6400009": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPROR PEPRO
  "6400161": ["sulfate de cuivre (Copper compounds) 17.0 %"], // CUPROFIX M
  "6400222": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUIVROLITE 50 MICRONISE
  "6400275": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 15.0 %"], // NAFTANE POUDRAGE
  "6400335": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPRONYL EXTRA
  "6400381": ["sulfate de cuivre (Copper compounds) 17.5 %"], // SUPER Z MACCLESFIELD
  "6400405": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // DORICUIVRE 50
  "6500197": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // SANICEP
  "6500250": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // COBOX
  "6500276": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 33.0 %"], // MANCOCUIVRE.
  "6500400": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.0 %"], // CUPRO-ANTRACOL
  "6600016": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // CUPROSAN 311 SUPER D
  "6600035": ["cuivre du chlorure cuivreux (Copper compounds) 125.0 g/L"], // CHLORCUIVREUX PROCIDA
  "6600309": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // ZINDACUIVRE
  "6600379": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // ZINOX
  "6600445": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 15.0 %"], // SILOXYL M 55
  "6600446": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // OXYCUIVRE
  "6600447": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE OREAL
  "6600534": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // UGEZINOX
  "6600535": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // UGECUPRIC
  "6700208": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 8.0 %"], // MINOTOR MIXTE
  "6700215": ["sulfate de cuivre (Copper compounds) 17.5 %"], // BORTENE Z
  "6700216": ["cuivre du chlorure cuivreux (Copper compounds) 110.0 g/L"], // CHLORCUIVREUX 110 PROCIDA
  "6700297": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // MANOXYL
  "6700393": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPREX
  "6700508": ["sulfate de cuivre (Copper compounds) 17.0 %"], // MANOCUPRYL
  "6800229": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.5 %","cuivre du carbonate de cuivre (Copper compounds) 2.7 %","sulfate de cuivre (Copper compounds) 2.4 %"], // TRIMILTOX NC
  "6800286": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // EKOCUIVRE A
  "6800292": ["sulfate de cuivre (Copper compounds) 9.0 %"], // MOLOSS
  "6800298": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // GROUPACUIVRE
  "6800363": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // SUPER MIXY
  "6800387": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // PHYGARCUIVRE
  "6800415": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 15.0 %"], // CUPROFAL
  "6900010": ["sulfate de cuivre (Copper compounds) 17.0 %"], // MEDINEBE Z
  "6900011": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // OXYNEBE
  "6900041": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 2.5 %"], // MICRO KRISS SOUFRE 70
  "6900053": ["sulfate de cuivre (Copper compounds) 11.0 %"], // UC 70
  "6900067": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // SUPER ZINDACUIVRE BLEU
  "6900269": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 36.0 %"], // DITAMATE
  "6900376": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE PHYTEUROP
  "6900378": ["sulfate de cuivre (Copper compounds) 17.0 %"], // MANECUIVRE S
  "6900382": ["sulfate de cuivre (Copper compounds) 10.0 %"], // SULFATEX
  "6900404": ["sulfate de cuivre (Copper compounds) 15.0 %"], // SULFADOR
  "6900423": ["sulfate de cuivre (Copper compounds) 12.0 %"], // CUPRO-EUPARENE
  "6900470": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // CUPROSAN 311 SUPER DNC
  "7000017": ["sulfate de cuivre (Copper compounds) 17.0 %"], // SULFANEBE 34
  "7000033": ["sulfate de cuivre (Copper compounds) 17.0 %"], // AMAC 6208 EXTRA
  "7000107": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 20.0 %"], // FOLTICUIVRE
  "7000113": ["sulfate de cuivre (Copper compounds) 2.5 %"], // POUDRE SICCATIVE RSR
  "7000117": ["sulfate de cuivre (Copper compounds) 12.0 %"], // MYCOTOX
  "7000231": ["sulfate de cuivre (Copper compounds) 10.0 %"], // SULFATEX M
  "7000242": ["sulfate de cuivre (Copper compounds) 1.0 %"], // MOLOSS POUDRAGE
  "7000269": ["sulfate de cuivre (Copper compounds) 17.5 %"], // SUPER X MACCLESFIELD''
  "7000307": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 8.0 %"], // MINOTOR MIXTE C
  "7100007": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 20.0 %"], // CUPRIX 20.
  "7100053": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.3 %","cuivre du carbonate de cuivre (Copper compounds) 4.3 %","sulfate de cuivre (Copper compounds) 3.9 %"], // TRI-MILTOX FORT
  "7100082": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 4.5 %","cuivre du carbonate de cuivre (Copper compounds) 1.5 %"], // C.C.D-T-6.60
  "7100203": ["sulfate de cuivre (Copper compounds) 17.0 %"], // MICROSULFIX M
  "7100337": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // MANCOBLEU 500
  "7200066": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 15.0 %"], // CUPRADOR II
  "7200094": ["sulfate de cuivre (Copper compounds) 12.5 %"], // MANOCUPRYL 5030
  "7200104": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 15.0 %"], // SULFO 35
  "7200105": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 12.5 %"], // CUPROVIGNE
  "7200186": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %","sulfate de cuivre (Copper compounds) 5.0 %"], // SILOXYL M 80
  "7200259": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 15.0 %"], // TURBOCUIVRE C S
  "7200451": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // COPRAREX
  "7200505": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 2.5 %"], // STEATITE CUPRIQUE MIDI-PYRENEES
  "7300058": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // CUPRADOR 300
  "7300150": ["sulfate de cuivre (Copper compounds) 14.0 %"], // FONGIMAC 81
  "7300151": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // VIRAX
  "7300152": ["sulfate de cuivre (Copper compounds) 12.0 %"], // FORSAN
  "7300166": ["sulfate de cuivre (Copper compounds) 17.0 %"], // AGRICUPRYL
  "7300167": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 20.0 %"], // FOLTAGRI
  "7300272": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.3 %","cuivre du carbonate de cuivre (Copper compounds) 4.3 %","sulfate de cuivre (Copper compounds) 3.9 %"], // TRI MILTOX FORT NC
  "7300281": ["sulfate de cuivre (Copper compounds) 12.5 %"], // CUPRITAL.
  "7300283": ["cuivre du carbonate de cuivre (Copper compounds) 2.5 %"], // SOUFROXYCUIVRE
  "7300298": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // L.S.TOTAL POUDRAGE
  "7300315": ["sulfate de cuivre (Copper compounds) 10.0 %"], // FUNDASPOR 50
  "7300358": ["sulfate de cuivre (Copper compounds) 12.0 %"], // CUPROFIX F
  "7300364": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 8.0 %"], // MINOTOR MIXTE T
  "7300416": ["sulfate de cuivre (Copper compounds) 13.0 %"], // SULFOMA
  "7300430": ["sulfate de cuivre (Copper compounds) 15.0 %"], // SUPER MACCLESFIELD 3 X 15
  "7300436": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 125.0 g/L"], // PLANTIFOG CZ
  "7400091": ["sulfate de cuivre (Copper compounds) 13.8 %"], // FT 2 BOUILLIE BORDELAISE INDUSTRIELLE SIAPA
  "7400113": ["sulfate de cuivre (Copper compounds) 20.0 %"], // AGRIBOUILLIE 80
  "7400114": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // AGRICUIVRE 50
  "7400202": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 32.0 %"], // RH 68 A
  "7400203": ["sulfate de cuivre (Copper compounds) 16.9 %"], // RH 68 B
  "7400204": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 22.0 %"], // RH 68 C
  "7400205": ["sulfate de cuivre (Copper compounds) 14.3 %"], // RH 68 D
  "7400206": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 16.0 %"], // RH 68 E
  "7400207": ["sulfate de cuivre (Copper compounds) 10.0 %"], // RH 68 F
  "7400284": ["sulfate de cuivre (Copper compounds) 20.0 %"], // PROCOP 20
  "7400296": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE SCLR
  "7400402": ["sulfate de cuivre (Copper compounds) 25.0 %"], // B B S PROCIDA
  "7500002": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %","sulfate de cuivre (Copper compounds) 10.0 %"], // SUFFATEX CX
  "7500066": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %","sulfate de cuivre (Copper compounds) 15.0 %"], // SULFANEBE 2000 M
  "7500149": ["sulfate de cuivre (Copper compounds) 18.0 %"], // AGRICUPRYL Z
  "7500198": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 16.7 %","cuivre du carbonate de cuivre (Copper compounds) 5.4 %","sulfate de cuivre (Copper compounds) 4.9 %"], // MILTOX P 13
  "7500242": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE UMUPRO JARDIN
  "7500249": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // MASTIC FLUIDE ANTICHANCRE G.T.
  "7500361": ["sulfate de cuivre (Copper compounds) 17.0 %"], // SULFANEBE 34 SUPER
  "7500716": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // SUPER BOUILLIE MACCLESFIELD 80
  "7500798": ["cuivre de l'acetate de cuivre (Copper compounds) 2.0 %","sulfate de cuivre (Copper compounds) 16.0 %"], // ZINAVEROX 18 N 3 BB
  "7500809": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 7.0 %"], // DUPLEX POUDRAGE
  "7500829": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 17.5 %"], // DUPLEX PULVERISATION
  "7600101": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // STYROCUIVRE
  "7600237": ["sulfate de cuivre (Copper compounds) 7.0 %"], // PHALTOCUIVRE BX
  "7600246": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %","sulfate de cuivre (Copper compounds) 10.0 %"], // SULFATEX F
  "7600407": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 15.0 %"], // MILFIX
  "7600422": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %","sulfate de cuivre (Copper compounds) 5.0 %"], // TURBOFAL PM
  "7600509": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // MAZACUIVRE
  "7600513": ["sulfate de cuivre (Copper compounds) 14.0 %"], // CUINEBE C
  "7600523": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SUPER BOUILLIE PERDOUX
  "7700058": ["cuivre du carbonate de cuivre (Copper compounds) 5.0 %","sulfate de cuivre (Copper compounds) 10.0 %"], // FOLDICRYL
  "7700109": ["cuivre du carbonate de cuivre (Copper compounds) 4.7 %","sulfate de cuivre (Copper compounds) 10.3 %"], // VITACRYL 40
  "7700121": ["sulfate de cuivre (Copper compounds) 20.0 %"], // CUIVROFIX
  "7700310": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // PULVERISATION TOTALE S UMUPRO
  "7700311": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // POUDRAGE TOTAL S UMUPRO
  "7700326": ["sulfate de cuivre (Copper compounds) 9.0 %"], // FT2.F
  "7700392": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 7.0 %"], // GERMEDOR POUDRE
  "7700455": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 8.0 %"], // ABONDANCE MILDIOU DORYPHORE JARDIN
  "7700457": ["sulfate de cuivre (Copper compounds) 15.0 %"], // ABONDANCE MILDIOU JARDIN
  "7700502": ["sulfate de cuivre (Copper compounds) 12.0 %"], // MYCOCID
  "7700551": ["sulfate de cuivre (Copper compounds) 12.0 %"], // SULFASTOP
  "7700562": ["sulfate de cuivre (Copper compounds) 11.0 %"], // BELGRAP
  "7700563": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.7 %"], // BOGRIN
  "7700566": ["sulfate de cuivre (Copper compounds) 25.0 %"], // BOUILLIE BORDELAISE RHODIA 25
  "7700568": ["cuivre (Copper compounds) 200.0 g/kg"], // BOUILLIE BORDELAISE NOVAJARDIN
  "7700570": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE CARRE VERT
  "7700579": ["sulfate de cuivre (Copper compounds) 20.0 %"], // MICOSEN F
  "7700594": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // LACFOLP
  "7700595": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 35.0 %"], // LACNEB
  "7700596": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 8.05 %","cuivre du carbonate de cuivre (Copper compounds) 2.7 %","sulfate de cuivre (Copper compounds) 2.75 %"], // AMITOX
  "7700598": ["sulfate de cuivre (Copper compounds) 17.0 %"], // ACUINEBE
  "7700599": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // ACUIVRE 50
  "7700600": ["sulfate de cuivre (Copper compounds) 12.0 %"], // SYNERGIX
  "7700657": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE IP
  "7700681": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // CESARINE DOR
  "7700718": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 19.0 %"], // DORIFUGE
  "7700730": ["sulfate de cuivre (Copper compounds) 12.5 %"], // ANTEOR C
  "7700761": ["sulfate de cuivre (Copper compounds) 17.0 %"], // CUPROFIX CZ ACTIVE
  "7700779": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 20.0 %"], // FOLDORCUPRIQUE B
  "7700785": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 2.5 %"], // MALACUPRIQUE
  "7800048": ["sulfate de cuivre (Copper compounds) 13.0 %"], // FATOXYL
  "7800049": ["sulfate de cuivre (Copper compounds) 17.0 %"], // TRINEBE C
  "7800050": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // LACUINEBE
  "7800116": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // EUROCUIVRE 50
  "7800119": ["sulfate de cuivre (Copper compounds) 17.0 %"], // EUROFIX M
  "7800120": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // EUROCUIVRE SUPER
  "7800123": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 2.5 %"], // POUDRAFON
  "7800134": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE EURO
  "7800145": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 2.25 %"], // ELGEDORYL POUDRE
  "7800174": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SULFATINE
  "7800175": ["sulfate de cuivre (Copper compounds) 17.0 %"], // SULFACUBE
  "7800200": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // OXYCUBE
  "7800224": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 0.8 %"], // SUPER SEVACUIVRE M BOUILLIE
  "7800241": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIELAC
  "7800245": ["sulfate de cuivre (Copper compounds) 12.5 %"], // FULVAX C
  "7800266": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPROX
  "7800274": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // SYPHAL
  "7800276": ["sulfate de cuivre (Copper compounds) 25.0 %"], // BORDOCUIVRE FORT
  "7800285": ["sulfate de cuivre (Copper compounds) 37.5 %"], // BORDONEBE
  "7800286": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPROZEBE
  "7800301": ["sulfate de cuivre (Copper compounds) 27.5 %"], // BORDOCUIVRE
  "7800305": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BOUILLIE BORDELAISE VALLES
  "7800308": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // FERT'S PULVERISATION TOTALE I.F.
  "7800313": ["sulfate de cuivre (Copper compounds) 17.5 %"], // BOUILLIE CUPRIQUE MOP
  "7800321": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // FERT'S POUDRE TOTALE I.F.
  "7800482": ["sulfate de cuivre (Copper compounds) 27.5 %"], // LACBOUILLIE 25
  "7800487": ["sulfate de cuivre (Copper compounds) 20.0 %"], // VITER ANTI-MILDIOUS
  "7800517": ["sulfate de cuivre (Copper compounds) 17.0 %"], // PLURITOX FONGICIDE
  "7800571": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // TRADIACUIVRE 50
  "7800574": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // TRADIACUIVRE SUPER
  "7800578": ["sulfate de cuivre (Copper compounds) 17.0 %"], // ADIAFIX M
  "7800586": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE TRADIAGRI
  "7800598": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // VITER TOTAL PULVERISATION
  "7800701": ["sulfate de cuivre (Copper compounds) 10.0 %"], // FATOSLACK
  "7800731": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 7.0 %","sulfate de cuivre (Copper compounds) 5.0 %"], // ADIAFIX F
  "7800743": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 12.0 %"], // CUPRO-EUPARENE 20
  "7800773": ["sulfate de cuivre (Copper compounds) 12.0 %"], // CUPROFIX F ACTIVE
  "7900031": ["sulfate de cuivre (Copper compounds) 17.0 %"], // BORTENE MZ
  "7900042": ["sulfate de cuivre (Copper compounds) 12.0 %"], // BORTENE F
  "7900043": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE SEDAGRI
  "7900121": ["sulfate de cuivre (Copper compounds) 12.0 %"], // VINIFOL
  "7900122": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // ZICUBE
  "7900123": ["sulfate de cuivre (Copper compounds) 17.0 %"], // SULFINEBE
  "7900194": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // FISONS POUDRAGE DOUBLE ACTION S
  "7900195": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // FISONS BOUILLIE DOUBLE ACTION S
  "7900206": ["sulfate de cuivre (Copper compounds) 20.0 %"], // FISONS BOUILLIE BORDELAISE
  "7900262": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 2.25 %"], // ANTIDORYPHORES MILDIOU LE PAYSAN POUDRAGE
  "7900282": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.0 %","sulfate de cuivre (Copper compounds) 6.0 %"], // REMILTINE CS
  "7900308": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPRENE 50
  "7900370": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 0.8 %"], // OCCI 918
  "7900379": ["sulfate de cuivre (Copper compounds) 20.0 %"], // KB BOUILLIE BORDELAISE
  "7900436": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUIZEBE
  "7900506": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // IPPAXAN S
  "7900540": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // IPPAXAN
  "7900541": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // IPPAX
  "7900550": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SCORPIOS
  "7900758": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // PULVERISATION TOTALE S UMUPRO JARDIN
  "7900759": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // POUDRAGE TOTAL S UMUPRO JARDIN
  "8000014": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 35.0 %"], // SUPER MACCLESFIELD F 23 35
  "8000190": ["sulfate de cuivre (Copper compounds) 20.0 %"], // VILMORIN BOUILLIE BORDELAISE TRAITEMENT MILDIOU
  "8000266": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE FERT'S
  "8000423": ["sulfate de cuivre (Copper compounds) 20.0 %"], // ECOVIT
  "8000526": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 8.33 %"], // OCCI JARDIN POUDRE MIXTE
  "8000535": ["sulfate de cuivre (Copper compounds) 12.0 %"], // FOLTIMIL
  "8000546": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CYPRENE
  "8000551": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // OXYZINE
  "8000600": ["sulfate de cuivre (Copper compounds) 20.0 %"], // LC.BOUILLIE BORDELAISE
  "8000614": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CALLIMIX
  "8000624": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CALLICUIVRE 50
  "8000641": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE DUPRE
  "8100030": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // FERT' S POUDRAGE TOTAL IF N 1
  "8100031": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // FERT'S PULVERISATION TOTALE IF N 1
  "8100048": ["sulfate de cuivre (Copper compounds) 15.0 %"], // ANTEOR C 500
  "8100124": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE TRUFFAUT
  "8100163": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPRAL 50
  "8100219": ["sulfate de cuivre (Copper compounds) 20.0 %"], // GESAL BOUILLIE BORDELAISE
  "8100276": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 240.0 g/L"], // SYPHAL L
  "8100415": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE ROYAL JARDIN
  "8100423": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // TOTALE POUDRE ROYAL JARDIN
  "8100424": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // TOTALE PULVERISATION ROYAL JARDIN
  "8100445": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPROSTAR
  "8100453": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // LC MULTIPAR POUDRE P
  "8100481": ["sulfate de cuivre (Copper compounds) 80.0 g/L"], // MOLLONA SUPER C LIQUIDE AS
  "8100558": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE ESSOR
  "8200003": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // PULVERISATION TOTALE DUPRE
  "8200024": ["cuivre (Copper compounds) 500.0 g/kg"], // CUPROXYDE MACCLESFIELD 50
  "8200029": ["sulfate de cuivre (Copper compounds) 8.8 %"], // CRIORAM
  "8200219": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // KB MILDIOU S
  "8200493": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // APPROX
  "8200506": ["sulfate de cuivre (Copper compounds) 14.0 %"], // GRAMAC 810
  "8300036": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE PCL
  "8300065": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.1 %"], // AVISO CUP
  "8300123": ["sulfate de cuivre (Copper compounds) 15.0 %"], // BOUILLIE CP 39
  "8300147": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // PULVERISATION TOTALE TERDOR
  "8300170": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 250.0 g/L"], // ANTEOR C FLO
  "8300175": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // POUDRAGE TOTAL V VILMORIN
  "8300176": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // PULVERISATION TOTALE V VILMORIN
  "8300237": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 12.0 %","sulfate de cuivre (Copper compounds) 3.0 %"], // MILTOCUIVRE
  "8300286": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE MOP 20
  "8300346": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.0 %","sulfate de cuivre (Copper compounds) 6.0 %"], // REMILTINE CUIVRE
  "8400101": ["cuivre de l'acetate de cuivre (Copper compounds) 3.15 %","cuivre de l'oxychlorure de cuivre (Copper compounds) 17.5 %"], // VERFOCUIVRE 2
  "8400171": ["sulfate de cuivre (Copper compounds) 8.33 %"], // SULFASTOP CZ
  "8400176": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // KOCIDE 101PM
  "8400207": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // CURTIX P
  "8400240": ["sulfate de cuivre (Copper compounds) 20.0 %"], // VEGEPHYT
  "8400324": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 13.0 %"], // FALTOCURE
  "8400435": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // PRODAZOX
  "8400462": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 20.0 %"], // BORDOCURE
  "8400463": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPROCURE 50
  "8400464": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CURAMIX
  "8500024": ["cuivre de l'acetate de cuivre (Copper compounds) 3.5 %","cuivre de l'oxychlorure de cuivre (Copper compounds) 21.5 %"], // VERFOCUIVRE GL3
  "8500163": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // PROBAN
  "8500426": ["sulfate de cuivre (Copper compounds) 20.0 %"], // COPRAL
  "8500462": ["sulfate de cuivre (Copper compounds) 8.8 %"], // FT 2 M
  "8500600": ["sulfate de cuivre (Copper compounds) 30.0 g/L"], // COPAC E
  "8600063": ["cuivre de l'oxyde cuivreux (Copper compounds) 50.0 %"], // NORDOX 50
  "8600095": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.0 %"], // VILMORIN CUPRIVIL
  "8600195": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 33.0 %"], // DITHANE M 45 SPECIAL VIGNE A
  "8600327": ["sulfate de cuivre (Copper compounds) 11.0 %"], // UC 70 NC
  "8600505": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE DELTA CUIVRE
  "8600565": ["sulfate de cuivre (Copper compounds) 15.6 %"], // FULVAX C 2000
  "8600602": ["cuivre de chelate (EDTA) (Copper compounds) 23.0 g/L"], // ACTIRON CU L 200
  "8700009": ["sulfate de cuivre (Copper compounds) 20.0 %"], // FISONS BOUILLIE BORDELAISE S
  "8700156": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 12.0 %"], // MOLLONA SUPER C 2
  "8700163": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 20.2 %"], // BOUILLIE ARC EN CIEL
  "8700164": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 17.0 %"], // BOUILLIE ARC EN CIEL M 10
  "8700168": ["sulfate de cuivre (Copper compounds) 11.0 %"], // CUPRO DITHANE MZ
  "8700175": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 17.0 %"], // MANOCURE
  "8700190": ["sulfate de cuivre (Copper compounds) 17.0 %"], // GERMICUIVRE BZ
  "8700215": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 17.0 %","sulfate de cuivre (Copper compounds) 9.0 %"], // CUPROSAN F1
  "8700258": ["sulfate de cuivre (Copper compounds) 15.0 %"], // SUPER MACCLESFIELD CUF 15 30
  "8700457": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE COMAC
  "8700467": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE COMPO
  "8700494": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPROSAN V
  "8700495": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPROSAN CVD 35
  "8700506": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 357.5 g/L"], // PASTA CAFFARO
  "8700522": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SEM BOUILLIE BORDELAISE
  "8700532": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 25.0 %"], // ANTEOR CLV 3
  "8700533": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 25.0 %"], // ANTEOR C 3
  "8700595": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 388.3 g/L"], // CHAMPION FLO
  "8800009": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // CAD'JARDIN POUDRAGE
  "8800101": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE CP JARDIN
  "8800122": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 300.0 g/L"], // SYPHAL S
  "8800204": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.3 %","cuivre du carbonate de cuivre (Copper compounds) 4.3 %","sulfate de cuivre (Copper compounds) 3.9 %"], // TRIMILTOX FORT INSTANT
  "8800288": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 10.0 %"], // ROGATE 50
  "8800289": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 8.0 %"], // ROGATE 40
  "8800305": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 35.0 %"], // ACYLON BLEU H
  "8800308": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.0 %","sulfate de cuivre (Copper compounds) 6.0 %"], // REMILTINE CS INSTANT
  "8800310": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.3 %","cuivre du carbonate de cuivre (Copper compounds) 4.3 %","sulfate de cuivre (Copper compounds) 3.9 %"], // TRIMILTOX FORT NC INSTANT
  "8800316": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 33.4 %"], // MOLOSS 2000
  "8800356": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE LE JARDINIER NATUREL
  "8800369": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 23.8 g/L"], // CICATAL  BAUME
  "8800506": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.0 %"], // SEM FONGICURE
  "8800518": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // MASTIC PELTON ANTICHANCRES
  "8800531": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.0 %","sulfate de cuivre (Copper compounds) 6.0 %"], // REMILTINE CS PEPITE
  "8800533": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.0 %","sulfate de cuivre (Copper compounds) 6.0 %"], // REMILTINE CUIVRE PEPITE
  "8800536": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.3 %","cuivre du carbonate de cuivre (Copper compounds) 4.3 %","sulfate de cuivre (Copper compounds) 3.9 %"], // TRIMILTOX FORT PEPITE
  "8800537": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.3 %","cuivre du carbonate de cuivre (Copper compounds) 4.3 %","sulfate de cuivre (Copper compounds) 3.9 %"], // TRIMILTOX FORT NC PEPITE
  "8800589": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 16.0 %"], // BELGRAP MZ
  "8800604": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 33.4 %"], // PRODA MOLOSS
  "8800671": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPROCAFFARO
  "8800896": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE JARDIPOUSS
  "8800926": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 8.0 %"], // DORYPHIT
  "8900008": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 25.0 %"], // SYPHAL LS
  "8900009": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.4 %"], // SYPHAL PM
  "8900077": ["sulfate de cuivre (Copper compounds) 48.0 %"], // CUPROFIX 30
  "8900191": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 77.0 %"], // CHAMPION PM
  "8900310": ["sulfate de cuivre (Copper compounds) 17.0 %"], // VIMACUIVRE 2
  "8900311": ["sulfate de cuivre (Copper compounds) 15.0 %"], // VIFOLCUIVRE 2
  "8900333": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // CUPROSAN DX
  "8900450": ["sulfate de cuivre (Copper compounds) 9.0 %"], // CRIORAM F
  "8900500": ["sulfate de cuivre (Copper compounds) 20.0 %"], // COPRAL NC
  "8900543": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE LE SILLON
  "8900658": ["sulfate de cuivre (Copper compounds) 48.0 %"], // APACHE
  "8900761": ["sulfate de cuivre (Copper compounds) 25.0 %"], // PRODA BBS
  "9000125": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // FONGIFERE
  "9000277": ["hydroxyde de cuivre (Copper compounds) 768.4 g/kg"], // FUNGURAN OH
  "9000384": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // POUDRE TOTALE SOVILO
  "9000453": ["sulfate de cuivre (Copper compounds) 20.0 %"], // PENNCUIVRE
  "9000541": ["sulfate de cuivre (Copper compounds) 12.0 %"], // MYCOTOX C
  "9000555": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOULLIE BORDELAISE JARDINAMI
  "9000595": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE MFR
  "9000743": ["cuivre du tallate de cuivre (Copper compounds) 50.0 g/L"], // SOLUCUIVRE
  "9100007": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 1.9 %"], // CARTOUCHE LEFEVRE
  "9100023": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // TRAITEMENT TOTAL POUDRE TRUFFAUT
  "9100089": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // VILMORIN POUDRAGE TOTAL SP
  "9100104": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 5.0 %"], // BASF HJ TOTAL POUDRAGE C
  "9100114": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // ZINOCUIVRE
  "9100167": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 0.6 %"], // GESAL POUDRAGE TOTAL LC
  "9100168": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 2.0 %"], // GESAL TOTAL FRUIT LC
  "9100258": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 20.0 %"], // GESAL BOUILLIE BORDELAISE S
  "9100262": ["sulfate de cuivre (Copper compounds) 20.0 %"], // VILMORIN BOUILLIE BORDELAISE V
  "9100289": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SAINT HILAIRE BOUILLIE BORDELAISE
  "9100291": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 25.0 %"], // CURSOR GD
  "9100415": ["cuivre (Copper compounds) 6.4 %"], // FOLISTOP L
  "9100416": ["cuivre (Copper compounds) 6.4 %"], // BACTIFOLI-STOP
  "9100498": ["sulfate de cuivre (Copper compounds) 20.0 %"], // ALGONATURE BOUILLIE BORDELAISE
  "9100589": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 388.3 g/L"], // CHAMPION FLO CALLIOPE
  "9100637": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // NUCOP DF
  "9100638": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // NUCOP WP
  "9100639": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // BLUE SHIELD DF
  "9100640": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // BLUE SHIELD WP
  "9100698": ["cuivre (Copper compounds) 33.0 %","cuivre du beta-cyclodextrine-hydroxyde de cuivre (Copper compounds) 33.0 %"], // KLEPTOSE-CUIVRE
  "9200240": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPRO BLEU DG
  "9200244": ["cuivre de chelate (EDTA) (Copper compounds) 596.7 g/L"], // PSEUDOCID L
  "9200254": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPRO BLEU PM
  "9200303": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 200.0 g/kg"], // MIKALIX
  "9200304": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 250.0 g/kg"], // CAP 25
  "9200345": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE OREAL JA
  "9200350": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 15.0 %"], // SOMAZINC F
  "9200351": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 20.0 %"], // SOFOL
  "9200354": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // SOZINEBE C
  "9200358": ["sulfate de cuivre (Copper compounds) 15.0 %"], // SOZICUIVRE
  "9200359": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BOUILLIE SOLAISE
  "9200363": ["sulfate de cuivre (Copper compounds) 17.0 %"], // SULFACUIVRE SUPER
  "9200436": ["oxychlorure de cuivre (Copper compounds) 503.8 g/L"], // SELVA
  "9200457": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // ANTEOR CLV AVANTAGE
  "9200458": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // ANTEOR C AVANTAGE
  "9300180": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // ECRAN BLEU DF
  "9300181": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // ECRAN BLEU PM
  "9300326": ["sulfate de cuivre (Copper compounds) 20.0 %"], // VEGEPHYT B
  "9300365": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %","sulfate de cuivre (Copper compounds) 5.0 %"], // TURBOCUIVRE F
  "9300380": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 33.0 %"], // PROSOLIS MZ
  "9300430": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // TURBO MZ
  "9300490": ["oxychlorure de cuivre (Copper compounds) 840.3 g/kg"], // SODICUIVRE 50
  "9300494": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE TRUFFAUT.
  "9300500": ["sulfate de cuivre (Copper compounds) 13.0 %"], // AGRONEBE
  "9300532": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // CUPROSAN M
  "9300541": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // PARADE
  "9300552": ["sulfate de cuivre (Copper compounds) 20.0 %"], // CUPROCURE BB
  "9300553": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 20.0 %"], // CUPROCURE MF
  "9300554": ["sulfate de cuivre (Copper compounds) 17.0 %"], // CUPROCURE M
  "9300555": ["cuivre du carbonate de cuivre (Copper compounds) 5.0 %","sulfate de cuivre (Copper compounds) 10.0 %"], // CUPROCURE F
  "9300571": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE MANICA
  "9400034": ["sulfate de cuivre (Copper compounds) 20.0 %"], // CUPRIX 20
  "9400095": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.1 %"], // AVISO CUP DF
  "9400345": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // CUIDROX DF
  "9400346": ["oxychlorure de cuivre (Copper compounds) 840.3 g/kg"], // STYROCUIVRE DF
  "9400350": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 25.0 %"], // BOUILLIE BORDELAISE VALLES 25 BLEUE
  "9400351": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CURENOX 50
  "9400352": ["cuivre du sulfate tetracuivrique et tricalcique (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE VALLES 20 BLEUE
  "9400484": ["sulfate de cuivre (Copper compounds) 18.0 %"], // SARMAN MC
  "9400538": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 20.0 %"], // ODYSSEE
  "9400548": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // BAZICUIVRE
  "9500039": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE SIPCAM-PHYTEUROP
  "9500043": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 40.0 %"], // KOCIDE DF
  "9500062": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 4.66 %"], // SPIN OUT
  "9500113": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 30.0 %"], // KOCIDE COMBI
  "9500130": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CUPROR 50
  "9500131": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 37.5 %"], // CUPROR Z
  "9500132": ["sulfate de cuivre (Copper compounds) 7.0 %"], // CUPROR F
  "9500133": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // CUPROR TRIPLE
  "9500163": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // TIP-TOP
  "9500204": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 388.3 g/L"], // PARTNER FLO
  "9500211": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 77.0 %"], // GYPSY
  "9500212": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // GYPSO PM
  "9500249": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE CMPA
  "9500302": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BOUILLIE BORDELAISE MACC 80 JARDINS
  "9500347": ["sulfate de cuivre (Copper compounds) 18.0 %"], // ZETANIL TRIPLE
  "9500411": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BHJ BOUILLIE BORDELAISE
  "9500451": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // COPERNICO DG
  "9500452": ["cuivre (Copper compounds) 200.0 g/kg"], // BOUILLIE BORDELAISE RSR DISPERSS
  "9500464": ["sulfate de cuivre (Copper compounds) 17.0 %"], // CUPROR M
  "9500529": ["sulfate de cuivre (Copper compounds) 11.0 %"], // BELGRAP TRIPLE
  "9500574": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // KOCIDE 50 WP
  "9500575": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // CARAVELLE
  "9500587": ["sulfate de cuivre (Copper compounds) 17.0 %"], // SAFECAP
  "9500589": ["sulfate de cuivre (Copper compounds) 9.0 %"], // COPROFOL
  "9500590": ["sulfate de cuivre (Copper compounds) 8.0 %"], // COPROMAN
  "9500619": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE SPCP
  "9500627": ["sulfate de cuivre (Copper compounds) 12.5 %"], // CUPRITAL
  "9600016": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 388.3 g/L"], // GYPSY FLO
  "9600097": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 360.0 g/L"], // CHAMP FLO
  "9600106": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 40.0 %"], // MILTOREX
  "9600117": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // COSTO
  "9600122": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // AIGUAL
  "9600281": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 87.5 %"], // DELTA C
  "9600431": ["sulfate de cuivre (Copper compounds) 12.0 %"], // DELTACUIVRE F
  "9600466": ["cuivre (Copper compounds) 20.2 %"], // BOUILLIE BORDELAISE CAFFARO
  "9600518": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // OXYCURE
  "9600519": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // OXYSUD
  "9600542": ["sulfate de cuivre (Copper compounds) 17.0 %"], // CUPROFIX M DISPERSS
  "9600543": ["sulfate de cuivre (Copper compounds) 12.0 %"], // CUPROFIX 30 DISPERSS
  "9700010": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 10.0 %"], // ODYSSEE F
  "9700041": ["sulfate de cuivre (Copper compounds) 18.0 %"], // ENOMIX MC
  "9700067": ["cuivre (Copper compounds) 120.0 g/kg"], // CUPROFIX F DISPERSS
  "9700171": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // CLOQUE DU PECHER BASF HJ
  "9700172": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 32.0 %"], // RAMEDIT MZ
  "9700204": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 13.0 %"], // HYDROMAX
  "9700205": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 30.0 %"], // FONGIBLEU
  "9700206": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 32.5 %"], // RESCOUSSE
  "9700280": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 13.7 %"], // PAMPRE
  "9700329": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 300.0 g/L"], // CYMSUN
  "9700361": ["cuivre (Copper compounds) 50.0 g/L"], // BOTRYCUIVRE
  "9700362": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 24.0 %"], // KAURITIL DF
  "9700373": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 40.0 %"], // CUPROFLASH
  "9700394": ["sulfate de cuivre (Copper compounds) 200.0 g/kg"], // BOUILLIE BORDELAISE SIAPA
  "9700399": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // TAFINEX C
  "9700401": ["hydroxyde de cuivre (Copper compounds) 537.5 g/kg"], // KOCIDE 2000
  "9700465": ["sulfate de cuivre tribasique (Copper compounds) 4.0 %"], // ARBOPAST
  "9700557": ["sulfate de cuivre (Copper compounds) 18.0 %"], // AMAROK MC
  "9800052": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 40.0 %"], // KOCIDE 40 DF
  "9800105": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE FIX
  "9800113": ["sulfate de cuivre (Copper compounds) 20.0 %"], // STARCUIVRE
  "9800130": ["sulfate de cuivre (Copper compounds) 20.0 %"], // FISONS BOUILLIE BORDELAISE E
  "9800204": ["cuivre de l'oxyde cuivreux (Copper compounds) 75.0 %"], // NORDOX SUPER 75
  "9800304": ["hydroxyde de cuivre (Copper compounds) 461.1 g/L"], // FUNGURAN-OH 300 SC
  "9800386": ["sulfate de cuivre (Copper compounds) 13.0 %"], // BORDEAUX M
  "9800387": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BORDEAUX PLUS
  "9800388": ["cuivre de l'hydroxyde de cuivre (Copper compounds) 50.0 %"], // PARASOL
  "9800395": ["cuivre (Copper compounds) 20.0 %"], // EQAL DG
  "9800399": ["sulfate de cuivre (Copper compounds) 12.0 %"], // CUPROFIX FM ACTIVE DISPERSS
  "9800400": ["cuivre (Copper compounds) 150.0 g/kg"], // CUPROFIX CM ACTIVE DISPERSS
  "9800447": ["sulfate de cuivre (Copper compounds) 12.5 %"], // SULFASTOP C 2000
  "9800449": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.0 %","sulfate de cuivre (Copper compounds) 6.0 %"], // MISTEL CUIVRE
  "9800451": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 24.0 %","sulfate de cuivre (Copper compounds) 6.0 %"], // FULVAX C PLUS
  "9800464": ["sulfate de cuivre (Copper compounds) 20.0 %"], // PENNKISS
  "9800474": ["cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE RSR DISPERSS NC
  "9900003": ["sulfate de cuivre (Copper compounds) 18.0 %"], // MACC CYMO
  "9900013": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE BORDELAISE RSR NC
  "9900087": ["cuivre (Copper compounds) 120.0 g/kg"], // CUPROFIX 30 DISPERSS NC
  "9900088": ["sulfate de cuivre (Copper compounds) 17.0 %"], // CUPROFIX M DISPERSS NC
  "9900113": ["sulfate de cuivre (Copper compounds) 20.0 %"], // BOUILLIE ULTRA 2015
  "9900149": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 30.0 %"], // CUPROSAN HP
  "9900159": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 50.0 %"], // GYPSO GD
  "9900194": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 140.0 g/L"], // FOLPRAME PASTA
  "9900222": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 20.3 %"], // OCARINA
  "9900227": ["hydroxyde de cuivre (Copper compounds) 614.2 g/L"], // HELIOCUIVRE
  "9900243": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 33.0 %"], // SOPROLYS
  "9900257": ["bouillie bordelaise (Copper compounds) 733.4 g/kg"], // BOUILLIE BORDELAISE SUPER 20 K
  "9900282": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 357.5 g/L"], // CUPROFLO
  "9900326": ["sulfate de cuivre (Copper compounds) 8.8 %"], // BOUILLIE SOLAISE M
  "9900327": ["sulfate de cuivre (Copper compounds) 9.0 %"], // BOUILLIE SOLAISE F
  "9900347": ["sulfate de cuivre tribasique (Copper compounds) 72.0 %"], // CUPRIK B 20
  "9900353": ["sulfate de cuivre (Copper compounds) 20.0 %"], // SOLUTION DISPERSS
  "9900354": ["hydroxyde de cuivre (Copper compounds) 35.0 %"], // KOCIDE 35 DF
  "9900362": ["cuivre de l'oxychlorure de cuivre (Copper compounds) 140.0 g/L"], // FOLPAN C
};
