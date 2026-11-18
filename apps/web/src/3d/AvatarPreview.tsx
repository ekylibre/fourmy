import "./cesium-base";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useEffect, useRef, useState } from "react";
import { ErrorPanel } from "../components/RouteError";
import { Cartesian3, Color, HeadingPitchRange, HeadingPitchRoll, Math as CesiumMath, Transforms, Viewer, type Entity } from "cesium";
import { toTrs } from "./tool-nodes-trs";
import { nodeTransforms, type ToolPose } from "./tool-nodes";

/**
 * Aperçu d'un avatar 3D (lot M) : Cesium sans globe, le modèle seul, vu de
 * trois quarts avant. Le GLB est passé en octets (généré dans le navigateur
 * pendant le réglage, ou importé). `pose` : position des nœuds articulés
 * d'un outil généré (mode travail ou route), sinon le modèle tel quel.
 */
/**
 * Caméra posée d'emblée (zoomTo attendrait le chargement du modèle) : comme le
 * dessin du kit, trois quarts avant gauche, vu d'au-dessus, à distance de la taille.
 */
function frame(v: Viewer, sizeM: number, centerM: number) {
  v.camera.lookAt(
    Cartesian3.fromDegrees(0, 45 + centerM / 111_320, sizeM * 0.18),
    new HeadingPitchRange(CesiumMath.toRadians(135), CesiumMath.toRadians(-28), Math.max(6, sizeM * 2.1)),
  );
}

export default function AvatarPreview({
  glb,
  height = 320,
  sizeM = 6,
  centerM = 0,
  pose = null,
  booms = false,
}: {
  glb: Uint8Array | null;
  height?: number;
  sizeM?: number;
  centerM?: number;
  pose?: ToolPose | null;
  booms?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const entity = useRef<Entity | null>(null);
  const [error, setError] = useState<unknown>(null);

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
      showRenderLoopErrors: false,
    });
    v.scene.renderError.addEventListener((_scene, error) => {
      console.error("[aperçu 3D]", error);
      setError(error ?? new Error("Erreur de rendu"));
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
    if (first) frame(v, sizeM, centerM);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glb]);
  // Cadrage recalculé quand la taille change (réglage, ou rampe repliée en mode route).
  useEffect(() => {
    if (viewer.current && entity.current) frame(viewer.current, sizeM, centerM);
  }, [sizeM, centerM]);

  // Mode travail ou route : nœuds articulés posés sans recharger le modèle.
  useEffect(() => {
    const model = entity.current?.model;
    if (!model) return;
    const nodes = pose ? nodeTransforms(pose, booms) : {};
    model.nodeTransformations = Object.fromEntries(Object.entries(nodes).map(([name, n]) => [name, toTrs(n)])) as never;
    viewer.current?.scene.requestRender();
  }, [pose, booms, glb]);

  return (
    <div ref={container} style={{ height, borderRadius: 12, overflow: "hidden", position: "relative" }} aria-label="Aperçu 3D">
      {error ? (
        <div style={{ position: "absolute", inset: 0, zIndex: 2, background: "var(--mantine-color-body)" }}>
          <ErrorPanel error={error} what="l'aperçu 3D" />
        </div>
      ) : null}
    </div>
  );
}
