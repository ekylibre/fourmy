import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import "mantine-datatable/styles.css";
import "@fourmy/ui-lyvre/lyvre.css";
import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "@fourmy/ui-lyvre";
import { ApiError } from "./api";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // On ne réessaie pas un refus ou une requête invalide.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
}

export function Providers({
  client,
  children,
  env = "default",
}: {
  client: QueryClient;
  children: ReactNode;
  /** « test » : Mantine désactive transitions et portails (tests de composants). */
  env?: "default" | "test";
}) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto" env={env}>
      <Notifications position="top-right" />
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}
