/**
 * Marks the solid, lit meshes under an object as shadow casters and receivers. Glows, plumes, shields and
 * other unlit or see-through materials are skipped: they'd cast solid shadows otherwise.
 */
export function useShadows(object, { cast = true, receive = true } = {}) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const lit = m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
    if (!lit || m.transparent) return;
    o.castShadow = cast;
    o.receiveShadow = receive;
  });
}
