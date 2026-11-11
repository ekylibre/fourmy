/**
 * Azote potentiellement libéré jusqu'en sortie d'hiver (APLSH) des
 * fertilisants organiques : références du COMIFER (groupe COMIFER / RMT
 * Bouclage, rapport d'août 2023 mis à jour en novembre 2024, fichier
 * « COMIFER_APLSH-References_2024-11 »). Pourcentage de l'azote total apporté,
 * par zone climatique et par quinzaine d'apport, du 01/07 au 15/11.
 *
 * Deux entrées : la dénomination du produit (tableaux 13 à 17 du rapport) ou
 * ses caractéristiques, C/N et part d'azote minéral (tableaux 7 à 12). Les
 * cases absentes du fichier sont absentes ici : rien n'est interpolé.
 * Généré depuis le fichier du COMIFER (clés « plus » et « moins » ajoutées pour
 * distinguer les deux fumiers de bovins stockés plus ou moins de 2 mois).
 */

import type { Source, Table } from "../types.js";

export const APLSH_SOURCE: Source = {
  title: "Évaluation de l'azote potentiellement libéré jusqu'en sortie d'hiver par les fertilisants organiques — références",
  organisation: "COMIFER / RMT Bouclage",
  date: "2024-11-08",
  url: "https://comifer.asso.fr/",
  ref: "COMIFER_APLSH-References_2024-11_Web.xlsx ; rapport final, tableaux 7 à 17",
  licence: "Références du COMIFER, reprises telles quelles ; accord de réutilisation demandé",
};

export const APLSH_ZONES = {
  bassin_sud_ouest: "Bassin du Sud-Ouest",
  oceanique_altere: "Océanique altéré",
  oceanique_degrade: "Océanique dégradé des plaines",
  semi_continental: "Semi-continental",
  montagne: "Montagne",
} as const;
export type AplshZone = keyof typeof APLSH_ZONES;

/** Quinzaines d'apport des tables (MM-JJ) : un apport prend la référence de la date qui le précède. */
export const APLSH_DATES = ["07-01", "07-15", "08-01", "08-15", "09-01", "09-15", "10-01", "10-15", "11-01", "11-15"] as const;

export interface AplshProductRow {
  key: string;
  /** Dénomination imprimée par le COMIFER. */
  name: string;
  /** Type de fertilisant (0, Ia, Ib, II). */
  type: string;
  /** Pourcentage par zone et par quinzaine (ordre de APLSH_DATES). */
  percent: Partial<Record<AplshZone, number[]>>;
}
export const aplshProducts: Table<AplshProductRow> = {
  id: "comifer-aplsh-2024-products",
  source: { ...APLSH_SOURCE, ref: "Tableaux 13 à 17 : selon la dénomination du produit" },
  rows: [
    {
      "key": "boues_mixte_de_papeteries_c_n_35",
      "name": "Boues mixte de papeteries C/N>35",
      "type": "0",
      "percent": {
        "bassin_sud_ouest": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          0
        ],
        "oceanique_altere": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "oceanique_degrade": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          0
        ],
        "semi_continental": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          0
        ],
        "montagne": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          0,
          0
        ]
      }
    },
    {
      "key": "compost_de_dechets_verts_jeunes_et_ligneux_peu_mature",
      "name": "Compost de déchets verts jeunes et ligneux (peu mature)",
      "type": "0",
      "percent": {
        "bassin_sud_ouest": [
          10,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "oceanique_altere": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "oceanique_degrade": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "semi_continental": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "montagne": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ]
      }
    },
    {
      "key": "compost_de_fumier_de_bovins",
      "name": "Compost de fumier de bovins",
      "type": "Ia",
      "percent": {
        "bassin_sud_ouest": [
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          5,
          5
        ],
        "oceanique_altere": [
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          5
        ],
        "oceanique_degrade": [
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          5,
          5,
          5
        ],
        "semi_continental": [
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          5,
          5
        ],
        "montagne": [
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          10,
          5,
          5
        ]
      }
    },
    {
      "key": "compost_de_fractions_solides_de_digestats_de_methanisation",
      "name": "Compost de fractions solides de digestats de méthanisation",
      "type": "Ia",
      "percent": {
        "bassin_sud_ouest": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "oceanique_altere": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "oceanique_degrade": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "semi_continental": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ],
        "montagne": [
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ]
      }
    },
    {
      "key": "compost_de_lisiers_de_porcs_pailles",
      "name": "Compost de lisiers de porcs + pailles",
      "type": "Ia",
      "percent": {
        "bassin_sud_ouest": [
          35,
          35,
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30
        ],
        "oceanique_altere": [
          35,
          35,
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30
        ],
        "oceanique_degrade": [
          35,
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30
        ],
        "semi_continental": [
          35,
          35,
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30
        ],
        "montagne": [
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30,
          30
        ]
      }
    },
    {
      "key": "fumier_de_bovins_logettes_paillee_aire_couverte_stockage_plus_2_mois",
      "name": "Fumier de bovins, logettes paillée, aire couverte, stockage > 2 mois",
      "type": "Ia",
      "percent": {
        "bassin_sud_ouest": [
          45,
          40,
          40,
          40,
          35,
          35,
          35,
          30,
          30,
          30
        ],
        "oceanique_altere": [
          45,
          40,
          40,
          40,
          35,
          35,
          30,
          30,
          30,
          30
        ],
        "oceanique_degrade": [
          40,
          40,
          40,
          35,
          35,
          35,
          30,
          30,
          30,
          30
        ],
        "semi_continental": [
          45,
          40,
          40,
          40,
          35,
          35,
          30,
          30,
          30,
          30
        ],
        "montagne": [
          40,
          40,
          35,
          35,
          35,
          30,
          30,
          30,
          30,
          25
        ]
      }
    },
    {
      "key": "compost_de_boues_et_de_dechets_verts_2",
      "name": "Compost de boues et de déchets verts 2",
      "type": "Ib",
      "percent": {
        "bassin_sud_ouest": [
          45,
          45,
          45,
          40,
          40,
          40,
          35,
          30,
          30,
          25
        ],
        "oceanique_altere": [
          45,
          45,
          45,
          40,
          40,
          35,
          35,
          30,
          30,
          25
        ],
        "oceanique_degrade": [
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          30,
          25,
          25
        ],
        "semi_continental": [
          45,
          45,
          45,
          40,
          40,
          35,
          35,
          30,
          25,
          25
        ],
        "montagne": [
          45,
          45,
          40,
          40,
          35,
          35,
          30,
          30,
          25,
          25
        ]
      }
    },
    {
      "key": "compost_de_boues_et_de_dechets_verts_3",
      "name": "Compost de boues et de déchets verts 3",
      "type": "Ib",
      "percent": {
        "bassin_sud_ouest": [
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          30,
          30,
          25
        ],
        "oceanique_altere": [
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          30,
          30,
          25
        ],
        "oceanique_degrade": [
          45,
          45,
          40,
          40,
          35,
          35,
          35,
          30,
          30,
          25
        ],
        "semi_continental": [
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          30,
          25,
          25
        ],
        "montagne": [
          40,
          40,
          40,
          40,
          35,
          35,
          30,
          30,
          25,
          25
        ]
      }
    },
    {
      "key": "fumier_de_bovins_stockage_moins_2_mois",
      "name": "Fumier de bovins, stockage < 2 mois",
      "type": "Ib",
      "percent": {
        "bassin_sud_ouest": [
          50,
          50,
          50,
          50,
          45,
          45,
          45,
          40,
          40,
          40
        ],
        "oceanique_altere": [
          50,
          50,
          50,
          50,
          45,
          45,
          45,
          40,
          40,
          40
        ],
        "oceanique_degrade": [
          50,
          50,
          50,
          45,
          45,
          45,
          40,
          40,
          40,
          40
        ],
        "semi_continental": [
          50,
          50,
          50,
          50,
          45,
          45,
          40,
          40,
          40,
          40
        ],
        "montagne": [
          50,
          50,
          45,
          45,
          45,
          45,
          40,
          40,
          40,
          40
        ]
      }
    },
    {
      "key": "fumier_de_porcs_a_l_engrais_a_base_de_paille",
      "name": "Fumier de porcs à l'engrais à base de paille",
      "type": "Ib",
      "percent": {
        "bassin_sud_ouest": [
          50,
          50,
          45,
          45,
          40,
          40,
          40,
          40,
          35,
          35
        ],
        "oceanique_altere": [
          50,
          50,
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          35
        ],
        "oceanique_degrade": [
          50,
          45,
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          35
        ],
        "semi_continental": [
          50,
          50,
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          35
        ],
        "montagne": [
          45,
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          35,
          35
        ]
      }
    },
    {
      "key": "fumier_de_poulets_de_chair_apres_stockage",
      "name": "Fumier de poulets de chair (après stockage)",
      "type": "Ib",
      "percent": {
        "bassin_sud_ouest": [
          45,
          45,
          45,
          45,
          40,
          40,
          35,
          35,
          30,
          25
        ],
        "oceanique_altere": [
          45,
          45,
          45,
          45,
          40,
          40,
          35,
          35,
          30,
          25
        ],
        "oceanique_degrade": [
          45,
          45,
          45,
          40,
          40,
          35,
          35,
          30,
          30,
          25
        ],
        "semi_continental": [
          45,
          45,
          45,
          45,
          40,
          40,
          35,
          30,
          30,
          25
        ],
        "montagne": [
          45,
          45,
          40,
          40,
          40,
          35,
          35,
          30,
          25,
          25
        ]
      }
    },
    {
      "key": "digestats_brut_de_methanisation_1",
      "name": "Digestats brut de méthanisation 1",
      "type": "II",
      "percent": {
        "bassin_sud_ouest": [
          75,
          75,
          75,
          75,
          75,
          70,
          70,
          70,
          70,
          70
        ],
        "oceanique_altere": [
          75,
          75,
          75,
          75,
          75,
          70,
          70,
          70,
          70,
          70
        ],
        "oceanique_degrade": [
          75,
          75,
          75,
          75,
          75,
          70,
          70,
          70,
          70,
          70
        ],
        "semi_continental": [
          75,
          75,
          75,
          75,
          70,
          70,
          70,
          70,
          70,
          70
        ],
        "montagne": [
          75,
          75,
          75,
          75,
          75,
          75,
          70,
          70,
          70,
          70
        ]
      }
    },
    {
      "key": "digestats_brut_de_methanisation_2",
      "name": "Digestats brut de méthanisation 2",
      "type": "II",
      "percent": {
        "bassin_sud_ouest": [
          70,
          70,
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          60
        ],
        "oceanique_altere": [
          70,
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          65,
          65
        ],
        "oceanique_degrade": [
          70,
          70,
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          65
        ],
        "semi_continental": [
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          65,
          65,
          60
        ],
        "montagne": [
          70,
          70,
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          65
        ]
      }
    },
    {
      "key": "digestats_brut_de_methanisation_3",
      "name": "Digestats brut de méthanisation 3",
      "type": "II",
      "percent": {
        "bassin_sud_ouest": [
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          55,
          55
        ],
        "oceanique_altere": [
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          60,
          55,
          55
        ],
        "oceanique_degrade": [
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          55,
          55
        ],
        "semi_continental": [
          65,
          65,
          60,
          60,
          60,
          60,
          60,
          60,
          55,
          55
        ],
        "montagne": [
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          55,
          55
        ]
      }
    },
    {
      "key": "fientes_de_poules_pondeuses_stockage_en_fosses_profondes",
      "name": "Fientes de poules pondeuses (stockage en fosses profondes)",
      "type": "II",
      "percent": {
        "bassin_sud_ouest": [
          50,
          50,
          50,
          50,
          50,
          50,
          50,
          50,
          45,
          40
        ],
        "oceanique_altere": [
          50,
          50,
          50,
          50,
          50,
          50,
          50,
          50,
          45,
          40
        ],
        "oceanique_degrade": [
          50,
          50,
          50,
          50,
          50,
          50,
          50,
          45,
          45,
          40
        ],
        "semi_continental": [
          50,
          50,
          50,
          50,
          50,
          50,
          50,
          45,
          45,
          40
        ],
        "montagne": [
          50,
          50,
          50,
          50,
          50,
          50,
          50,
          45,
          40,
          35
        ]
      }
    },
    {
      "key": "fraction_liquide_des_digestats_de_methanisation",
      "name": "Fraction liquide des digestats de méthanisation",
      "type": "II",
      "percent": {
        "bassin_sud_ouest": [
          70,
          70,
          70,
          65,
          65,
          65,
          65,
          60,
          60,
          60
        ],
        "oceanique_altere": [
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          60,
          60,
          60
        ],
        "oceanique_degrade": [
          70,
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          60,
          60
        ],
        "semi_continental": [
          70,
          65,
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60
        ],
        "montagne": [
          70,
          70,
          70,
          65,
          65,
          65,
          65,
          65,
          60,
          60
        ]
      }
    },
    {
      "key": "lisier_bovin_logettes_raclage_en_systeme_couvert",
      "name": "Lisier bovin, logettes, raclage en système couvert",
      "type": "II",
      "percent": {
        "bassin_sud_ouest": [
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          60,
          60
        ],
        "oceanique_altere": [
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          60,
          60
        ],
        "oceanique_degrade": [
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          60,
          60
        ],
        "semi_continental": [
          65,
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          60,
          60
        ],
        "montagne": [
          65,
          65,
          65,
          60,
          60,
          60,
          60,
          60,
          60,
          60
        ]
      }
    },
    {
      "key": "lisier_mixte_de_porc",
      "name": "Lisier mixte de porc",
      "type": "II",
      "percent": {
        "bassin_sud_ouest": [
          80,
          80,
          80,
          80,
          75,
          75,
          75,
          75,
          75,
          75
        ],
        "oceanique_altere": [
          80,
          80,
          80,
          80,
          75,
          75,
          75,
          75,
          75,
          75
        ],
        "oceanique_degrade": [
          80,
          80,
          80,
          75,
          75,
          75,
          75,
          75,
          75,
          75
        ],
        "semi_continental": [
          80,
          80,
          80,
          80,
          75,
          75,
          75,
          75,
          75,
          75
        ],
        "montagne": [
          80,
          80,
          75,
          75,
          75,
          75,
          75,
          75,
          75,
          75
        ]
      }
    }
  ],
};

/** Classe : borne basse exclue, borne haute incluse ; null : sans borne. */
export interface AplshRange {
  above: number | null;
  atMost: number | null;
}
export interface AplshAnalyticRow {
  zone: AplshZone;
  cN: AplshRange;
  /** Part de l'azote minéral dans l'azote total (%). */
  mineralPct: AplshRange;
  percent: number[];
}
export const aplshAnalytic: Table<AplshAnalyticRow> = {
  id: "comifer-aplsh-2024-analytic",
  source: { ...APLSH_SOURCE, ref: "Tableaux 7 à 12 : selon le C/N et la part d'azote minéral" },
  rows: [
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        50,
        50,
        50,
        50,
        50,
        45,
        45,
        40
      ]
    },
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        75,
        75,
        75,
        75,
        70,
        70,
        70,
        70,
        70,
        70
      ]
    },
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        45,
        45,
        45,
        40,
        40,
        35,
        30,
        30
      ]
    },
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        55,
        55
      ]
    },
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        25,
        25,
        25,
        20,
        20,
        20,
        15,
        15,
        15,
        15
      ]
    },
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 20.0,
        "atMost": 40.0
      },
      "percent": [
        45,
        45,
        45,
        40,
        40,
        40,
        35,
        35,
        35,
        35
      ]
    },
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        60,
        55
      ]
    },
    {
      "zone": "bassin_sud_ouest",
      "cN": {
        "above": 20.0,
        "atMost": null
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        5,
        5,
        5,
        5,
        5,
        5,
        0,
        0,
        0,
        0
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        50,
        50,
        50,
        50,
        50,
        45,
        45,
        40
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        75,
        75,
        75,
        70,
        70,
        70,
        70,
        70,
        70,
        70
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        45,
        45,
        40,
        40,
        40,
        35,
        30,
        30
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        60,
        55,
        55
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        25,
        25,
        20,
        20,
        20,
        20,
        15,
        15,
        15,
        15
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 20.0,
        "atMost": 40.0
      },
      "percent": [
        45,
        45,
        40,
        40,
        40,
        40,
        35,
        35,
        35,
        35
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        60,
        55
      ]
    },
    {
      "zone": "oceanique_altere",
      "cN": {
        "above": 20.0,
        "atMost": null
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        5,
        5,
        5,
        5,
        5,
        5,
        0,
        0,
        0,
        0
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        50,
        50,
        50,
        50,
        50,
        50,
        45,
        40
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        75,
        75,
        75,
        75,
        70,
        70,
        70,
        70,
        70,
        70
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        45,
        45,
        45,
        40,
        40,
        35,
        30,
        30
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        55,
        55
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        25,
        25,
        25,
        20,
        20,
        20,
        15,
        15,
        15,
        15
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 20.0,
        "atMost": 40.0
      },
      "percent": [
        45,
        45,
        40,
        40,
        40,
        40,
        40,
        35,
        35,
        35
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        60,
        55
      ]
    },
    {
      "zone": "oceanique_degrade",
      "cN": {
        "above": 20.0,
        "atMost": null
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        5,
        5,
        5,
        5,
        5,
        5,
        0,
        0,
        0,
        0
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        50,
        50,
        50,
        50,
        50,
        45,
        40,
        35
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        75,
        75,
        70,
        70,
        70,
        70,
        70,
        70,
        70,
        70
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        45,
        45,
        45,
        45,
        40,
        40,
        35,
        35,
        30,
        30
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        60,
        60,
        60,
        60,
        60,
        60,
        55,
        55
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        25,
        25,
        20,
        20,
        20,
        15,
        15,
        15,
        15,
        15
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 20.0,
        "atMost": 40.0
      },
      "percent": [
        45,
        45,
        40,
        40,
        40,
        40,
        35,
        35,
        35,
        35
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        60,
        55,
        55
      ]
    },
    {
      "zone": "semi_continental",
      "cN": {
        "above": 20.0,
        "atMost": null
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        5,
        5,
        5,
        5,
        5,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        50,
        50,
        50,
        50,
        50,
        50,
        45,
        40
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": null,
        "atMost": 8.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        75,
        75,
        75,
        75,
        70,
        70,
        70,
        70,
        70,
        70
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        50,
        50,
        45,
        45,
        45,
        40,
        40,
        35,
        35,
        30
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": 8.0,
        "atMost": 10.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        55,
        55
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        25,
        25,
        25,
        20,
        20,
        20,
        20,
        15,
        15,
        15
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 20.0,
        "atMost": 40.0
      },
      "percent": [
        45,
        45,
        45,
        45,
        40,
        40,
        40,
        35,
        35,
        35
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": 10.0,
        "atMost": 20.0
      },
      "mineralPct": {
        "above": 40.0,
        "atMost": null
      },
      "percent": [
        65,
        65,
        65,
        65,
        60,
        60,
        60,
        60,
        60,
        55
      ]
    },
    {
      "zone": "montagne",
      "cN": {
        "above": 20.0,
        "atMost": null
      },
      "mineralPct": {
        "above": null,
        "atMost": 20.0
      },
      "percent": [
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        0,
        0,
        0
      ]
    }
  ],
};

/**
 * Zone climatique par défaut d'un département de Nouvelle-Aquitaine. Ni le
 * référentiel régional ni le rapport ne la fixent : choix de Fourmy d'après
 * les stations du rapport (tableau 6 : Bergerac, 24, « Bassin du Sud-Ouest » ;
 * Poitiers, 86, « Océanique altéré »), modifiable dans les paramètres de la ferme.
 */
const DEFAULT_ZONE_BY_DEPARTMENT: Record<string, AplshZone> = {
  "24": "bassin_sud_ouest",
  "33": "bassin_sud_ouest",
  "40": "bassin_sud_ouest",
  "47": "bassin_sud_ouest",
  "64": "bassin_sud_ouest",
  "16": "oceanique_altere",
  "17": "oceanique_altere",
  "79": "oceanique_altere",
  "86": "oceanique_altere",
  "19": "oceanique_altere",
  "23": "oceanique_altere",
  "87": "oceanique_altere",
};
export const defaultAplshZone = (department: string | null): AplshZone | null => (department ? (DEFAULT_ZONE_BY_DEPARTMENT[department] ?? null) : null);

const fortnight = (date: string) => {
  const md = date.slice(5, 10);
  let k = 0;
  APLSH_DATES.forEach((d, i) => {
    if (md >= d) k = i;
  });
  return k; // avant le 01/07 : référence du 01/07 ; après le 15/11 : celle du 15/11
};
const inRange = (v: number, r: AplshRange) => (r.above === null || v > r.above) && (r.atMost === null || v <= r.atMost);

/**
 * Pourcentage d'APLSH d'un apport organique : par la dénomination si elle est
 * choisie, sinon par le C/N et la part minérale ; null si la table n'a pas la
 * case (rien n'est supposé).
 */
export function aplshPercent(input: { zone: AplshZone; date: string; productKey?: string | null; cN?: number | null; mineralPct?: number | null }): { percent: number; source: string } | null {
  const k = fortnight(input.date);
  const label = `${APLSH_DATES[k]!.slice(3)}/${APLSH_DATES[k]!.slice(0, 2)}`;
  if (input.productKey) {
    const p = aplshProducts.rows.find((r) => r.key === input.productKey)?.percent[input.zone];
    if (p) return { percent: p[k]!, source: `COMIFER 2024, ${aplshProducts.rows.find((r) => r.key === input.productKey)!.name}, ${APLSH_ZONES[input.zone]}, apport du ${label}` };
  }
  if (input.cN != null && input.mineralPct != null) {
    const row = aplshAnalytic.rows.find((r) => r.zone === input.zone && inRange(input.cN!, r.cN) && inRange(input.mineralPct!, r.mineralPct));
    if (row) return { percent: row.percent[k]!, source: `COMIFER 2024, C/N ${input.cN} et ${Math.round(input.mineralPct)} % d'azote minéral, ${APLSH_ZONES[input.zone]}, apport du ${label}` };
  }
  return null;
}
