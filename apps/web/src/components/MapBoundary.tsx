import { Component, type ReactNode } from "react";
import { Center, Text } from "@mantine/core";
import { ErrorPanel, isChunkError } from "./RouteError";

/** WebGL disponible dans ce navigateur ? */
function hasWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Isole une carte (MapLibre, Cesium) : en cas d'erreur, la carte est
 * remplacée par un message et le reste de la page reste utilisable. Le
 * message dit la cause : WebGL absent, application mise à jour (module à
 * recharger), ou l'erreur elle-même.
 */
export class MapBoundary extends Component<{ children: ReactNode; what?: string }, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("Erreur inconnue") };
  }

  override componentDidCatch(error: unknown) {
    console.error("[carte]", error);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isChunkError(error) && !hasWebGl()) {
      return (
        <Center h="100%" p="md">
          <Text size="sm" c="dimmed" ta="center">
            Carte indisponible sur cet appareil (WebGL requis).
          </Text>
        </Center>
      );
    }
    return <ErrorPanel error={error} what={this.props.what ?? "la carte"} />;
  }
}
