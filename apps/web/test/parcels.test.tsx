import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Fiche d'une parcelle (lot H) : onglets général, cultures PAC, cadastre, eau, interventions. */
const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const shape = { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]]] };

describe("fiche d'une parcelle", () => {
  it("onglets : activité et certifications, cultures déclarées à la PAC, cadastre, eau", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/land-parcels/:id/sheet", () =>
        HttpResponse.json({
          id: PARCEL,
          name: "Les Rouffiats",
          shape,
          areaM2: 12000,
          center: [0.5005, 44.8005],
          pacIslet: null,
          since: "2020-01-01T00:00:00Z",
          until: null,
          productions: [{ year: 2026, activity: { id: "a", name: "Vignes AOP", color: null, pictureUrl: null } }],
          cadastre: [
            { idu: "33001000AB0012", label: "AB 12 Saint-Caprais", areaM2: 9000, overlapM2: 8000, geometry: shape },
            { idu: "33001000AB0013", label: "AB 13 Saint-Caprais", areaM2: 4000, overlapM2: 3, geometry: shape },
          ],
          cap: [{ id: "1", year: 2024, cropCode: "VRC", cropLabel: "Vigne", areaM2: 11900, overlapM2: 11800 }],
          referencesFetchedAt: "2026-11-08T10:00:00Z",
          water: [{ id: "w", name: "Ruisseau du Moulin", kind: "line", permanent: true, ditch: false, distanceM: 42, geometry: { type: "LineString", coordinates: [[0.5, 44.8], [0.51, 44.81]] } }],
          interventions: [{ id: "00000000-0000-7000-8000-000000000401", procedure: "spraying", status: "done", at: "2026-06-10T06:00:00Z" }],
        }),
      ),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-06-10`);
    expect(await screen.findByRole("heading", { name: "Les Rouffiats", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Activités par campagne" })).toHaveTextContent("Vignes AOP");
    expect((await screen.findAllByText("AB")).length).toBeGreaterThan(0); // certification du faux serveur

    await user.click(screen.getByRole("tab", { name: /Cultures/ }));
    expect(screen.getByRole("table", { name: "Cultures déclarées à la PAC" })).toHaveTextContent("Vigne (VRC)");

    await user.click(screen.getByRole("tab", { name: "Cadastre (1)" }));
    const cadastre = screen.getByRole("table", { name: "Parcelles cadastrales" });
    expect(within(cadastre).getByText("AB 12 Saint-Caprais")).toBeInTheDocument();
    expect(within(cadastre).queryByText("AB 13 Saint-Caprais")).not.toBeInTheDocument();
    expect(screen.getByText(/1 autre\(s\) parcelle\(s\) cadastrale\(s\) touchée\(s\) à la marge/)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Eau à proximité/ }));
    expect(screen.getByRole("table", { name: "Eau à proximité" })).toHaveTextContent("Ruisseau du Moulin");
    expect(screen.getByText("42 m")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Interventions/ }));
    expect(screen.getByRole("link", { name: "Pulvérisation" })).toBeInTheDocument();
  });
});
