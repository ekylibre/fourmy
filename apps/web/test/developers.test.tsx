import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Page « Développeurs » (lot AM7) : authentification, premier appel avec
 * l'identifiant de la ferme, référence tirée d'openapi.json.
 */
const op = (operationId: string, tag: string, summary: string, parameters: unknown[] = []) => ({
  get: {
    operationId,
    summary,
    tags: [tag],
    parameters: [{ $ref: "#/components/parameters/farmId" }, ...parameters],
    responses: { "200": { description: summary, content: { "application/json": { schema: { $ref: `#/components/schemas/${operationId}` } } } } },
  },
});
const DOC = {
  info: { title: "API Fourmy", version: "1.2.3", description: "" },
  servers: [{ url: "https://fourmy.test/api/v1" }],
  tags: [
    { name: "parcels", description: "Parcellaire" },
    { name: "stocks", description: "Stocks et semences" },
  ],
  paths: {
    "/farms/{farmId}/land-parcels/names": op("landParcelsNames", "parcels", "Noms des parcelles"),
    "/farms/{farmId}/stock": op("stock", "stocks", "État des stocks", [
      { name: "article", in: "query", required: false, description: "Article (identifiant)", schema: { type: "string", format: "uuid" } },
    ]),
  },
  components: {
    schemas: { landParcelsNames: { type: "object", properties: { items: { type: "array" } } }, stock: { type: "object" } },
    securitySchemes: { oauth2: { flows: { authorizationCode: { authorizationUrl: "https://fourmy.test/api/auth/oauth2/authorize", tokenUrl: "https://fourmy.test/api/auth/oauth2/token" } } } },
  },
};

describe("page Développeurs", () => {
  it("exemple avec la ferme, référence par module, filtre et schéma", async () => {
    server.use(http.get("*/api/v1/openapi.json", () => HttpResponse.json(DOC)));
    const user = userEvent.setup();
    renderApp(`/developpeurs?ferme=${FARM}`);
    expect(await screen.findByRole("heading", { name: "Développeurs" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Identifiant de la ferme" })).toHaveValue(FARM);
    expect(await screen.findByText(/2 routes, version 1\.2\.3/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`https://fourmy.test/api/v1/farms/${FARM}/land-parcels/names`))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Parcellaire" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stocks et semences" })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Filtrer les routes" }), "stock");
    expect(screen.queryByRole("heading", { name: "Parcellaire" })).not.toBeInTheDocument();
    await user.click(screen.getByText("/farms/{farmId}/stock"));
    expect(await screen.findByRole("table", { name: "Paramètres de stock" })).toBeInTheDocument();
    expect(screen.getByText("identifiant")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Schéma de la réponse (stock)" }));
    expect(screen.getByRole("button", { name: "Masquer le schéma" })).toBeInTheDocument();
  });

  it("sans ferme : chemin générique, page publique", async () => {
    server.use(http.get("*/api/v1/openapi.json", () => HttpResponse.json(DOC)));
    renderApp("/developpeurs");
    expect(await screen.findByText(/farms\/\{farmId\}\/land-parcels\/names/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Identifiant de la ferme" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Adresse du serveur MCP" })).toBeInTheDocument();
  });
});
