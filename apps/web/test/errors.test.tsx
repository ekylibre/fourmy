import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MapBoundary } from "../src/components/MapBoundary";
import { errorMessage, isChunkError } from "../src/components/RouteError";

/** Erreurs de chargement : cause dite (application mise à jour, erreur), rechargement proposé. */
function Boom({ error }: { error: Error }): never {
  throw error;
}

describe("erreurs de chargement", () => {
  it("reconnaît un module à recharger après une mise à jour", () => {
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: http://x/src/3d/Plan3DPage.tsx"))).toBe(true);
    expect(isChunkError(new Error("Invalid vec3 value"))).toBe(false);
  });

  it("lit le message d'une erreur Cesium (objet, pas Error)", () => {
    expect(errorMessage({ name: "TypeError", message: "d is not a function", stack: "h/u[o]<@http://x/cesium/Workers/createGeometry.js:26:4820\n" })).toBe(
      "TypeError : d is not a function (h/u[o]<@http://x/cesium/Workers/createGeometry.js:26:4820)",
    );
    expect(errorMessage({ code: 3 })).toBe('{"code":3}');
  });

  it("une carte en erreur dit pourquoi et propose de recharger", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MantineProvider>
        <MapBoundary what="la vue 3D">
          <Boom error={new TypeError("Failed to fetch dynamically imported module: /src/3d/Plan3DPage.tsx")} />
        </MapBoundary>
      </MantineProvider>,
    );
    expect(screen.getByText("Fourmy a été mis à jour")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recharger la page" })).toBeInTheDocument();
  });
});
