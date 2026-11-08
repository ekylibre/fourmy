import { Box, ThemeIcon } from "@mantine/core";
import { Cable, Factory, Tractor, Truck, Wrench } from "lucide-react";
import type { ComponentType } from "react";

const KIND_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  tractor: Tractor,
  self_propelled_equipment: Truck,
  trailed_equipment: Wrench,
  fixed_equipment: Factory,
  connected_object: Cable,
};

/** Visuel par défaut des tracteurs (kit Ekylibre, illustration isométrique). */
export const TRACTOR_PICTURE = "/kit/tracteur.svg";

/** Adresse d'un fichier de la ferme (logo). */
export const assetUrl = (farmId: string, assetId: string) => `/api/v1/farms/${farmId}/assets/${assetId}`;

/**
 * Logo 2D d'un matériel (FR-MAT-80) : le sien, sinon celui de sa marque
 * (résolu par l'API), sinon le dessin du kit pour un tracteur, sinon un
 * pictogramme selon la nature. Toujours en
 * `<img>` : un SVG n'est jamais injecté dans la page.
 */
export function EquipmentLogo({ farmId, assetId, kind, size = 32 }: { farmId: string; assetId: string | null; kind: string; size?: number }) {
  if (assetId) {
    return (
      <Box w={size} h={size} style={{ flex: "none", display: "grid", placeItems: "center" }}>
        <img src={assetUrl(farmId, assetId)} alt="" style={{ maxWidth: size, maxHeight: size, objectFit: "contain" }} />
      </Box>
    );
  }
  // Tracteur sans logo : le dessin « tracteur bleu » du kit Ekylibre.
  if (kind === "tractor") {
    return (
      <Box w={size} h={size} style={{ flex: "none", display: "grid", placeItems: "center" }}>
        <img src={TRACTOR_PICTURE} alt="" style={{ maxWidth: size, maxHeight: size, objectFit: "contain" }} />
      </Box>
    );
  }
  const Icon = KIND_ICONS[kind] ?? Wrench;
  return (
    <ThemeIcon variant="light" color="lichen" size={size} radius="sm" aria-hidden>
      <Icon size={Math.round(size * 0.6)} />
    </ThemeIcon>
  );
}

/** Version PNG d'un SVG (512 px de large), produite dans le navigateur : texture 3D. */
export async function rasterizeSvg(file: File, width = 512): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width * ratio));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Envoi d'un logo (multipart) ; un SVG part avec sa version PNG. */
export async function uploadLogo(path: string, file: File): Promise<{ logoAssetId: string }> {
  const form = new FormData();
  form.set("file", file);
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    const png = await rasterizeSvg(file);
    if (png) form.set("raster", png, "logo.png");
  }
  const res = await fetch(`${globalThis.location?.origin ?? ""}/api/v1${path}`, { method: "PUT", body: form, credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? body.title ?? `Erreur ${res.status}`);
  }
  return res.json();
}
