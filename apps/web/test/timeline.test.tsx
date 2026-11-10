import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FARM, renderApp } from "./render";

describe("frise temporelle", () => {
  it("porte la date dans l'URL et la conserve en naviguant", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}?at=2021-12-31`);
    const date = (await screen.findByLabelText("Date de la frise")) as HTMLInputElement;
    expect(date.value).toBe("2021-12-31");
    expect(await screen.findByRole("heading", { name: "Au 31/12/2021" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Jour précédent" }));
    expect(router.state.location.search).toBe("?at=2021-12-30");

    fireEvent.change(date, { target: { value: "2020-06-15" } });
    expect(router.state.location.search).toBe("?at=2020-06-15");

    await user.click(screen.getByRole("button", { name: "Stocks" }));
    await user.click(await screen.findByRole("link", { name: "Cuverie" }));
    expect(router.state.location.pathname).toBe(`/f/${FARM}/cellar`);
    expect(router.state.location.search).toBe("?at=2020-06-15");
  });

  it("« Aujourd'hui » retire la date de l'URL", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}?at=2021-12-31`);
    await user.click(await screen.findByRole("button", { name: "Aujourd'hui" }));
    expect(router.state.location.search).toBe("");
  });
});
