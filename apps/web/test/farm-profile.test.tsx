import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { DEMO_HQ_ID } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** « Ma ferme », lot F1 : accès, lecture seule, identité, saisie assistée de l'adresse du siège. */
describe("Ma ferme", () => {
  it("s'ouvre depuis le bouton du tableau de bord (R1)", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}`);
    // Le bouton du tableau de bord (le menu a aussi une entrée « Ma ferme »).
    await user.click(await within(await screen.findByRole("main")).findByRole("link", { name: "Ma ferme" }, { timeout: 10_000 }));
    expect(await screen.findByRole("heading", { name: "Ma ferme", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Identité de la ferme" })).toBeInTheDocument();
  });

  it("signale sur le tableau de bord un certificat qui expire bientôt (E8)", async () => {
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    server.use(
      http.get(`*/api/v1/farms/${FARM}/farm`, () =>
        HttpResponse.json({
          identity: { name: "Ferme de démonstration", legalName: null, legalForm: null, siret: null, vatNumber: null, nafCode: null, pacage: null, cvi: null, ede: null, phone: null, email: null, legalRep: null },
          certifications: [
            { id: "c1", kind: "organic", body: "Ecocert", number: "FR-BIO-01", level: null, expiresOn: soon },
            { id: "c2", kind: "hve", body: null, number: null, level: "3", expiresOn: later },
          ],
          sites: [],
          parcelsOutside: null,
          display: { basemap: "ortho", areaUnit: "ha" },
          canEdit: true,
        }),
      ),
    );
    renderApp(`/f/${FARM}`);
    expect(await screen.findByText("Certificats à renouveler", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/Agriculture biologique \(FR-BIO-01\) : expire le/)).toBeInTheDocument();
    expect(screen.queryByText(/Haute valeur environnementale/)).not.toBeInTheDocument();
  });

  it("est en lecture seule pour un salarié (E3)", async () => {
    server.use(
      http.get(`*/api/v1/farms/${FARM}/farm`, () =>
        HttpResponse.json({
          identity: { name: "Ferme de démonstration", legalName: null, legalForm: null, siret: "73282932000074", vatNumber: null, nafCode: null, pacage: null, cvi: null, ede: null, phone: null, email: null, legalRep: null },
          certifications: [],
          sites: [],
          parcelsOutside: null,
          display: { basemap: "ortho", areaUnit: "ha" },
          canEdit: false,
        }),
      ),
    );
    renderApp(`/f/${FARM}/farm`);
    expect(await screen.findByText("Lecture seule")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "SIRET" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Enregistrer l'identité" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter un certificat" })).not.toBeInTheDocument();
  });

  it("contrôle le SIRET, propose la TVA et enregistre l'identité (R4)", async () => {
    const user = userEvent.setup();
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put(`*/api/v1/farms/${FARM}/farm/identity`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sent);
      }),
    );
    renderApp(`/f/${FARM}/farm`);
    const siret = await screen.findByRole("textbox", { name: "SIRET" });
    await user.type(siret, "73282932000075");
    expect(screen.getByText("SIRET invalide : la clé de contrôle ne correspond pas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer l'identité" })).toBeDisabled();

    await user.clear(siret);
    await user.type(siret, "40483304800014");
    await user.click(screen.getByRole("button", { name: "Utiliser FR83404833048 (déduit du SIREN)" }));
    expect(screen.getByRole("textbox", { name: "N° de TVA intracommunautaire" })).toHaveValue("FR83404833048");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'identité" }));
    await waitFor(() => expect(sent).toMatchObject({ siret: "40483304800014", vatNumber: "FR83404833048", name: "Ferme de démonstration" }));
  });

  it("remplit l'adresse du siège depuis une suggestion IGN (R2)", async () => {
    const user = userEvent.setup();
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put(`*/api/v1/farms/${FARM}/farm/sites/${DEMO_HQ_ID}`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: DEMO_HQ_ID, isHeadquarters: true, ...sent });
      }),
    );
    renderApp(`/f/${FARM}/farm?tab=sites`);
    expect(await screen.findByText("Le siège n'est pas encore placé")).toBeInTheDocument();
    await user.click(within(screen.getByLabelText("Site Siège")).getByRole("button", { name: "Modifier" }));
    const form = await screen.findByRole("form", { name: "Site" });
    await user.type(within(form).getAllByLabelText("Adresse")[0]!, "1 place pey");
    await user.click(await screen.findByRole("option", { name: "1 Place Pey Berland 33000 Bordeaux" }));
    expect(within(form).getAllByLabelText("Adresse")[0]!).toHaveValue("1 Place Pey Berland");
    expect(within(form).getByRole("textbox", { name: "Code postal" })).toHaveValue("33000");
    expect(within(form).getByRole("textbox", { name: "Ville" })).toHaveValue("Bordeaux");
    expect(within(form).getByText(/Point calculé depuis l'adresse/)).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(sent).toMatchObject({
        address: { line1: "1 Place Pey Berland", postalCode: "33000", city: "Bordeaux", inseeCode: "33063" },
        location: { lat: 44.838168, lon: -0.578803 },
        locationSource: "geocoded",
        geocode: { score: 0.977, type: "housenumber" },
      }),
    );
  });

  it("affiche les surfaces en ares si la ferme l'a choisi (F2, E21 bis)", async () => {
    const { demoFarmProfileFor } = await import("./farm-fixtures");
    server.use(http.get(`*/api/v1/farms/${FARM}/farm`, () => HttpResponse.json(demoFarmProfileFor({ areaUnit: "a" }))));
    renderApp(`/f/${FARM}`);
    const kpi = await screen.findByText("Parcelles", {}, { timeout: 10_000 });
    await waitFor(() => expect(kpi.parentElement!.textContent).toMatch(/\d[\d\s]* a$/));
  });

  it("enregistre le fond de carte et l'unité par défaut (F2, E9)", async () => {
    const user = userEvent.setup();
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put(`*/api/v1/farms/${FARM}/settings/display`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sent);
      }),
    );
    renderApp(`/f/${FARM}/farm?tab=sites`);
    const panel = await screen.findByLabelText("Affichage");
    await user.click(within(panel).getByText("Plan IGN"));
    await user.click(within(panel).getByText("Ares"));
    await user.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(sent).toEqual({ basemap: "plan", areaUnit: "a" }));
  });

  it("regroupe les réglages : la page Entretien renvoie vers Ma ferme (E22)", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/maintenance`);
    await user.click(await screen.findByRole("link", { name: "seuils et alertes d'entretien" }, { timeout: 10_000 }));
    // L'ancien onglet Entretien est une section de Préférences.
    expect(await screen.findByRole("tab", { name: "Préférences", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Entretien" })).toBeInTheDocument();
    expect(await screen.findByLabelText("« Bientôt » : heures avant l'échéance")).toBeInTheDocument();
  });

  it("imprime le logo de la ferme, sinon celui de Fourmy, et la raison sociale (F3, R10)", async () => {
    const { demoFarmProfileFor } = await import("./farm-fixtures");
    const profile = { ...demoFarmProfileFor(), logoAssetId: "00000000-0000-7000-8000-00000000a0a0" };
    profile.identity = { ...profile.identity, legalName: "GAEC du Pré", siret: "73282932000074" };
    server.use(http.get(`*/api/v1/farms/${FARM}/farm`, () => HttpResponse.json(profile)));
    const first = renderApp(`/f/${FARM}/print/fertilization/record?campaign=2026`);
    await waitFor(() => expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("src", `/api/v1/farms/${FARM}/assets/00000000-0000-7000-8000-00000000a0a0`));
    expect(await screen.findByText(/\(GAEC du Pré\) · SIRET 73282932000074/)).toBeInTheDocument();
    first.unmount();

    renderApp(`/f/${FARM}/print/fertilization/record?campaign=2026`);
    await waitFor(() => expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("src", "/favicon.svg"));
  });

  it("dépose le logo de la ferme depuis l'onglet Identité (F3, E8 bis)", async () => {
    let received = "";
    server.use(
      http.put(`*/api/v1/farms/${FARM}/farm/logo`, async ({ request }) => {
        // Corps multipart lu tel quel. Sous jsdom, le fichier arrive sans son nom
        // ni ses octets (File de jsdom vu comme un Blob vide par undici) : on
        // vérifie le champ et le type, l'API teste le contenu.
        received = await request.text();
        return HttpResponse.json({ logoAssetId: "00000000-0000-7000-8000-00000000a0a1" });
      }),
    );
    renderApp(`/f/${FARM}/farm`);
    expect(await screen.findByRole("img", { name: "Logo de Fourmy (par défaut)" })).toBeInTheDocument();
    // Champ caché de FileButton : on lui donne le fichier directement.
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(received).toMatch(/name="file"[^]*Content-Type: image\/png/));
  });
});
