// Mise en scène : plan de fumure de Lespourcy établi en mars (copie fourmy_video).
import { open, FARM } from "./session.mjs";
const { browser, page } = await open("2026-03-10T09:00:00+01:00");
const r = await page.evaluate(async (farm) => {
  const plan = "cf2792fe-b026-4f60-9a2f-59785432f0e1";
  const res = await fetch(`/api/v1/farms/${farm}/fertilization/plans/${plan}/establish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: null }) });
  const body = await res.json();
  return [res.status, body.currentVersion, body.versions?.[0]?.doseEfficient, body.result?.missing];
}, FARM);
console.log(JSON.stringify(r));
await browser.close();
