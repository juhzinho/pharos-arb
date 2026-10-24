import * as THREE from "three";

const canvas = document.querySelector("#stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x071410, 8, 18);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
camera.position.set(0, 0.2, 7.2);

scene.add(new THREE.AmbientLight(0xc8fff0, 0.45));
const key = new THREE.DirectionalLight(0xf0b429, 6);
key.position.set(3, 4, 2);
scene.add(key);
const fill = new THREE.DirectionalLight(0x3ee0c5, 4);
fill.position.set(-4, -1, 2);
scene.add(fill);

function orb(color, scale) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 48, 32),
    new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 }),
  );
  mesh.scale.setScalar(scale);
  return mesh;
}

const amber = orb(0xf0b429, 1);
const mint = orb(0x3ee0c5, 0.72);
const group = new THREE.Group();
group.add(amber, mint);
scene.add(group);
scene.add(new THREE.Mesh(
  new THREE.TorusGeometry(2.15, 0.015, 12, 80),
  new THREE.MeshBasicMaterial({ color: 0xf0b429, transparent: true, opacity: 0.45 }),
));

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
renderer.setAnimationLoop((time) => {
  const t = reduced ? 0 : time / 1000;
  amber.position.set(Math.cos(t * 0.45) * 1.7, Math.sin(t * 0.7) * 0.28, Math.sin(t * 0.45) * 0.4);
  mint.position.set(Math.cos(t * 0.45 + Math.PI) * 1.7, Math.cos(t * 0.6) * 0.22, Math.cos(t * 0.45) * 0.4);
  group.rotation.y = t * 0.08;
  renderer.render(scene, camera);
});
