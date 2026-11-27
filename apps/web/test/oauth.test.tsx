import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./setup";
import { FARM, renderApp } from "./render";
import { oauthResume } from "../src/features/login/LoginPage";

/**
 * Autorisation d'une application OAuth (lot AM5) : choix de la ferme, puis
 * consentement avec les droits ; reprise de l'autorisation après connexion.
 */
const OTHER = "00000000-0000-7000-8000-0000000000f2";
const Q = "client_id=app-1&scope=fourmy%3Aread&sig=abc&ba_param=client_id";
const request = (farmId: string | null) => ({
  client: { id: "app-1", name: "Assistant d'essai", uri: "https://assistant.exemple.test", icon: null },
  write: false,
  farms: [
    { id: FARM, name: "Ferme démo", role: "owner", grant: { modules: { activities: "write" }, activities: "all" } },
    { id: OTHER, name: "Ferme voisine", role: "reader", grant: { modules: { activities: "read" }, activities: "all" } },
  ],
  farmId,
  current: null,
});

describe("autorisation OAuth", () => {
  it("ferme choisie, puis consentement avec les droits ouverts", async () => {
    let chosen: unknown = null;
    let consent: unknown = null;
    let farmId: string | null = null;
    server.use(
      http.get("*/oauth/request", () => HttpResponse.json(request(farmId))),
      http.post("*/oauth/farm", async ({ request: r }) => {
        chosen = await r.json();
        farmId = FARM;
        return HttpResponse.json({ url: `/oauth/consentement?${Q}` });
      }),
      http.post("*/oauth/consent", async ({ request: r }) => {
        consent = await r.json();
        return HttpResponse.json({ url: "https://assistant.exemple.test/callback?code=c" });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp(`/oauth/ferme?${Q}`);
    expect(await screen.findByRole("heading", { name: "Connecter « Assistant d'essai »" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Ferme démo/ }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(chosen).toEqual({ farmId: FARM, oauthQuery: Q });

    expect(await screen.findByRole("heading", { name: "Autoriser « Assistant d'essai » ?" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/oauth/consentement");
    expect(screen.getByText("Ferme démo")).toBeInTheDocument();
    const stocks = screen.getByRole("radiogroup", { name: "Accès au module Stocks et semences" });
    await user.click(within(stocks).getByText("Lecture"));
    await user.click(screen.getByRole("button", { name: "Autoriser" }));
    await vi.waitFor(() => expect(consent).not.toBeNull());
    expect(consent).toEqual({
      accept: true,
      grant: { modules: { activities: "read", interventions: "read", stocks: "read" }, activities: "all" },
      oauthQuery: Q,
    });
  });

  it("refus : rien n'est ouvert", async () => {
    let consent: unknown = null;
    server.use(
      http.get("*/oauth/request", () => HttpResponse.json(request(FARM))),
      http.post("*/oauth/consent", async ({ request: r }) => {
        consent = await r.json();
        return HttpResponse.json({ url: "https://assistant.exemple.test/callback?error=access_denied" });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/oauth/consentement?${Q}`);
    await user.click(await screen.findByRole("button", { name: "Refuser" }));
    await vi.waitFor(() => expect(consent).toEqual({ accept: false, oauthQuery: Q }));
  });

  it("demande invalide : message, pas de formulaire", async () => {
    renderApp("/oauth/consentement?client_id=app-1");
    expect(await screen.findByText(/invalide ou a expiré/)).toBeInTheDocument();
  });

  it("après connexion, l'autorisation reprend sans la signature", () => {
    expect(oauthResume(new URLSearchParams("client_id=a&scope=fourmy%3Aread&sig=s&ba_iat=1&ba_param=scope"))).toBe(
      "/api/auth/oauth2/authorize?client_id=a&scope=fourmy%3Aread",
    );
    expect(oauthResume(new URLSearchParams("next=/farms"))).toBeNull();
  });
});
