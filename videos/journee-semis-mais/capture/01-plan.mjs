// 7 h 10 : Pierre prépare le semis de Lespourcy (intervention à planifier), puis l'enregistre.
import { OUT, open, shot, FARM, IDS, BASE } from "./session.mjs";
const { browser, page } = await open("2026-04-16T07:10:00+02:00");
await page.goto(`${BASE}/f/${FARM}/interventions/new?procedure=all_in_one_sowing&status=planned&parcels=${IDS.lespourcy}`);
await page.waitForTimeout(3000);

const pick = async (label, text) => {
  const box = page.getByRole("combobox", { name: label }).last();
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: new RegExp(text) }).first().click();
  await page.keyboard.press("Escape");
};
await pick("Matériels", "Claas Arion 430");
await pick("Matériels", "Monosem");
await pick("Intervenants", "Pierre");

const inputs = [
  ["DKC5432", "90"],
  ["14-48 liquide", "120"],
  ["Taste", "5"],
  ["Ercole", "15"],
];
for (const [name, qty] of inputs) {
  await page.getByRole("button", { name: "Ajouter un intrant" }).click();
  const product = page.getByRole("combobox", { name: "Produit" }).last();
  await product.click();
  await product.fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).first().click();
  await page.getByRole("textbox", { name: "Quantité" }).last().fill(qty);
}
await page.waitForTimeout(6000);
// Plans serrés : formulaire (haut, intrants), contrôles phyto, directive nitrates, météo.
const form = page.getByRole("form", { name: "Saisie de l'intervention" });
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page, "01-plan-haut");
await page.getByText("Intrants", { exact: true }).scrollIntoViewIfNeeded();
await shot(page, "01-plan-intrants");
await page.locator('[aria-label="Contrôle nitrates"]').first().screenshot({ path: `${OUT}01-plan-nitrates.png` });
await page.locator('[aria-label="Contrôle réglementaire"]').first().screenshot({ path: `${OUT}01-plan-phyto.png` });
await page.getByText("4 · Météo").scrollIntoViewIfNeeded();
await shot(page, "01-plan-meteo");
void form;
await page.getByRole("button", { name: "Planifier" }).click();
await page.waitForURL(/\/interventions\/[0-9a-f-]{36}/, { timeout: 20000 });
await page.waitForTimeout(4000);
console.log("intervention", page.url().split("/").pop());
await shot(page, "01-fiche-planifiee");
await browser.close();
