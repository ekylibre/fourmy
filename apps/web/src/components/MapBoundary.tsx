import { Component, type ReactNode } from "react";
import { Center, Text } from "@mantine/core";

/**
 * Isole une carte (MapLibre, Cesium) : sans WebGL ou en cas d'erreur de
 * rendu, la carte est remplacée par un message et le reste de la page reste
 * utilisable.
 */
export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <Center h="100%" p="md">
          <Text size="sm" c="dimmed" ta="center">
            Carte indisponible sur cet appareil (WebGL requis).
          </Text>
        </Center>
      );
    }
    return this.props.children;
  }
}
