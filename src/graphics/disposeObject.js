// 仅用于独占资源的模型；共享材质的弹药传 disposeMaterials: false。
export function disposeObject(root, { disposeMaterials = true } = {}) {
  root.removeFromParent();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((object) => {
    // Three.js Sprite 的四边形是全局共享的，不归标签独占。
    if (object.geometry && !object.isSprite) geometries.add(object.geometry);
    if (disposeMaterials && object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        if (material.map) textures.add(material.map);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}
