// Point d'entrée de l'application web Fourmy.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { Providers, createQueryClient } from "./app/providers";
import { createRouter } from "./app/router";
import { registerServiceWorker } from "./app/offline";

registerServiceWorker(); // copie hors ligne des fermes (« Ma ferme » F5)

const router = createRouter();
const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
