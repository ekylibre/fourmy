import "./cesium-base";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useEffect, useRef } from "react";
import { Cartesian3, Color, HeadingPitchRange, HeadingPitchRoll, Math as CesiumMath, Transforms, Viewer, type Entity } from "cesium";

/**
 * Aperçu d'un avatar 3D (lot M) : Cesium sans globe, le modèle seul, vu de
 * trois quarts avant. Le GLB est passé en octets (généré dans le navigateur
 * pendant le réglage, ou importé).
 */
export default function AvatarPreview({ glb, height = 320, sizeM = 6, centerM = 0 }: { glb: Uint8Array | null; height?: number; sizeM?: number; centerM?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const entity = useRef<Entity | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const v = new Viewer(container.current, {
      globe: false,
      baseLayer: false,
      skyBox: false,
      skyAtmosphere: false,
      geocoder: false,
      baseLayerPicker: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });
    v.scene.backgroundColor = Color.fromCssColorString("#EEF1EC");
    viewer.current = v;
    return () => {
      v.destroy();
      viewer.current = null;
      entity.current = null; // nouveau viewer (double montage en mode strict) : caméra à replacer
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !glb) return;
    const url = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
    const at = Cartesian3.fromDegrees(0, 45, 0);
    const first = !entity.current;
    if (entity.current) v.entities.remove(entity.current);
    entity.current = v.entities.add({
      position: at,
      // Avant du modèle vers le nord (cap boussole 0).
      orientation: Transforms.headingPitchRollQuaternion(at, new HeadingPitchRoll(CesiumMath.toRadians(-90), 0, 0)),
      model: { uri: url },
    });
    // Caméra posée d'emblée (zoomTo attendrait le chargement du modèle) : trois quarts avant, à distance de la taille.
    // Comme le dessin du kit : trois quarts avant gauche, vu d'au-dessus, centré sur le matériel.
    if (first) {
      v.camera.lookAt(
        Cartesian3.fromDegrees(0, 45 + centerM / 111_320, sizeM * 0.18),
        new HeadingPitchRange(CesiumMath.toRadians(135), CesiumMath.toRadians(-28), Math.max(6, sizeM * 2.1)),
      );
    }
    return () => URL.revokeObjectURL(url);
  }, [glb, sizeM, centerM]);

  return <div ref={container} style={{ height, borderRadius: 12, overflow: "hidden" }} aria-label="Aperçu 3D" />;
}
