import { Cartesian3, Quaternion, TranslationRotationScale } from "cesium";
import type { NodeTransform } from "./tool-nodes";

/** Transformation d'un nœud articulé (tool-nodes) en TranslationRotationScale de Cesium. */
export function toTrs(n: NodeTransform): TranslationRotationScale {
  return new TranslationRotationScale(
    new Cartesian3(...n.translation),
    Quaternion.fromAxisAngle(n.axis === "x" ? Cartesian3.UNIT_X : Cartesian3.UNIT_Y, n.angle),
    new Cartesian3(1, 1, 1),
  );
}
