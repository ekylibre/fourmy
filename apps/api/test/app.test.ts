import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("api skeleton", () => {
  it("répond sur /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("exige l'authentification sur une route ferme", async () => {
    const res = await app.request("/api/v1/farms/f1/snapshot");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("renvoie 501 pour une route déclarée mais non implémentée", async () => {
    const res = await app.request("/api/v1/farms/f1/stock", {
      headers: { "x-user-id": "u1" },
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.status).toBe(501);
  });

  it("404 en problem+json pour une route inconnue", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});
