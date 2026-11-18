import { screen, within } from "@testing-library/react";
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
