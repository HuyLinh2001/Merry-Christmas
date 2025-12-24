import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const CONFIG = {
    colors: {
        bg: 0x000000,
        gold: 0xf5d5a0,
        deepGreen: 0x0a2a12,
        wineRed: 0x720026,
        warmWhite: 0xfff8e1
    },
    particles: {
        count: 1000,        // giảm từ 1600 → 1000
        snowCount: 2000,    // giảm từ 3000 → 2000
        treeHeight: 26,
        treeRadius: 9
    },
    lights: {
        fairyCount: 120,    // giảm từ 180 → 120
        fairyIntensity: 1.8 // dùng emissive thay PointLight
    }
};

const STATE = {
    mode: 'TREE',
    focusTarget: null,
    hand: { detected: false },
    currentGesture: null,
    rotation: { y: 0 }
};

let scene, camera, renderer, composer, mainGroup, photoGroup, clock = new THREE.Clock();
let particleSystem = [], fairyLights = [];
let snowParticles;
let handLandmarker = null, video = null;

const photoFiles = [
    'IMG_0183.jpg', 'IMG_0193.jpg', 'IMG_0397 (1).jpg', 'IMG_0397.jpg',
    'IMG_0412.jpg', 'IMG_4933.jpg', 'IMG_5387.jpg', 'IMG_5386.jpg',
    'IMG_5390.jpg', 'IMG_5484.jpg', 'IMG_9882.jpg',
    'IMG_2024122519880493.jpg', 'IMG_2025021716457735.jpg',
    'IMG_2025060100060564.jpg', 'IMG_2025072212171412.jpg',
    'IMG_2025072518188806.jpg', 'IMG_20250828234015823.jpg',
    'IMG_20250828234016059.jpg', 'IMG_2025083022252838.jpg',
    'IMG_2025083022293412.jpg', 'IMG_2025120408860616.jpg',
    'Reisen_IMG_0250201083632.jpg'
];

async function init() {
    setupScene();
    setupLights();
    createFairyLights();     // giờ chỉ dùng emissive, không PointLight
    createOrnaments();
    createPointSnow();
    createStripeTexture();
    setupPostProcessing();
    setupEvents();
    await initMediaPipeHandTracking();

    loadAllPhotos();

    const loader = document.getElementById('loader');
    loader.style.opacity = 0;
    setTimeout(() => loader.remove(), 1200);

    animate();
}

function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.012);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
    camera.position.set(0, 4, 55);

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    renderer = new THREE.WebGLRenderer({
        antialias: !isMobile,           // tắt antialias trên mobile
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // max 1.5
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.05).texture;

    mainGroup = new THREE.Group();
    photoGroup = new THREE.Group();
    mainGroup.add(photoGroup);
    scene.add(mainGroup);
}

function setupLights() {
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const warmCenter = new THREE.PointLight(0xffaa66, 2, 30);
    warmCenter.position.set(0, 8, 0);
    mainGroup.add(warmCenter);

    const topLight = new THREE.SpotLight(0xfff8e1, 600);
    topLight.position.set(0, 40, 20);
    topLight.angle = 0.6;
    topLight.penumbra = 0.7;
    scene.add(topLight);
}

function createFairyLights() {
    const lightGeo = new THREE.SphereGeometry(0.15, 16, 16);
    for (let i = 0; i < CONFIG.lights.fairyCount; i++) {
        const t = Math.random();
        const y = (t * CONFIG.particles.treeHeight) - CONFIG.particles.treeHeight / 2;
        const r = CONFIG.particles.treeRadius * (1 - t) * (0.7 + Math.random() * 0.4);
        const angle = t * 40 * Math.PI;

        const color = Math.random() > 0.5 ? 0xff4444 : 0xffff88;

        const material = new THREE.MeshBasicMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: CONFIG.lights.fairyIntensity
        });

        const lightMesh = new THREE.Mesh(lightGeo, material);
        lightMesh.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
        lightMesh.userData = { phase: Math.random() * Math.PI * 2 };

        mainGroup.add(lightMesh);
        fairyLights.push(lightMesh);
    }
}

function createStripeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#c41e3a';
    for (let i = -256; i < 512; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 64, 256);
        ctx.lineTo(i + 48, 256);
        ctx.lineTo(i - 16, 0);
        ctx.closePath();
        ctx.fill();
    }
    return new THREE.CanvasTexture(canvas);
}

function createOrnaments() {
    const stripeTex = createStripeTexture();

    const goldMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1, roughness: 0.05, envMapIntensity: 1.5 });
    const greenMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.deepGreen, metalness: 0.3, roughness: 0.4, envMapIntensity: 1 });
    const redMat = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.wineRed, clearcoat: 1, clearcoatRoughness: 0, metalness: 0.6, roughness: 0.1, envMapIntensity: 1.5 });
    const candyMat = new THREE.MeshStandardMaterial({ map: stripeTex, metalness: 0.2, roughness: 0.3 });

    const geometries = [
        new THREE.BoxGeometry(0.7, 0.7, 0.7),
        new THREE.SphereGeometry(0.4, 32, 24),
        new THREE.OctahedronGeometry(0.5)
    ];

    const candyGeo = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0,-0.5,0), new THREE.Vector3(0,0.4,0), new THREE.Vector3(0.15,0.6,0)]),
        20, 0.1, 8, false
    );

    for (let i = 0; i < CONFIG.particles.count; i++) {
        const rand = Math.random();
        let geo, mat;
        if (rand < 0.35) { geo = geometries[0]; mat = greenMat; }
        else if (rand < 0.65) { geo = geometries[0]; mat = goldMat; }
        else if (rand < 0.85) { geo = geometries[1]; mat = goldMat; }
        else if (rand < 0.95) { geo = geometries[1]; mat = redMat; }
        else { geo = candyGeo; mat = candyMat; }

        const mesh = new THREE.Mesh(geo, mat);
        const s = 0.5 + Math.random() * 0.6;
        mesh.scale.setScalar(s);
        mainGroup.add(mesh);
        particleSystem.push(new Particle(mesh, 'ORNAMENT'));
    }

    const star = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.6, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffdd88, emissiveIntensity: 3, metalness: 1, roughness: 0 })
    );
    star.position.y = CONFIG.particles.treeHeight / 2 + 1.8;
    mainGroup.add(star);
}

function createPointSnow() {
    const count = CONFIG.particles.snowCount;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * 120;
        positions[i * 3 + 1] = Math.random() * 40 + 10;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 80 - 10;

        // GIẢM TỐC ĐỘ RƠI XUỐNG RẤT CHẬM (trước là 2-5, giờ chỉ 0.4-1.2)
        velocities[i] = 0.4 + Math.random() * 0.8;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.5,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending  // thêm để tuyết sáng nhẹ, lung linh hơn
    });

    snowParticles = new THREE.Points(geometry, material);
    snowParticles.userData = { velocities };
    scene.add(snowParticles);
}

let snowUpdateCounter = 0;
function updatePointSnow(dt) {
    if (!snowParticles) return;
    
    snowUpdateCounter++;
    if (snowUpdateCounter % 2 !== 0) return; // vẫn update mỗi 2 frame để mượt + tiết kiệm CPU

    const positions = snowParticles.geometry.attributes.position.array;
    const velocities = snowParticles.userData.velocities;

    for (let i = 0; i < positions.length / 3; i++) {
        // TỐC ĐỘ RƠI CHẬM HƠN, MƯỢT HƠN
        // Trước: dt * 60 (rất nhanh khi skip frame)
        // Giờ: chỉ dt * 15 → tuyết rơi nhẹ nhàng, lững lờ
        positions[i * 3 + 1] -= velocities[i] * dt * 15;

        // Khi tuyết rơi xuống dưới, reset lên trên với vị trí mới
        if (positions[i * 3 + 1] < -10) {
            positions[i * 3 + 1] = 40 + Math.random() * 10;
            positions[i * 3]     = (Math.random() - 0.5) * 120;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 80 - 10;
        }
    }
    snowParticles.geometry.attributes.position.needsUpdate = true;
}

class Particle {
    constructor(mesh, type) {
        this.mesh = mesh;
        this.type = type;
        this.baseScale = mesh.scale.x;
        this.treePos = new THREE.Vector3();
        this.scatterPos = new THREE.Vector3();
        this.calcPositions();
    }

    calcPositions() {
        const h = CONFIG.particles.treeHeight;
        const r = CONFIG.particles.treeRadius;
        const t = Math.pow(Math.random(), 0.75);
        const y = t * h - h / 2;
        const maxR = r * (1 - t);
        const actualR = Math.max(0.8, maxR) * (0.7 + Math.random() * 0.5);
        const angle = t * 45 * Math.PI;
        this.treePos.set(Math.cos(angle) * actualR, y, Math.sin(angle) * actualR);

        const scatterR = 10 + Math.random() * 15;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.scatterPos.set(
            scatterR * Math.sin(phi) * Math.cos(theta),
            scatterR * Math.sin(phi) * Math.sin(theta),
            scatterR * Math.cos(phi)
        );
    }

    update(dt, mode, focusMesh) {
        let target = this.treePos;
        if (mode === 'SCATTER' || (mode === 'FOCUS' && this.mesh !== focusMesh)) {
            target = this.scatterPos;
        } else if (mode === 'FOCUS' && this.mesh === focusMesh) {
            const worldTarget = new THREE.Vector3(0, 3, 38);
            target = worldTarget.applyMatrix4(mainGroup.matrixWorld.clone().invert());
        }

        const speed = (mode === 'FOCUS' && this.mesh === focusMesh) ? 6 : 3;
        this.mesh.position.lerp(target, speed * dt);

        if (mode === 'SCATTER' && this.type !== 'PHOTO') {
            this.mesh.rotation.x += dt * 0.5;
            this.mesh.rotation.y += dt * 0.8;
        }

        let targetScale = this.baseScale;
        if (mode === 'FOCUS' && this.mesh === focusMesh) targetScale = 5;
        else if (mode === 'SCATTER' && this.type === 'PHOTO') targetScale = this.baseScale * 3;

        this.mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 5 * dt);

        if (this.type === 'PHOTO' && mode === 'FOCUS' && this.mesh === focusMesh) {
            this.mesh.lookAt(camera.position);
        }
    }
}

function addPhoto(texture) {
    const group = new THREE.Group();
    const imageAspect = texture.image.width / texture.image.height;
    const frameSize = 1.5;

    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(frameSize, frameSize, 0.08),
        new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1, roughness: 0.1, envMapIntensity: 1.5 })
    );
    group.add(frame);

    let photoWidth = frameSize * 0.86;
    let photoHeight = photoWidth / imageAspect;
    if (photoHeight > frameSize * 0.86) {
        photoHeight = frameSize * 0.86;
        photoWidth = photoHeight * imageAspect;
    }

    const photo = new THREE.Mesh(
        new THREE.PlaneGeometry(photoWidth, photoHeight),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    photo.position.z = 0.05;
    group.add(photo);

    group.scale.setScalar(0.8);
    photoGroup.add(group);
    particleSystem.push(new Particle(group, 'PHOTO'));
}

function loadAllPhotos() {
    const loader = new THREE.TextureLoader();
    photoFiles.forEach(filename => {
        loader.load(filename, texture => {
            texture.colorSpace = THREE.SRGBColorSpace;
            addPhoto(texture);
        }, undefined, err => console.warn(`Load failed: ${filename}`, err));
    });
}

async function initMediaPipeHandTracking() {
    video = document.getElementById('webcam');
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
        });

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = stream;
        video.addEventListener('loadeddata', () => video.play() && requestAnimationFrame(predictHandLoop));
    } catch (err) {
        console.warn("Webcam không khả dụng, dùng chế độ mặc định:", err);
    }
}

let lastVideoTime = -1;
function predictHandLoop() {
    if (!handLandmarker || !video) return requestAnimationFrame(predictHandLoop);
    if (video.currentTime === lastVideoTime) return requestAnimationFrame(predictHandLoop);

    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, performance.now());
    processHandGestures(results);
    requestAnimationFrame(predictHandLoop);
}

function processHandGestures(results) {
    if (results.landmarks && results.landmarks.length > 0) {
        const lm = results.landmarks[0];
        const thumb = lm[4], index = lm[8];
        const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);

        const wrist = lm[0];
        const tips = [lm[8], lm[12], lm[16], lm[20]];
        const avgSpread = tips.reduce((sum, tip) => sum + Math.hypot(tip.x - wrist.x, tip.y - wrist.y), 0) / 4;

        let newGesture = null;
        if (pinchDist < 0.05) newGesture = 'PINCH';
        else if (avgSpread < 0.25) newGesture = 'FIST';
        else if (avgSpread > 0.4) newGesture = 'OPEN';

        if (newGesture && newGesture !== STATE.currentGesture) {
            STATE.currentGesture = newGesture;
            if (newGesture === 'PINCH') {
                STATE.mode = 'FOCUS';
                const photos = particleSystem.filter(p => p.type === 'PHOTO');
                if (photos.length > 0) STATE.focusTarget = photos[Math.floor(Math.random() * photos.length)].mesh;
            } else if (newGesture === 'FIST') {
                STATE.mode = 'TREE';
                STATE.focusTarget = null;
            } else if (newGesture === 'OPEN') {
                STATE.mode = 'SCATTER';
                STATE.focusTarget = null;
            }
        }
        STATE.hand.detected = true;
    } else {
        STATE.hand.detected = false;
    }
}

function setupEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });
}

function setupPostProcessing() {
    const renderPass = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.0,   // strength giảm
        0.3,   // radius giảm
        0.8    // threshold cao hơn → ít vật thể bloom hơn
    );
    bloom.strength = 0.45;
    bloom.radius = 0.5;

    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloom);
}

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const time = performance.now() * 0.003;

    // Fairy lights flicker nhẹ nhàng
    fairyLights.forEach(light => {
        const intensity = CONFIG.lights.fairyIntensity * (0.8 + 0.4 * Math.sin(time + light.userData.phase));
        light.material.emissiveIntensity = intensity;
    });

    // Rotation
    if (STATE.mode === 'TREE') STATE.rotation.y += 0.25 * dt;
    else if (STATE.mode === 'SCATTER') STATE.rotation.y += 0.15 * dt;
    mainGroup.rotation.y = STATE.rotation.y;

    particleSystem.forEach(p => p.update(dt, STATE.mode, STATE.focusTarget));
    updatePointSnow(dt);

    composer.render();
    
}
const music = document.getElementById('christmas-music');
if (music) {
    music.volume = 0.3;  // Âm lượng 30% - nhẹ nhàng, không lấn át hiệu ứng 3D
    // Nếu muốn thấp hơn: 0.2, cao hơn: 0.4-0.5
}
init();