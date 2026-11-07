import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { FARM, renderApp } from "./render";

describe("stocks et registre phyto", () => {
  it("liste les stocks, lieu nommé, négatifs signalés", async () => {
    renderApp(`/f/${FARM}/stocks`);
    expect(await screen.findByText("Fongicide X")).toBeInTheDocument();
    expect(screen.getByText("LOT-A")).toBeInTheDocument();
    expect(screen.getByText("Chai")).toBeInTheDocument(); // placeId → nom
    expect(screen.getByText(/1 ligne\(s\) en stock négatif/)).toBeInTheDocument();
  });

  it("affiche le registre de la campagne et l'exporte en CSV", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:registre");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderApp(`/f/${FARM}/registre?at=2026-06-30`);
    expect(await screen.findByText("1 application(s) en 2026.")).toBeInTheDocument();
    expect(screen.getByText("2100001")).toBeInTheDocument();
    expect(screen.getByText("2 L/ha")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Exporter en CSV/ }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});
