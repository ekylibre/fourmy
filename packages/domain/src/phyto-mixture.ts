/**
 * Mélanges de produits phytosanitaires (arrêté du 7 avril 2010 modifié par
 * l'arrêté du 12 juin 2015) : chaque produit a des catégories de mélange
 * (E-Phy, `mix_category_codes`). Règle reprise d'Ekylibre
 * (`mix_category_code_validator.rb`) :
 * - catégorie 5 : le produit ne se mélange avec aucun autre ;
 * - catégories 2, 3 et 4 : deux produits de la même catégorie ne se
 *   mélangent pas entre eux ;
 * - catégorie 1 : pas de restriction.
 */

export interface MixtureProduct {
  articleId: string;
  name: string;
  mixCodes: number[];
}

export interface MixtureIssue {
  articleIds: string[];
  message: string;
}

export interface MixtureCheck {
  level: "ok" | "danger";
  issues: MixtureIssue[];
}

const CATEGORY_LABELS: Record<number, string> = {
  2: "catégorie 2",
  3: "catégorie 3",
  4: "catégorie 4",
};

export function checkMixture(products: MixtureProduct[]): MixtureCheck {
  const issues: MixtureIssue[] = [];
  if (products.length > 1) {
    for (const p of products.filter((x) => x.mixCodes.includes(5))) {
      issues.push({
        articleIds: products.map((x) => x.articleId),
        message: `${p.name} ne se mélange avec aucun autre produit (catégorie 5).`,
      });
    }
    for (const code of [2, 3, 4]) {
      const same = products.filter((x) => x.mixCodes.includes(code));
      if (same.length > 1) {
        issues.push({
          articleIds: same.map((x) => x.articleId),
          message: `Mélange interdit : ${same.map((x) => x.name).join(" et ")} sont tous de ${CATEGORY_LABELS[code]}.`,
        });
      }
    }
  }
  return { level: issues.length ? "danger" : "ok", issues };
}

/** Messages bloquants d'un contrôle (feux rouges des produits et du mélange). */
export function dangerMessages(result: {
  checks: { indicators: { level: string; message: string }[] }[];
  mixture?: { issues: { message: string }[] } | null;
}): string[] {
  return [
    ...result.checks.flatMap((c) => c.indicators.filter((i) => i.level === "danger").map((i) => i.message)),
    ...(result.mixture?.issues ?? []).map((i) => i.message),
  ];
}
