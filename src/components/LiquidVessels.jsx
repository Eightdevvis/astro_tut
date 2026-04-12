import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const LIQUID_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vPos = position;
  vNormal = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LIQUID_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

uniform vec3 uLiquid;
uniform vec3 uDeep;
uniform vec3 uAir;
uniform vec3 uAccent;
uniform vec3 uPlaneN;
uniform vec3 uShake;
uniform vec3 uMeniscusW;
uniform float uPlaneD;
uniform float uTime;
uniform float uGlow;

float hash31(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

vec3 hash33(vec3 p) {
  return fract(sin(vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  )) * 43758.5453);
}

float sparkleField(vec3 p, float t) {
  vec3 q = p * 19.0 + t * vec3(0.09, 0.13, 0.07);
  vec3 i = floor(q);
  vec3 f = fract(q) - 0.5;
  vec3 h = hash33(i);
  vec3 ofs = (h - 0.5) * 0.62;
  float d = length(f - ofs);
  float cell = smoothstep(0.24, 0.035, d);
  float tw = sin(t * (2.2 + h.x * 2.8) + dot(i, vec3(1.0, 2.1, 0.9)) * 6.28318) * 0.5 + 0.5;
  float sec = sin(t * (4.1 + h.y * 5.0) + hash31(i + vec3(4.0, 1.0, 2.0)) * 40.0) * 0.5 + 0.5;
  return cell * (0.35 + 0.65 * tw) * (0.4 + 0.6 * sec);
}

void main() {
  vec3 nSurf = normalize(uPlaneN + uShake * 0.38);
  float plane = dot(vPos, nSurf) + uPlaneD;
  float w = sin(vPos.x * 2.8 + vPos.y * 2.2 + vPos.z * 1.6 + uTime * 0.26) * 0.003
    + sin(vPos.x * 1.3 - vPos.z * 1.6 + uTime * 0.14) * 0.002;
  float p = plane + w;
  float edge = smoothstep(-0.04, 0.04, p);
  float inLiq = 1.0 - edge;

  vec3 liqCol = mix(uDeep, uLiquid, 0.5 + 0.45 * inLiq);
  vec3 base = mix(liqCol, uAir, edge);

  float spark = sparkleField(vWorldPos, uTime) * inLiq;
  vec3 V = normalize(vViewDir);
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(vec3(0.35, 0.75, 0.55));
  vec3 H = normalize(L + V);
  float spec = pow(max(0.0, dot(N, H)), 64.0) * inLiq;
  float glint = pow(max(0.0, dot(reflect(-V, N), L)), 28.0) * inLiq;

  vec3 col = base;
  col += uAccent * spark * (0.45 + glint * 1.8);
  col += uAccent * spec * 0.35;
  col += uLiquid * glint * 0.25;

  float men = exp(-pow(p / 0.05, 2.0)) * uGlow;
  col += men * uLiquid * 1.15;
  vec3 mW = normalize(uMeniscusW);
  float rim = pow(1.0 - abs(dot(N, mW)), 2.5) * 0.22 * inLiq;
  col += rim * uLiquid;

  /* Flüssigkeit wieder durchscheinender (0.28–0.82), sonst wirkt die Kugel flach; Luft: deckend wie Backdrop */
  float alpha = mix(0.28, 0.82, inLiq);
  alpha = mix(alpha, 0.94, men * 0.88);
  alpha = mix(alpha, 0.98, smoothstep(0.72, 1.0, edge));

  gl_FragColor = vec4(col, alpha);
}
`;

/** Vertikaler Hintergrund-Gradient (Viewport), Mid-Ton für uAir. Embed: kein Textur-Hintergrund (transparentes Canvas). */
function createBackdropGradient(embed) {
  const stops = embed
    ? { air: 0x0a0a0c }
    : { top: '#0f1830', mid: '#070b14', bot: '#03050a', air: 0x070b14, clear: 0x03050a };
  if (embed) {
    return {
      texture: null,
      airColor: new THREE.Color(stops.air),
      clearColor: stops.air,
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, stops.top);
  g.addColorStop(0.48, stops.mid);
  g.addColorStop(1, stops.bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return {
    texture,
    airColor: new THREE.Color(stops.air),
    clearColor: stops.clear,
  };
}

/** @param {{ kind?: 'orb' | 'heart' }} opts — Werte bewusst weit auseinander (vorher ~identisch → optisch „keine Änderung“) */
function createPhysicalGlass(opts = {}) {
  const heart = opts.kind === 'heart';
  return new THREE.MeshPhysicalMaterial({
    color: heart ? 0xfff4f7 : 0xe8f0ff,
    emissive: heart ? 0xffc8d4 : 0xa8c4ff,
    emissiveIntensity: heart ? 0.04 : 0.03,
    metalness: 0.004,
    roughness: heart ? 0.045 : 0.018,
    transmission: heart ? 0.74 : 0.88,
    thickness: heart ? 0.11 : 0.1,
    ior: 1.52,
    envMapIntensity: heart ? 1.72 : 2.35,
    specularIntensity: heart ? 1.12 : 1.42,
    clearcoat: 1,
    clearcoatRoughness: heart ? 0.065 : 0.022,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.FrontSide,
    attenuationColor: heart ? new THREE.Color(0xff909e) : new THREE.Color(0x4a72c8),
    attenuationDistance: heart ? 2.6 : 3.4,
  });
}

function createLiquidMaterialMana() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLiquid: { value: new THREE.Color(0x3d7cff) },
      uDeep: { value: new THREE.Color(0x061238) },
      uAir: { value: new THREE.Color(0x070b14) },
      uAccent: { value: new THREE.Color(0x7aebff) },
      uPlaneN: { value: new THREE.Vector3(0, 1, 0) },
      uShake: { value: new THREE.Vector3(0, 0, 0) },
      uMeniscusW: { value: new THREE.Vector3(0, 1, 0) },
      uPlaneD: { value: 0.06 },
      uTime: { value: 0 },
      uGlow: { value: 0.48 },
    },
    vertexShader: LIQUID_VERT,
    fragmentShader: LIQUID_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

function createLiquidMaterialBlood() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLiquid: { value: new THREE.Color(0x6b0a10) },
      uDeep: { value: new THREE.Color(0x1a0305) },
      uAir: { value: new THREE.Color(0x070b14) },
      uAccent: { value: new THREE.Color(0xff3a45) },
      uPlaneN: { value: new THREE.Vector3(0, 1, 0) },
      uShake: { value: new THREE.Vector3(0, 0, 0) },
      uMeniscusW: { value: new THREE.Vector3(0, 1, 0) },
      uPlaneD: { value: 0.32 },
      uTime: { value: 0 },
      uGlow: { value: 0.42 },
    },
    vertexShader: LIQUID_VERT,
    fragmentShader: LIQUID_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

/** Symmetrisches Herz in XY (Y nach oben), Spitze unten — für Extrusion entlang Z = von vorne lesbar. */
function makeHeartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -1.12);
  s.bezierCurveTo(-0.18, -1.02, -1.02, -0.18, -1.02, 0.38);
  s.bezierCurveTo(-1.02, 0.78, -0.58, 0.98, -0.22, 0.78);
  s.bezierCurveTo(-0.08, 0.68, 0, 0.52, 0, 0.34);
  s.bezierCurveTo(0, 0.52, 0.08, 0.68, 0.22, 0.78);
  s.bezierCurveTo(0.58, 0.98, 1.02, 0.78, 1.02, 0.38);
  s.bezierCurveTo(1.02, -0.18, 0.18, -1.02, 0, -1.12);
  return s;
}

/** @param {THREE.Object3D} root */
function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose?.();
    }
  });
}

/**
 * @param {{ variant?: 'page' | 'rpg-tree' }} props
 */
export default function LiquidVessels({ variant = 'page' }) {
  const wrapRef = useRef(null);
  const embed = variant === 'rpg-tree';

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

    const scene = new THREE.Scene();
    const { texture: bgTexture, airColor: backdrop, clearColor: clearHex } = createBackdropGradient(embed);
    scene.background = bgTexture ?? null;

    const camera = new THREE.PerspectiveCamera(embed ? 38 : 42, 1, 0.1, 50);
    camera.position.set(0, embed ? -0.02 : 0.15, embed ? 5.85 : 4.2);

    const maxDpr = Math.min(window.devicePixelRatio || 1, embed ? 1.5 : 1.75);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: embed,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(maxDpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    if (embed) {
      renderer.setClearColor(0x000000, 0);
    } else {
      renderer.setClearColor(new THREE.Color(clearHex), 1);
    }
    el.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    /* Studio-Env: etwas höheres σ weicht harte Kanten auf (weniger „Kasten“ in Reflexionen) */
    const roomEnv = new RoomEnvironment();
    const envMap = pmrem.fromScene(roomEnv, 0.08).texture;
    pmrem.dispose();
    scene.environment = envMap;
    scene.environmentIntensity = 1.22;

    const lightDir = new THREE.Vector3(0.45, 0.72, 0.52).normalize();

    const amb = new THREE.AmbientLight(0x8a9bff, 0.28);
    scene.add(amb);
    const hemi = new THREE.HemisphereLight(0xb8ccff, 0x1c1418, 0.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.12);
    key.position.copy(lightDir).multiplyScalar(8);
    scene.add(key);
    const coolFill = new THREE.DirectionalLight(0xa8c4ff, 0.38);
    coolFill.position.set(-7, 4, 6);
    scene.add(coolFill);
    const warmRim = new THREE.DirectionalLight(0xffe8dc, 0.28);
    warmRim.position.set(5, -1.5, 4);
    scene.add(warmRim);
    const fill = new THREE.PointLight(0x66a0ff, 0.92, 16, 2);
    fill.position.set(-2.2, 1.4, 2.8);
    scene.add(fill);
    const spot = new THREE.SpotLight(0xe4eeff, 0.48, 28, Math.PI / 5, 0.55, 1);
    spot.position.set(-3.8, 5.5, 6.2);
    spot.target.position.set(0, 0.15, 0);
    scene.add(spot);
    scene.add(spot.target);
    const lifeLight = new THREE.PointLight(0xc4283a, 0.38, 12, 2);
    lifeLight.position.set(2.0, 0.4, 2.4);
    scene.add(lifeLight);
    /* Kurz reichendes Licht Richtung Herz — Kugel links kaum betroffen, kein globales Aufhellen wie Directional */
    const heartNear = new THREE.PointLight(0xffe8ee, 0.72, 3.6, 2);
    heartNear.position.set(embed ? 0.2 : 1.45, embed ? -0.75 : 0.05, 3.15);
    scene.add(heartNear);

    const glassOrb = createPhysicalGlass({ kind: 'orb' });
    const liqOrb = createLiquidMaterialMana();
    const orbGroup = new THREE.Group();
    const orbLiquidMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), liqOrb);
    orbLiquidMesh.renderOrder = 0;
    const orbGlassMesh = new THREE.Mesh(new THREE.SphereGeometry(1.02, 64, 48), glassOrb);
    orbGlassMesh.renderOrder = 1;
    orbGroup.add(orbLiquidMesh);
    orbGroup.add(orbGlassMesh);
    if (embed) {
      orbGroup.position.set(0, 0.92, 0);
      orbGroup.scale.setScalar(0.68);
    } else {
      orbGroup.position.set(-1.35, 0, 0);
    }
    scene.add(orbGroup);

    const heartExtrude = new THREE.ExtrudeGeometry(makeHeartShape(), {
      depth: 0.2,
      bevelEnabled: true,
      bevelThickness: 0.032,
      bevelSize: 0.028,
      bevelSegments: 6,
      curveSegments: 96,
    });
    heartExtrude.center();

    const glassHeart = createPhysicalGlass({ kind: 'heart' });
    const liqHeart = createLiquidMaterialBlood();

    const heartGroup = new THREE.Group();
    const heartLiqMesh = new THREE.Mesh(heartExtrude.clone(), liqHeart);
    heartLiqMesh.renderOrder = 0;
    const heartShell = heartExtrude.clone();
    heartShell.scale(1.035, 1.035, 1.06);
    const heartGlassMesh = new THREE.Mesh(heartShell, glassHeart);
    heartGlassMesh.renderOrder = 1;
    heartGroup.add(heartLiqMesh);
    heartGroup.add(heartGlassMesh);
    if (embed) {
      heartGroup.position.set(0, -0.88, 0);
      heartGroup.scale.setScalar(0.72);
    } else {
      heartGroup.position.set(1.35, -0.02, 0);
      heartGroup.scale.setScalar(0.78);
    }
    scene.add(heartGroup);

    liqOrb.uniforms.uAir.value.copy(backdrop);
    liqHeart.uniforms.uAir.value.copy(backdrop);

    const planeN = new THREE.Vector3(0, 1, 0);
    const targetTilt = new THREE.Vector2(0, 0);
    const smoothTilt = new THREE.Vector2(0, 0);
    const shakeVel = new THREE.Vector3(0, 0, 0);

    /** @type {((e: DeviceOrientationEvent) => void) | null} */
    let oriHandler = null;
    /** @type {((e: DeviceMotionEvent) => void) | null} */
    let motionHandler = null;

    const attachOrientation = () => {
      if (reduceMotion) return;
      oriHandler = (ev) => {
        if (ev.gamma == null || ev.beta == null) return;
        const gx = THREE.MathUtils.degToRad(ev.gamma);
        const gy = THREE.MathUtils.degToRad(ev.beta - 42);
        targetTilt.set(
          Math.max(-1, Math.min(1, gx * 0.055)),
          Math.max(-1, Math.min(1, -gy * 0.042))
        );
      };
      window.addEventListener('deviceorientation', oriHandler, true);
    };

    const attachMotion = () => {
      if (reduceMotion) return;
      motionHandler = (ev) => {
        const a = ev.acceleration && (ev.acceleration.x != null || ev.acceleration.y != null)
          ? ev.acceleration
          : ev.accelerationIncludingGravity;
        if (a && (a.x != null || a.y != null)) {
          const ax = a.x ?? 0;
          const ay = a.y ?? 0;
          const az = a.z ?? 0;
          const mag = Math.sqrt(ax * ax + ay * ay + az * az);
          if (mag > 0.28) {
            const s = Math.min(1.6, mag * 0.055);
            shakeVel.x += ax * s * 0.0045;
            shakeVel.y += ay * s * 0.0045;
            shakeVel.z += az * s * 0.0045;
          }
        }
        const r = ev.rotationRate;
        if (r && (r.alpha != null || r.beta != null || r.gamma != null)) {
          const spin = Math.abs(r.alpha ?? 0) + Math.abs(r.beta ?? 0) + Math.abs(r.gamma ?? 0);
          if (spin > 4.5) {
            const k = Math.min(0.12, spin * 0.0012);
            shakeVel.x += (r.gamma ?? 0) * k * 0.02;
            shakeVel.y += (r.beta ?? 0) * k * 0.02;
            shakeVel.z += (r.alpha ?? 0) * k * 0.015;
          }
        }
      };
      window.addEventListener('devicemotion', motionHandler, true);
    };

    const tryAutoSensors = () => {
      if (reduceMotion) return;
      const needOri = typeof DeviceOrientationEvent !== 'undefined';
      const needMot = typeof DeviceMotionEvent !== 'undefined';
      const iosOri = needOri && typeof DeviceOrientationEvent.requestPermission === 'function';
      const iosMot = needMot && typeof DeviceMotionEvent.requestPermission === 'function';
      if (!iosOri && !iosMot) {
        attachOrientation();
        attachMotion();
      }
    };

    tryAutoSensors();

    const needsIOSPerm = (() => {
      const o = typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission;
      const m = typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission;
      return !!(o || m);
    })();

    /* Embed (Quest-Baum): kein Schalter-Overlay — nur die Gefäße sichtbar */
    if (!reduceMotion && needsIOSPerm && !embed) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = embed ? 'Neigung' : 'Neigung & Schütteln';
      btn.className = embed ? 'lv-motion lv-motion--embed' : 'lv-gyro';
      btn.title = 'Gerät kippen und schütteln (iOS: einmal erlauben)';
      el.appendChild(btn);
      btn.addEventListener('click', async () => {
        try {
          if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
            await DeviceOrientationEvent.requestPermission();
          }
        } catch {
          /* ignore */
        }
        try {
          if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
            await DeviceMotionEvent.requestPermission();
          }
        } catch {
          /* ignore */
        }
        attachOrientation();
        attachMotion();
        btn.remove();
      });
    }

    const clock = new THREE.Clock();
    let raf = 0;

    const setSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 2 || h < 2) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(el);

    const invMat = new THREE.Matrix4();
    const tmpPlaneObj = new THREE.Vector3();
    const tmpShakeObj = new THREE.Vector3();
    const tmpN = new THREE.Vector3();

    const worldDirToLocal = (mesh, worldDir, target) => {
      invMat.copy(mesh.matrixWorld).invert();
      return target.copy(worldDir).transformDirection(invMat);
    };

    const tick = () => {
      const dt = reduceMotion ? 0 : Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      smoothTilt.lerp(targetTilt, 1 - Math.pow(0.00055, dt * 60));
      planeN.set(smoothTilt.x, 1, smoothTilt.y).normalize();

      if (!reduceMotion) {
        shakeVel.multiplyScalar(Math.pow(0.86, dt * 60));
        const maxShake = 1.45;
        if (shakeVel.length() > maxShake) shakeVel.multiplyScalar(maxShake / shakeVel.length());
      } else {
        shakeVel.set(0, 0, 0);
      }

      orbLiquidMesh.updateMatrixWorld(true);
      heartLiqMesh.updateMatrixWorld(true);

      tmpN.copy(planeN).normalize();
      const meniscusW = tmpN.clone().addScaledVector(shakeVel, 0.38).normalize();

      worldDirToLocal(orbLiquidMesh, tmpN, tmpPlaneObj).normalize();
      worldDirToLocal(orbLiquidMesh, shakeVel, tmpShakeObj);
      liqOrb.uniforms.uPlaneN.value.copy(tmpPlaneObj);
      liqOrb.uniforms.uShake.value.copy(tmpShakeObj);
      liqOrb.uniforms.uMeniscusW.value.copy(meniscusW);
      liqOrb.uniforms.uTime.value = t;

      worldDirToLocal(heartLiqMesh, tmpN, tmpPlaneObj).normalize();
      worldDirToLocal(heartLiqMesh, shakeVel, tmpShakeObj);
      liqHeart.uniforms.uPlaneN.value.copy(tmpPlaneObj);
      liqHeart.uniforms.uShake.value.copy(tmpShakeObj);
      liqHeart.uniforms.uMeniscusW.value.copy(meniscusW);
      liqHeart.uniforms.uTime.value = t;

      orbGroup.rotation.y = reduceMotion ? 0 : t * 0.028;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (oriHandler) window.removeEventListener('deviceorientation', oriHandler, true);
      if (motionHandler) window.removeEventListener('devicemotion', motionHandler, true);
      disposeObject(orbGroup);
      disposeObject(heartGroup);
      heartExtrude.dispose();
      scene.environment = null;
      envMap.dispose();
      bgTexture?.dispose();
      roomEnv.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) m.dispose?.();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      for (const q of el.querySelectorAll('.lv-gyro, .lv-motion')) q.remove();
    };
  }, [variant]);

  if (embed) {
    return <div class="lv-canvas-wrap lv-canvas-wrap--embed" ref={wrapRef} />;
  }

  return (
    <div class="lv-root">
      <p class="lv-hint">Mobil: Neigung &amp; Schütteln (iOS: Button). Keine Maus-Steuerung.</p>
      <div class="lv-canvas-wrap" ref={wrapRef} />
      <p class="lv-note">Deko-Shader mit Glas-Glanz und Partikel-Glanz — keine echte Flüssigkeitssimulation.</p>
    </div>
  );
}
