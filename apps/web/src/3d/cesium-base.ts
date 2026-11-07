// À importer AVANT « cesium » : Cesium charge ses workers et textures depuis
// cette URL (fichiers copiés par scripts/copy-cesium.mjs).
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium/";
export {};
