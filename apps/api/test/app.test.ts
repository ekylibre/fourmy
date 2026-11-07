import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

/** Garde d'entrée, sans base : santé, identité, ferme invalide, 404. */
const app = createApp();
const farm = "/api/v1/farms/00000000-0000-7000-8000-000000000001";

describe("api : garde d'entrée", () => {
  it("répond sur /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("401 sans identité, ou identité qui n'est pas un UUID", async () => {
    expect((await app.request(`${farm}/snapshot`)).status).toBe(401);
    const res = await app.request(`${farm}/snapshot`, { headers: { "x-user-id": "u1" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("400 si la ferme n'est pas un UUID", async () => {
    const res = await app.request("/api/v1/farms/f1/snapshot", {
      headers: { "x-user-id": "00000000-0000-7000-8000-0000000000aa" },
    });
    expect(res.status).toBe(400);
  });

  it("404 en problem+json pour une route inconnue", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
