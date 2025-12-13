import { useState, useMemo, useRef, useEffect, Suspense, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- 动态生成照片列表 (top.jpg + 1.jpg 到 31.jpg) ---
const TOTAL_NUMBERED_PHOTOS = 31;
// 修改：将 top.jpg 加入到数组开头
const bodyPhotoPaths = [
  '/photos/top.jpg',
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg`)
];

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    emerald: '#004225', // 纯正祖母绿
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',   // 纯白色
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'], // 彩灯
    // 拍立得边框颜色池 (复古柔和色系)
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    // 圣诞元素颜色
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    candyColors: ['#FF0000', '#FFFFFF']
  },
  counts: {
    foliage: 15000,
    ornaments: 300,   // 拍立得照片数量
    elements: 200,    // 圣诞元素数量
    lights: 400       // 彩灯数量
  },
  tree: { height: 22, radius: 9 }, // 树体尺寸
  photos: {
    // top 属性不再需要，因为已经移入 body
    body: bodyPhotoPaths
  }
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Photo Ornaments (Double-Sided Polaroid) ---
const PhotoOrnaments = forwardRef<THREE.Group, { state: 'CHAOS' | 'FORMED', activeIndex: number | null, scaleMultiplier: number, centerActive: boolean, centerTarget: THREE.Vector3 | null, centerLookAt: THREE.Vector3 | null, photoUrls: string[] }>((props, ref) => {
  const { state, activeIndex, scaleMultiplier, centerActive, centerTarget, centerLookAt, photoUrls } = props;
  const textures = useTexture(photoUrls);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  const centerBlendsRef = useRef<number[]>(new Array(count).fill(0));
  useImperativeHandle(ref, () => groupRef.current as THREE.Group, []);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0
      };
      const chaosRotation = new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const normalTarget = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(normalTarget, delta * (isFormed ? 0.8 * objData.weight : 0.5));

      const desiredAlpha = centerActive && activeIndex === i ? 1 : 0;
      const alpha = centerBlendsRef.current[i] = MathUtils.damp(centerBlendsRef.current[i], desiredAlpha, 2.5, delta);

      const basePos = objData.currentPos.clone();
      const finalPos = centerTarget ? basePos.lerp(centerTarget, alpha) : basePos;
      (group as THREE.Group).position.copy(finalPos);

      const base = objData.scale;
      const clampedMul = Math.max(1, Math.min(scaleMultiplier, 6));
      const effMul = 1 + (clampedMul - 1) * alpha;
      const desiredScale = base * effMul;
      (group as THREE.Group).scale.set(
        MathUtils.damp((group as THREE.Group).scale.x, desiredScale, 2, delta),
        MathUtils.damp((group as THREE.Group).scale.y, desiredScale, 2, delta),
        MathUtils.damp((group as THREE.Group).scale.z, desiredScale, 2, delta)
      );

      if (alpha < 0.5 && isFormed) {
         const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
         group.lookAt(targetLookPos);

         const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
         const wobbleZ = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.05;
         group.rotation.x += wobbleX;
         group.rotation.z += wobbleZ;

      } else if (alpha < 0.5) {
         group.rotation.x += delta * objData.rotationSpeed.x;
         group.rotation.y += delta * objData.rotationSpeed.y;
         group.rotation.z += delta * objData.rotationSpeed.z;
      }
      if (alpha >= 0.5 && centerLookAt) (group as THREE.Group).lookAt(centerLookAt);
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.scale, obj.scale, obj.scale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}>
          {/* 正面 */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
          {/* 背面 */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
});

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random()-0.5)*2.0, y: (Math.random()-0.5)*2.0, z: (Math.random()-0.5)*2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return ( <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh> )})}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius*Math.cos(angle), radius*Math.sin(angle)) : shape.lineTo(radius*Math.cos(angle), radius*Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4, // 增加一点厚度
      bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
    });
  }, [starShape]);

  // 纯金材质
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.gold,
    emissive: CONFIG.colors.gold,
    emissiveIntensity: 1.5, // 适中亮度，既发光又有质感
    roughness: 0.1,
    metalness: 1.0,
  }), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed, pinchNdc, pinchScale, randomActiveIndex, photoUrls }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, pinchNdc: { x: number, y: number } | null, pinchScale: number, randomActiveIndex: number | null, photoUrls: string[] }) => {
  const controlsRef = useRef<any>(null);
  const ornamentsRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [centerTarget, setCenterTarget] = useState<THREE.Vector3 | null>(null);
  const [centerLookAt, setCenterLookAt] = useState<THREE.Vector3 | null>(null);
  const { camera } = useThree();
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (rotationSpeed !== 0) {
      controls.setAzimuthalAngle(controls.getAzimuthalAngle() + rotationSpeed);
    }
    controls.update();
  });

  useEffect(() => {
    if (randomActiveIndex !== null) { setActiveIndex(randomActiveIndex); return; }
    if (!ornamentsRef.current) return;
    if (!pinchNdc) { setActiveIndex(null); return; }
    raycasterRef.current.setFromCamera(new THREE.Vector2(pinchNdc.x, pinchNdc.y), camera);
    const intersects = raycasterRef.current.intersectObjects(ornamentsRef.current.children, true);
      if (intersects.length > 0) {
        let obj: THREE.Object3D = intersects[0].object;
        while (obj.parent && obj.parent !== ornamentsRef.current) obj = obj.parent as THREE.Object3D;
        const idx = ornamentsRef.current.children.indexOf(obj as THREE.Object3D);
        setActiveIndex(idx >= 0 ? idx : null);
      } else {
      let bestIdx: number | null = null; let bestDist = Infinity;
      ornamentsRef.current.children.forEach((child, i) => {
        const box = new THREE.Box3().setFromObject(child);
        const center = new THREE.Vector3(); box.getCenter(center);
        const ndc = center.clone().project(camera);
        const dx = ndc.x - pinchNdc.x; const dy = ndc.y - pinchNdc.y;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      });
      setActiveIndex(bestIdx);
      }
  }, [pinchNdc, camera, randomActiveIndex]);

  useEffect(() => {
    if (!ornamentsRef.current) return;
    if (randomActiveIndex !== null) {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const worldTarget = camera.position.clone().add(dir.multiplyScalar(25));
      const localTarget = ornamentsRef.current.worldToLocal(worldTarget.clone());
      setCenterTarget(localTarget);
      setCenterLookAt(camera.position.clone());
    }
  }, [randomActiveIndex, camera]);

  useEffect(() => {
    if (!ornamentsRef.current) return;
    if (pinchNdc) {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const worldTarget = camera.position.clone().add(dir.multiplyScalar(25));
      const localTarget = ornamentsRef.current.worldToLocal(worldTarget.clone());
      setCenterTarget(localTarget);
      setCenterLookAt(camera.position.clone());
    }
  }, [pinchNdc, camera]);

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={sceneState === 'CHAOS'} autoRotateSpeed={0.2} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
          <PhotoOrnaments ref={ornamentsRef} state={sceneState} activeIndex={activeIndex} scaleMultiplier={pinchScale} centerActive={pinchNdc !== null && pinchScale > 1} centerTarget={centerTarget} centerLookAt={centerLookAt} photoUrls={photoUrls} />
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = ({ onGesture, onMove, onStatus, debugMode, onPinchChange }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinchActiveRef = useRef(false);
  const lastScaleRef = useRef(1);
  const lastNdcRef = useRef<{ x: number, y: number } | null>(null);
  const lastEmittedStateRef = useRef<'CHAOS' | 'FORMED'>('CHAOS');
  const targetStateRef = useRef<'CHAOS' | 'FORMED' | null>(null);
  const stableFramesRef = useRef(0);
  const lastPinchEndRef = useRef(0); // Cooldown timer

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;

    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        // 使用本地路径（需要先下载资源到 public/mediapipe/ 目录）
        // 如果本地资源不存在，可以回退到 CDN（需要代理）
        const wasmPath = "/mediapipe/wasm";
        const modelPath = "/mediapipe/gesture_recognizer.task";
        
        // 尝试使用本地资源，失败则使用 CDN
        let vision;
        try {
          vision = await FilesetResolver.forVisionTasks(wasmPath);
        } catch (e) {
          console.warn("本地 WASM 加载失败，尝试使用 CDN（需要代理）:", e);
          vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        }
        
        // 尝试使用本地模型，失败则使用 CDN
        let gestureRecognizerInstance;
        try {
          gestureRecognizerInstance = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: modelPath,
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
          });
        } catch (e) {
          console.warn("本地模型加载失败，尝试使用 CDN（需要代理）:", e);
          gestureRecognizerInstance = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
          });
        }
        gestureRecognizer = gestureRecognizerInstance;
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
            onStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !debugMode) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            let isClosedFist = false;
            if (results.gestures.length > 0) {
              const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
              if (score > 0.4) {
                 const candidate = name === "Closed_Fist" ? 'FORMED' : name === "Open_Palm" ? 'CHAOS' : null;
                 if (candidate) {
                   if (targetStateRef.current !== candidate) {
                     targetStateRef.current = candidate; stableFramesRef.current = 0;
                   } else {
                     stableFramesRef.current++;
                     if (stableFramesRef.current >= 6 && lastEmittedStateRef.current !== candidate) {
                       lastEmittedStateRef.current = candidate; onGesture(candidate);
                     }
                   }
                 }
                 if (debugMode) onStatus(`DETECTED: ${name}`);
                 if (name === "Closed_Fist") isClosedFist = true;
              } else {
                 targetStateRef.current = null; stableFramesRef.current = 0;
              }
            }

            if (results.landmarks.length > 0) {
              const lm = results.landmarks[0];
              const speed = (0.5 - lm[0].x) * 0.15;
              onMove(Math.abs(speed) > 0.01 ? speed : 0);

              const thumb = lm[4]; const index = lm[8];
              const dx = thumb.x - index.x; const dy = thumb.y - index.y; const d = Math.hypot(dx, dy);
              const indexExt = Math.hypot(index.x - lm[5].x, index.y - lm[5].y);
              const antiFist = indexExt > 0.08 && !isClosedFist;
              // Lower pinch sensitivity (require tighter pinch) & Increase release sensitivity
              const openT = 0.12; const closedT = 0.02; 
              const pinchLevel = Math.min(1, Math.max(0, (openT - d) / (openT - closedT)));
              const startLevel = 0.85; const endLevel = 0.80;
              
              if (!pinchActiveRef.current && pinchLevel >= startLevel && antiFist) {
                if (Date.now() - lastPinchEndRef.current > 1500) { // 1.5s cooldown for slow shrink
                    pinchActiveRef.current = true;
                    const mirroredX0 = 1 - index.x; const ndcX0 = mirroredX0 * 2 - 1; const ndcY0 = -(index.y * 2 - 1);
                    if (onPinchChange) onPinchChange({ x: ndcX0, y: ndcY0 }, 2.5);
                }
              }
              if (pinchActiveRef.current && ((pinchLevel <= endLevel) || !antiFist)) {
                  pinchActiveRef.current = false;
                  lastPinchEndRef.current = Date.now();
              }

              if (pinchActiveRef.current) {
                const mirroredX = 1 - index.x; const ndcX = mirroredX * 2 - 1; const ndcY = -(index.y * 2 - 1);
                const rawScale = Math.max(1, Math.min(6, 1 + pinchLevel * 5));
                const smoothScale = lastScaleRef.current + (rawScale - lastScaleRef.current) * 0.25;
                lastScaleRef.current = smoothScale;
                const targetNdc = { x: ndcX, y: ndcY };
                const prev = lastNdcRef.current;
                const smoothNdc = prev ? { x: prev.x + (targetNdc.x - prev.x) * 0.3, y: prev.y + (targetNdc.y - prev.y) * 0.3 } : targetNdc;
                lastNdcRef.current = smoothNdc;
                if (onPinchChange) onPinchChange(smoothNdc, smoothScale);
                if (debugMode) onStatus(`PINCH lvl=${pinchLevel.toFixed(2)} scale=${smoothScale.toFixed(2)}`);
              } else {
                lastNdcRef.current = null; lastScaleRef.current = 1;
                if (onPinchChange) onPinchChange(null, 1);
              }
            } else {
              onMove(0);
              if (onPinchChange) onPinchChange(null, 1);
              if (debugMode) onStatus("AI READY: NO HAND");
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const [pinchNdc, setPinchNdc] = useState<{ x: number, y: number } | null>(null);
  const [pinchScale, setPinchScale] = useState(1);
  const pinchBaseRef = useRef<number | null>(null);
  const [randomActiveIndex, setRandomActiveIndex] = useState<number | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>(CONFIG.photos.body);
  const nextReplaceIndex = useRef(1); // Start replacing from 1 (keep top.jpg at 0)
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        setPhotoUrls(prev => {
            const newUrls = [...prev];
            files.forEach(file => {
                const url = URL.createObjectURL(file);
                // Replace image at current index
                newUrls[nextReplaceIndex.current] = url;
                // Move to next index, wrap around if needed (skip 0 which is top.jpg)
                nextReplaceIndex.current++;
                if (nextReplaceIndex.current >= newUrls.length) {
                    nextReplaceIndex.current = 1;
                }
            });
            return newUrls;
        });
        // Reset file input so same file can be selected again
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div
      style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}
      onTouchStart={(e) => {
        if (e.touches.length === 2) {
          const [t1, t2] = [e.touches[0], e.touches[1]];
          const dx = t1.clientX - t2.clientX; const dy = t1.clientY - t2.clientY;
          pinchBaseRef.current = Math.hypot(dx, dy);
          const cx = (t1.clientX + t2.clientX) / 2; const cy = (t1.clientY + t2.clientY) / 2;
          const w = window.innerWidth; const h = window.innerHeight;
          setPinchNdc({ x: (cx / w) * 2 - 1, y: -(cy / h) * 2 + 1 });
          setPinchScale(2.5);
          setRandomActiveIndex(Math.floor(Math.random() * CONFIG.counts.ornaments));
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2 && pinchBaseRef.current) {
          const [t1, t2] = [e.touches[0], e.touches[1]];
          const dx = t1.clientX - t2.clientX; const dy = t1.clientY - t2.clientY;
          const cur = Math.hypot(dx, dy);
          const raw = cur / pinchBaseRef.current;
          const scale = Math.max(1, Math.min(raw, 4));
          const cx = (t1.clientX + t2.clientX) / 2; const cy = (t1.clientY + t2.clientY) / 2;
          const w = window.innerWidth; const h = window.innerHeight;
          setPinchNdc({ x: (cx / w) * 2 - 1, y: -(cy / h) * 2 + 1 });
          setPinchScale(scale);
        }
      }}
      onTouchEnd={(e) => {
        if (e.touches.length < 2) {
          pinchBaseRef.current = null;
          setPinchNdc(null);
          setPinchScale(1);
          setRandomActiveIndex(null);
        }
      }}
    >
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
            <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} pinchNdc={pinchNdc} pinchScale={pinchScale} randomActiveIndex={randomActiveIndex} photoUrls={photoUrls} />
        </Canvas>
      </div>
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} onPinchChange={(ndc: {x:number,y:number}|null, scale: number) => { if (ndc) { setPinchNdc(ndc); setPinchScale(scale); } else { setPinchNdc(null); setPinchScale(1); } }} />

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Foliage</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>EMERALD NEEDLES</span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <input type="file" multiple accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
        <button onClick={() => fileInputRef.current?.click()} style={{ padding: '12px 15px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           📸 UPLOAD
        </button>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
    </div>
  );
}
 
