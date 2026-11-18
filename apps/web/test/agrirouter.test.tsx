import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { INTEGRATION_PROVIDERS, type Integration } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** agrirouter, lot AR1 : connexion lancée depuis agrirouter (Deep URL), connexion défaite constatée. */
const OTHER = "00000000-0000-7000-8000-0000000000f2";
const providers = INTEGRATION_PROVIDERS.map((p) => (p.provider === "agrirouter" ? { ...p, available: true } : p));
const agrirouter = (over: Partial<Integration>): Integration => ({
  id: "00000000-0000-7000-8000-00000000a9e0",
  provider: "agrirouter",
  settings: {},
  hasSecret: true,
  secretHint: null,
  enabled: true,
  status: "ok",
  running: false,
  lastSyncAt: null,
  lastError: null,
  lastReport: null,
  ...over,
});
const farms = (items: { id: string; name: string; role: string }[]) => http.get("*/api/v1/me/farms", () => HttpResponse.json({ userId: "mock", items }));
const integrations = (items: Integration[]) => http.get("*/integrations", () => HttpResponse.json({ providers, items }));

describe("agrirouter : connexion depuis agrirouter", () => {
  it("non connecté : passe par la connexion et revient sur la page", async () => {
    const { router } = renderApp("/agrirouter/start", { signedIn: false });
    await screen.findByRole("heading", { name: "Connexion" });
    expect(router.state.location.pathname).toBe("/login");
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe("/agrirouter/start");
  });

  it("une seule ferme dont on est responsable : confirmation directe", async () => {
    server.use(farms([{ id: FARM, name: "Ferme de démonstration", role: "owner" }]), integrations([]));
    renderApp("/agrirouter/start");
    expect(await screen.findByText(/Connecter la ferme/)).toHaveTextContent("Connecter la ferme Ferme de démonstration à agrirouter ?");
    expect(screen.getByRole("button", { name: "Connecter à agrirouter" })).toBeEnabled();
  });

  it("plusieurs fermes : choix, puis confirmation ; ferme déjà connectée signalée", async () => {
    server.use(
      farms([
        { id: FARM, name: "Ferme de démonstration", role: "owner" },
        { id: OTHER, name: "GAEC du Moulin", role: "owner" },
        { id: "00000000-0000-7000-8000-0000000000f3", name: "Ferme voisine", role: "worker" },
      ]),
      integrations([agrirouter({})]),
    );
    const user = userEvent.setup();
    renderApp("/agrirouter/start");
    await user.click(await screen.findByRole("radio", { name: "GAEC du Moulin" }));
    // Seules les fermes dont on est responsable sont proposées.
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual([FARM, OTHER]);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText("La ferme GAEC du Moulin est déjà connectée à agrirouter.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir ses intégrations" })).toHaveAttribute("href", `/f/${OTHER}/integrations`);
  });

  it("responsable d'aucune ferme : message clair", async () => {
    server.use(farms([{ id: FARM, name: "Ferme de démonstration", role: "worker" }]));
    renderApp("/agrirouter/start");
    expect(await screen.findByText(/Seul le responsable d'une ferme peut la connecter/)).toBeInTheDocument();
  });
});

describe("agrirouter : connexion défaite dans agrirouter", () => {
  it("carte « Déconnectée » avec la date, le motif et « Reconnecter »", async () => {
    server.use(
      integrations([
        agrirouter({
          hasSecret: false,
          status: "disconnected",
          lastError: "L'autorisation de Fourmy a été retirée dans agrirouter.",
          settings: { disconnectedAt: "2026-11-16T10:00:00Z", disconnectReason: "revoked" },
        }),
      ]),
    );
    renderApp(`/f/${FARM}/integrations`);
    const card = await screen.findByTestId("integration-agrirouter");
    expect(within(card).getByText("Déconnectée le 16/11/2026")).toBeInTheDocument();
    expect(within(card).getByText(/L'autorisation de Fourmy a été retirée dans agrirouter\./)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reconnecter" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Retirer" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Connecter à agrirouter" })).toBeNull();
  });
});

describe("agrirouter : fichiers reçus (AR2)", () => {
  it("liste les fichiers reçus avec leur type, leur état et le lien de téléchargement", async () => {
    server.use(
      http.get("*/agrirouter/inbox", () =>
        HttpResponse.json({
          items: [
            {
              id: "00000000-0000-7000-8000-0000000001b0",
              messageType: "iso:11783:-10:taskdata:zip",
              filename: "tache.zip",
              size: 2048,
              senderEndpointId: null,
              senderName: null,
              sentAt: null,
              receivedAt: "2026-11-16T09:30:00Z",
              state: "received",
              error: null,
              confirmedAt: null,
              confirmError: null,
              tasks: [],
              devices: [],
              telemetry: null,
            },
          ],
        }),
      ),
    );
    renderApp(`/f/${FARM}/agrirouter/inbox`);
    const table = await screen.findByRole("table", { name: "Fichiers reçus d'agrirouter" });
    expect(within(table).getByText("Tâches ISO-XML")).toBeInTheDocument();
    expect(within(table).getByText("tache.zip")).toBeInTheDocument();
    expect(within(table).getByText("(2 Ko)")).toBeInTheDocument();
    expect(within(table).getByText("Reçu")).toBeInTheDocument();
    expect(within(table).getByText("Non confirmé")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Télécharger" })).toHaveAttribute("href", `/api/v1/farms/${FARM}/agrirouter/inbox/00000000-0000-7000-8000-0000000001b0/file`);
  });
});

describe("agrirouter : travail reçu d'une console (AR4)", () => {
  const PARCEL = "00000000-0000-7000-8000-0000000000c1";
  const TRACTOR = "00000000-0000-7000-8000-0000000000c2";
  const task = {
    index: 0,
    designator: "Azote 3e apport F1234abcd",
    startedAt: "2026-03-20T08:00:00.000Z",
    stoppedAt: "2026-03-20T09:30:00.000Z",
    parcels: [{ id: PARCEL, name: "Grand Champ", share: 1 }],
    equipment: null,
    deviceName: "Epandeur",
    products: ["Ammonitrate 33,5"],
    rates: [{ value: 150, unit: "kg/ha" }],
    areaM2: 118000,
    prescription: { id: "00000000-0000-7000-8000-0000000000c3", name: "Azote 3e apport" },
    interventionId: null,
    draft: {
      body: {
        staffing: "crews",
        crews: [{ tools: [{ equipmentId: TRACTOR }], doers: [], periods: [{ startedAt: "2026-03-20T08:00:00.000Z", stoppedAt: "2026-03-20T09:30:00.000Z" }] }],
        periods: [], tools: [], doers: [],
        targets: [{ kind: "land_parcel", id: PARCEL, workedAreaM2: 118000 }],
        inputs: [], outputs: [], purposes: [], trackSessionIds: [],
        agrirouterInbox: { id: "00000000-0000-7000-8000-0000000001b1", task: 0 },
      },
      procedureSuggestions: [],
      hints: ["Tâche « Azote 3e apport F1234abcd » reçue de la console par agrirouter."],
      parcelNames: { [PARCEL]: "Grand Champ" },
    },
  };
  const item = (over: Record<string, unknown>) => ({
    id: "00000000-0000-7000-8000-0000000001b1",
    messageType: "iso:11783:-10:taskdata:zip",
    filename: "retour.zip",
    size: 4096,
    senderEndpointId: null,
    senderName: null,
    sentAt: null,
    receivedAt: "2026-03-20T10:00:00Z",
    state: "proposed",
    error: null,
    confirmedAt: "2026-03-20T10:00:05Z",
    confirmError: null,
    tasks: [task],
    devices: [],
    telemetry: null,
    ...over,
  });

  it("proposition : parcelle, matériel non reconnu, produit et dose, carte d'origine ; écarter", async () => {
    let dismissed = false;
    server.use(
      http.get("*/agrirouter/inbox", () => HttpResponse.json({ items: [item(dismissed ? { state: "dismissed" } : {})] })),
      http.post("*/agrirouter/inbox/:id/dismiss", () => {
        dismissed = true;
        return HttpResponse.json(item({ state: "dismissed" }));
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/agrirouter/inbox`);
    const proposal = await screen.findByLabelText("Tâche Azote 3e apport F1234abcd");
    expect(within(proposal).getByText(/Parcelle : Grand Champ/)).toBeInTheDocument();
    expect(within(proposal).getByText("« Epandeur » non reconnu")).toBeInTheDocument();
    expect(within(proposal).getByText("Produit : Ammonitrate 33,5 · dose moyenne relevée 150 kg/ha")).toBeInTheDocument();
    expect(within(proposal).getByRole("link", { name: "Azote 3e apport" })).toHaveAttribute("href", `/f/${FARM}/prescriptions/00000000-0000-7000-8000-0000000000c3`);
    expect(within(proposal).getByRole("button", { name: "Créer l'intervention" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Écarter" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Créer l'intervention" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Écarter" })).toBeNull();
  });

  it("intervention déjà enregistrée : lien vers elle, plus de création", async () => {
    server.use(http.get("*/agrirouter/inbox", () => HttpResponse.json({ items: [item({ state: "validated", tasks: [{ ...task, interventionId: "00000000-0000-7000-8000-0000000000d1" }] })] })));
    renderApp(`/f/${FARM}/agrirouter/inbox`);
    expect(await screen.findByRole("link", { name: "Intervention enregistrée" })).toHaveAttribute("href", `/f/${FARM}/interventions/00000000-0000-7000-8000-0000000000d1`);
    expect(screen.queryByRole("button", { name: "Créer l'intervention" })).toBeNull();
  });

  it("créer l'intervention : formulaire pré-rempli avec le bandeau du travail reçu", async () => {
    server.use(http.get("*/agrirouter/inbox", () => HttpResponse.json({ items: [item({})] })));
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}/agrirouter/inbox`);
    await user.click(await screen.findByRole("button", { name: "Créer l'intervention" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/f/${FARM}/interventions/new`));
    expect(router.state.location.search).toBe("?at=2026-03-20");
    const banner = await screen.findByLabelText("Travail reçu d'agrirouter");
    expect(within(banner).getByText("Travail reçu de la console par agrirouter")).toBeInTheDocument();
    expect(within(banner).getByText(/reçue de la console par agrirouter/)).toBeInTheDocument();
  });
});

describe("agrirouter : descriptions de machine et journaux EFDI (AR5)", () => {
  const EQ = "00000000-0000-7000-8000-0000000000e1";
  const base = {
    messageType: "iso:11783:-10:device_description:protobuf",
    filename: null,
    size: 512,
    senderEndpointId: null,
    senderName: null,
    sentAt: null,
    receivedAt: "2026-04-16T07:29:00Z",
    error: null,
    confirmedAt: "2026-04-16T07:29:05Z",
    confirmError: null,
    tasks: [],
  };

  it("description de machine : matériel reconnu, largeur proposée et reportée ; journal versé aux parcours", async () => {
    let applied = false;
    const device = {
      index: 0, designator: "ZA-TS", serial: "AMZ-1", equipment: { id: EQ, name: "Épandeur" },
      workingWidthM: 24, currentWidthM: 18, sections: 2, proposeWidth: true, applied: false,
    };
    server.use(
      http.get("*/agrirouter/inbox", () =>
        HttpResponse.json({
          items: [
            { ...base, id: "00000000-0000-7000-8000-0000000002a1", state: applied ? "validated" : "proposed", devices: [{ ...device, applied, currentWidthM: applied ? 24 : 18 }], telemetry: null },
            {
              ...base,
              id: "00000000-0000-7000-8000-0000000002a2",
              messageType: "iso:11783:-10:time_log:protobuf",
              state: "merged",
              devices: [],
              telemetry: { equipment: { id: EQ, name: "Fendt" }, tool: "Épandeur", positions: 300, from: "2026-04-16T07:30:00Z", to: "2026-04-16T07:34:59Z" },
            },
          ],
        }),
      ),
      http.post("*/agrirouter/inbox/:id/devices/0/apply", () => {
        applied = true;
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/agrirouter/inbox`);
    const machine = await screen.findByLabelText("Machine ZA-TS");
    expect(within(machine).getByText(/largeur 24 m · 2 sections \(fiche : 18 m\)/)).toBeInTheDocument();
    expect(within(machine).getByRole("link", { name: "Épandeur" })).toHaveAttribute("href", `/f/${FARM}/equipments/${EQ}`);
    await user.click(within(machine).getByRole("button", { name: "Reporter 24 m sur la fiche" }));
    expect(await within(await screen.findByLabelText("Machine ZA-TS")).findByText("reportée sur la fiche")).toBeInTheDocument();

    expect(screen.getByText("Enregistrement de travail (TimeLog)")).toBeInTheDocument();
    expect(screen.getByText("Versé aux parcours")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "parcours de Fendt" })).toHaveAttribute("href", `/f/${FARM}/equipments/${EQ}?tab=tracks`);
    expect(screen.getByText(/300 positions du/)).toHaveTextContent("(attelé : Épandeur)");
  });
});
