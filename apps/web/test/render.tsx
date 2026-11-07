import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DEMO_FARM_ID, DEMO_USER_ID } from "@fourmy/mocks";
import { Providers, createQueryClient } from "../src/app/providers";
import { routes } from "../src/app/router";
import { signIn } from "../src/app/session";

export const FARM = DEMO_FARM_ID;

/** Rend l'application complète à une URL donnée, utilisateur de démo connecté. */
export function renderApp(path: string, { signedIn = true } = {}) {
  if (signedIn) signIn(DEMO_USER_ID);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  const utils = render(
    <Providers client={client} env="test">
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router };
}
