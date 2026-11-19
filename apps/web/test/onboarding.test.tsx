import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./setup";
import { renderApp } from "./render";

/** Assistant de premier démarrage (lot IM6) : erreurs lisibles, jamais l'écran par défaut de React Router. */
describe("assistant de premier démarrage", () => {
  it("API en erreur à l'étape 1 : message, progression rassurée, réessai", async () => {
    server.use(http.get("*/api/v1/me/farms", () => HttpResponse.json({ title: "Erreur interne" }, { status: 500 })));
    renderApp("/onboarding");
    expect(await screen.findByText("Cette étape a rencontré une erreur", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mes fermes" })).toHaveAttribute("href", "/farms");
    expect(screen.queryByText(/ErrorBoundary or errorElement/)).not.toBeInTheDocument();
  });

  it("compte avec droit et sans ferme : la création de la ferme", async () => {
    server.use(http.get("*/api/v1/me/farms", () => HttpResponse.json({ userId: "u", canCreateFarm: true, items: [] })));
    renderApp("/farms");
    expect(await screen.findByRole("heading", { name: "Bienvenue dans Fourmy" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Ma ferme" })).toBeInTheDocument();
  });
});
