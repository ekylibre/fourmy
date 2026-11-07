import { describe, it, expect } from "vitest";
import { snapshot, containerContents, trackCoverage } from "@fourmy/contracts";
import { demoSnapshot, demoContainerContents, demoTrackCoverage } from "../src/index.js";

describe("fixtures conformes aux contrats", () => {
  it("le snapshot de démo valide le schéma", () => {
    expect(snapshot.safeParse(demoSnapshot).success).toBe(true);
  });
  it("le contenu de cuve de démo valide le schéma", () => {
    expect(containerContents.safeParse(demoContainerContents).success).toBe(true);
  });
  it("la couverture de trace de démo valide le schéma", () => {
    expect(trackCoverage.safeParse(demoTrackCoverage).success).toBe(true);
  });
});
