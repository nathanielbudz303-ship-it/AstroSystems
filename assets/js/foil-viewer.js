import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Interactive foil. The user pitches the aircraft about the centre of its chord
// to see how the wing turns oncoming air, which is where lift comes from.
// It sits half off the right edge of the page by design.
//
// If the model sits at the wrong angle on screen, VIEW is the only thing to touch.
const MAX_AOA = 30;                                // degrees each way
// az orbits horizontally, el raises the camera, pad is headroom around the model
// (1.0 = exactly touching the frame edges, below 1.0 overflows it).
// shiftX / shiftY nudge the aircraft around the frame, as a fraction of its own
// width: positive moves it right and up.
// The top clears when pad > 1 + 2*shiftY. These values sit below that on purpose,
// accepting a clip off the top edge in exchange for the aircraft reading large.
// Two rules govern this whole block:
//   model height on screen = canvas height / pad
//   nothing clips when      pad >= 1 + 2 * shiftY
// At shiftY 0 the largest uncropped model is exactly the canvas height. The canvas
// no longer has to match the copy beside it, because it is absolutely positioned
// and drives no layout height — so it can be as tall as the page allows.
// FOUR THINGS MOVE TOGETHER: this pad, the canvas aspect in index.html, the
// dial's viewBox (which must share that aspect, or preserveAspectRatio="none"
// stretches it), and DIAL's centre and radius.
const VIEW = { az: 0.78, el: 0.55, pad: 0.90, shiftX: 0.0, shiftY: 0.0 };
// Which axis the wing gimbals about. If it tilts the wrong way on screen, this
// is a one-character change: 'x' or 'y'.
const PITCH_AXIS = 'x';

// Which way a positive angle of attack turns the wing. If the nose drops when
// the readout climbs, flip this to 1. It is the ONLY thing that controls the
// direction of travel — the dial's own numbering is fixed above.
const PITCH_SIGN = -1;

// Where the nose sits in the model's own plan view, in degrees, measured
// anticlockwise from +X. This is the ONE number to change if the wrong edge of
// the wing is rising: everything below is derived from it, so the nose is always
// both the part facing the page and the part that lifts.
// Established from the model: 13 parts sit at bearing 90 and 13 at 270 — the
// gimbal servos and bearings at both ends of the hinge. So the hinge runs along
// Y, which puts the nose on X.
const FRONT_BEARING = 0;

// Where that nose should point on screen. 180 is left, 0 is right.
const FACE_ON_SCREEN = 180;

// Screen directions depend on where the camera is standing, so the camera's own
// azimuth has to be folded in — without it, "face left" only held for one
// particular camera angle.
const MODEL_YAW = THREE.MathUtils.degToRad(
    FACE_ON_SCREEN + THREE.MathUtils.radToDeg(VIEW.az) - FRONT_BEARING
);
// The hinge runs across the aircraft, square to the nose, so tilting lifts the
// nose rather than a shoulder.
const PITCH_HEADING = THREE.MathUtils.degToRad(FRONT_BEARING + 90);

// The CAD captures the airframe tilted inside the ring, as if mid-manoeuvre.
// Set false to keep that attitude.
const LEVEL_AIRFRAME = true;

const MODEL = 'assets/models/astra-assembly.glb';

// The dial spans the whole canvas in a 1600x1000 viewBox.
//
// The arc is drawn to sit beside the wing rather than concentric with it. Being
// concentric would not help anyway: the ring is a circle seen at elevation, so
// it projects as an ellipse (roughly 2:1 here), and an ellipse's centre of
// curvature is nowhere near its centre.
// It sits in the empty band between the mission copy and "Meet Astra", clear of
// both the text and the wing.
// Span and radius are two views of one number, held against a fixed arc LENGTH
// of ~277 units so the dial keeps its size whatever the bend:
//   span 95 -> r 167 (harsh)   span 60 -> r 265   span 45 -> r 353 (here)
// The knob at rest is the arc's midpoint, viewBox (75, 720).
// Angles are degrees clockwise from +x, because SVG's y axis points down.
// from = where -MAX_AOA sits, to = where +MAX_AOA sits. Positive is the raised
// end of the arc, so the numbers climb as the nose climbs.
const DIAL = { cx: 369, cy: 525, r: 353, from: 124, to: 169 };
const VB = { w: 1600, h: 1000 };

const host = document.getElementById('foil-canvas');
const readout = document.getElementById('foil-readout');
const slider = document.getElementById('foil-slider');
const hint = document.getElementById('foil-hint');

if (host) start();

function start() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 8000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    host.appendChild(renderer.domElement);

    // An environment map does most of the work on a finish like this: without
    // reflections, metal and painted surfaces both flatten into the same grey.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 1.5, 0.8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.1);
    rim.position.set(-1.3, -0.3, -1);
    scene.add(rim);

    // The CAD is Z-up, three.js is Y-up. Without this the ring stands on edge
    // instead of lying flat, which is why the aircraft looked tipped over.
    const root = new THREE.Group();
    const upFix = new THREE.Group();
    upFix.rotation.x = -Math.PI / 2;
    root.add(upFix);

    // Yaw turns the aircraft on the spot; the camera is left alone so the
    // composition does not move when the heading changes.
    const yaw = new THREE.Group();
    yaw.rotation.z = MODEL_YAW;
    upFix.add(yaw);

    // Centring lives inside the up-correction so the pitch axis stays in the
    // model's own coordinates.
    const centred = new THREE.Group();
    yaw.add(centred);

    // Only the wing gimbals. The airframe, rotors and gear stay fixed and the ring
    // rotates around them, which is the actual mechanism on the aircraft.
    const airframe = new THREE.Group();
    centred.add(airframe);

    // Hinge aiming, as a sandwich: turn to the hinge heading, tilt, then turn
    // back. The wing ends up tilting about an arbitrary horizontal axis without
    // being spun in its own plane, which would be visible on a shaped ring.
    const pitchFrame = new THREE.Group();
    pitchFrame.rotation.z = PITCH_HEADING;
    centred.add(pitchFrame);

    const pitchGroup = new THREE.Group();
    pitchFrame.add(pitchGroup);

    const wingHolder = new THREE.Group();
    wingHolder.rotation.z = -PITCH_HEADING;
    pitchGroup.add(wingHolder);

    scene.add(root);

    let span = 900;

    // Deferred: nothing is fetched until the section is near the viewport, so the
    // model never competes with the hero for bandwidth on first paint.
    let requested = false;
    function loadModel() {
        if (requested) return;
        requested = true;
        const loader = new GLTFLoader();
        const draco = new DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(draco);
        loader.load(MODEL, onLoad, undefined, onError);
    }

    const onLoad = (gltf) => {
        const model = gltf.scene;

        // Guard kept from HalfFoil.glb, which shipped Blender's default cube.
        model.traverse((o) => {
            if (/^Cube/i.test(o.name)) o.visible = false;
        });

        // The CAD export flattened all 56 appearances to one grey, so the
        // white-wing / dark-airframe contrast is rebuilt here. The wing is the
        // only part that spans the whole aircraft, so it identifies itself by
        // size rather than by a name the exporter did not preserve.
        const wingSkin = new THREE.MeshStandardMaterial({
            color: 0xfafbfd, metalness: 0.0, roughness: 0.38, side: THREE.DoubleSide
        });
        // The fuselage is the same painted white as the wing, just glossier.
        const shellSkin = new THREE.MeshStandardMaterial({
            color: 0xeef1f6, metalness: 0.1, roughness: 0.3, side: THREE.DoubleSide
        });
        // Arms, motors, props and electronics: dark anodised metal.
        const gearSkin = new THREE.MeshStandardMaterial({
            color: 0x1b1f27, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide
        });

        const meshes = [];
        model.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });

        let widest = 0;
        for (const mesh of meshes) {
            mesh.geometry.computeBoundingBox();
            const b = mesh.geometry.boundingBox;
            widest = Math.max(widest, b.max.x - b.min.x, b.max.y - b.min.y);
        }

        // Rebuilt from geometry, since the export flattened all 56 appearances to
        // one grey. The wing spans the whole aircraft; the fuselage is the bulky
        // stuff clustered at the centre; everything else is hardware.
        const wings = [];   // the ring
        const hinges = [];  // hardware on the gimbal axis, swings with the ring
        const frame = [];   // everything that stays put
        const centre = new THREE.Vector3();
        for (const mesh of meshes) {
            const b = mesh.geometry.boundingBox;
            b.getCenter(centre);
            const reach = Math.max(b.max.x - b.min.x, b.max.y - b.min.y);
            const radius = Math.hypot(centre.x, centre.y);
            const bulk = Math.max(reach, b.max.z - b.min.z);

            if (reach > widest * 0.7) {
                mesh.material = wingSkin;
                wings.push(mesh);
            } else if (radius < widest * 0.09 && bulk > widest * 0.09) {
                mesh.material = shellSkin;
                frame.push(mesh);
            } else {
                mesh.material = gearSkin;
                // Out near the rim and sitting on the hinge line (so barely any x
                // offset): this is the gimbal hardware, and it travels with the wing.
                const onHinge = radius > widest * 0.25 && Math.abs(centre.x) < widest * 0.08;
                (onHinge ? hinges : frame).push(mesh);
            }
        }

        const box = new THREE.Box3();
        model.traverse((o) => {
            if (o.isMesh && o.visible) box.expandByObject(o);
        });
        const size = box.getSize(new THREE.Vector3());
        const mid = box.getCenter(new THREE.Vector3());
        span = Math.max(size.x, size.y, size.z);

        // Split the aircraft: wing into the group that rotates, the rest into the
        // one that does not. Every node in this export sits at identity, so
        // reparenting moves nothing.
        airframe.add(model);
        for (const wing of wings) wingHolder.add(wing);
        for (const part of hinges) wingHolder.add(part);
        // Levelled from the parts that actually stay put, so the gimbal hardware
        // cannot skew the fit.
        if (LEVEL_AIRFRAME) levelOut(airframe, frame);
        centred.position.sub(mid);

        frameModel();
        resize();
    };

    const onError = (err) => {
        console.error(MODEL + ' failed to load', err);
        if (hint) hint.textContent = 'Model unavailable';
    };

    // --- Curved dial
    const dial = document.getElementById('foil-dial');
    const dialKnob = document.getElementById('dial-knob');
    const dialFill = document.getElementById('dial-fill');
    const dialValue = document.getElementById('dial-value');

    const polar = (deg) => {
        const t = THREE.MathUtils.degToRad(deg);
        return [DIAL.cx + DIAL.r * Math.cos(t), DIAL.cy + DIAL.r * Math.sin(t)];
    };
    const arcPath = (a, b) => {
        const [x1, y1] = polar(a);
        const [x2, y2] = polar(b);
        const sweep = b > a ? 1 : 0;
        return `M ${x1} ${y1} A ${DIAL.r} ${DIAL.r} 0 0 ${sweep} ${x2} ${y2}`;
    };
    // -MAX_AOA maps to DIAL.from, +MAX_AOA to DIAL.to
    const degForAoA = (aoa) =>
        DIAL.from + ((aoa + MAX_AOA) / (2 * MAX_AOA)) * (DIAL.to - DIAL.from);

    if (dial) {
        const mid = (DIAL.from + DIAL.to) / 2;
        document.getElementById('dial-track').setAttribute('d', arcPath(DIAL.from, DIAL.to));
        document.getElementById('dial-hit').setAttribute('d', arcPath(DIAL.from, DIAL.to));

        // Push a point further out along its own radius: the arc centre is up and
        // right, so "outward" is down and left — clear of the wing.
        const outward = (deg, by) => {
            const t = THREE.MathUtils.degToRad(deg);
            const [x, y] = polar(deg);
            return [x + by * Math.cos(t), y + by * Math.sin(t)];
        };


        const hit = document.getElementById('dial-hit');
        const box = document.getElementById('foil-dial-box');

        // Work in viewBox units off the box's own rect, rather than relying on
        // SVG hit testing against a hairline path.
        const toDial = (e) => {
            const r = box.getBoundingClientRect();
            return [((e.clientX - r.left) / r.width) * VB.w,
                    ((e.clientY - r.top) / r.height) * VB.h];
        };
        // Grab margin either side of the arc. This is a band around a RADIUS, so
        // on a tight arc it becomes a wide annulus covering far more of the page
        // than the dial occupies — it has to scale with r, not stay fixed.
        const GRAB = 55;
        const nearArc = (x, y) =>
            Math.abs(Math.hypot(x - DIAL.cx, y - DIAL.cy) - DIAL.r) < GRAB;

        const fromPointer = (x, y) => {
            let deg = THREE.MathUtils.radToDeg(Math.atan2(y - DIAL.cy, x - DIAL.cx));
            // atan2 wraps at +/-180, and this arc straddles 180. Re-centre the
            // reading on the arc's midpoint before clamping, or everything past
            // 180 reads as negative and snaps to the low end.
            deg = mid + (((deg - mid + 540) % 360) - 180);
            const lo = Math.min(DIAL.from, DIAL.to);
            const hi = Math.max(DIAL.from, DIAL.to);
            deg = Math.max(lo, Math.min(hi, deg));
            const t = (deg - DIAL.from) / (DIAL.to - DIAL.from);
            setAoA(-MAX_AOA + t * 2 * MAX_AOA, true);
        };

        let onDial = false;
        box.addEventListener('pointerdown', (e) => {
            const [x, y] = toDial(e);
            if (!nearArc(x, y)) return;
            onDial = true;
            box.setPointerCapture(e.pointerId);
            fromPointer(x, y);
        });
        box.addEventListener('pointermove', (e) => {
            const [x, y] = toDial(e);
            box.style.cursor = onDial || nearArc(x, y) ? 'grab' : '';
            if (onDial) fromPointer(x, y);
        });
        const endDial = (e) => {
            onDial = false;
            try { box.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
        };
        box.addEventListener('pointerup', endDial);
        box.addEventListener('pointercancel', endDial);

        hit.addEventListener('keydown', (e) => {
            const step = e.shiftKey ? 10 : 2;
            const by = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[e.key];
            if (by === undefined) return;
            setAoA(target + by, true);
            e.preventDefault();
        });
        hit.addEventListener('focus', () => dialKnob.setAttribute('stroke-width', '3'));
        hit.addEventListener('blur', () => dialKnob.removeAttribute('stroke-width'));

        var drawDial = (aoa) => {
            const deg = degForAoA(aoa);
            const [kx, ky] = polar(deg);
            dialKnob.setAttribute('transform', `translate(${kx} ${ky})`);
            dialFill.setAttribute('d', arcPath(degForAoA(0), deg));
            // Clearance between the arc and the readout. With the text anchored
            // at its end this is the whole gap — the number grows outboard, away
            // from the knob, so the knob's own 16-unit radius is all it has to
            // clear.
            const [vx, vy] = outward(deg, 46);
            dialValue.setAttribute('x', vx);
            dialValue.setAttribute('y', vy + 8);
            // text-anchor lives on the element in index.html and must stay "end".
            // Centring it here made the clearance depend on label width, so
            // "+30.0" crowded the knob while "+0.0" cleared it.
            dialValue.textContent = (aoa >= 0 ? '+' : '') + aoa.toFixed(1) + '°';
            hit.setAttribute('aria-valuenow', aoa.toFixed(1));
            hit.setAttribute('aria-valuetext', aoa.toFixed(1) + ' degrees');
        };
        drawDial(0);
    }

    // --- Input: drag the frame, or use the slider.
    let target = 0;
    let shown = 0;
    let touched = false;
    const clamp = (v) => Math.max(-MAX_AOA, Math.min(MAX_AOA, v));

    function setAoA(deg, fromSlider) {
        target = clamp(deg);
        if (!fromSlider && slider) slider.value = target.toFixed(1);
        if (!touched) {
            touched = true;
            if (hint) hint.style.opacity = '0';
        }
    }

    if (slider) slider.addEventListener('input', () => setAoA(parseFloat(slider.value), true));

    // --- Render only while it is on screen; a second WebGL context should not
    // --- burn frames behind the fold.
    let live = false;
    new IntersectionObserver((entries) => {
        const wasLive = live;
        live = entries[0].isIntersecting;
        if (live) loadModel();
        if (live && !wasLive) loop();
    }, { threshold: 0.05, rootMargin: '400px 0px' }).observe(host);

    // Fits a plane through the airframe parts and rotates the group until that
    // plane is flat. Measured rather than hardcoded, so a re-export that changes
    // the attitude still comes out level.
    function levelOut(group, objs) {
        if (objs.length < 4) return;
        const c = new THREE.Vector3();
        let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
        for (const o of objs) {
            o.geometry.computeBoundingBox();
            o.geometry.boundingBox.getCenter(c);
            n++; sx += c.x; sy += c.y; sz += c.z;
            sxx += c.x * c.x; sxy += c.x * c.y; syy += c.y * c.y;
            sxz += c.x * c.z; syz += c.y * c.z;
        }
        // least squares z = a*x + b*y + d, solved by Cramer's rule
        const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
        const r = [sxz, syz, sz];
        const det = (q) =>
            q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) -
            q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) +
            q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
        const D = det(m);
        if (Math.abs(D) < 1e-12) return;
        const sub = (col) => m.map((row, i) => row.map((val, k) => (k === col ? r[i] : val)));
        const a = det(sub(0)) / D;
        const b = det(sub(1)) / D;

        group.rotation.order = 'YXZ';
        group.rotation.y = Math.atan(a);
        group.rotation.x = -Math.atan(b);
    }

    // Distance is derived, not guessed: fit the model's radius to whichever of
    // the frame's two dimensions is tighter, then add headroom.
    function frameModel() {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        const aspect = w / h;
        const radius = span * 0.5;
        const vFov = THREE.MathUtils.degToRad(camera.fov);
        const fitH = radius / Math.tan(vFov / 2);
        const fitW = radius / (Math.tan(vFov / 2) * aspect);
        const dist = Math.max(fitH, fitW) * VIEW.pad;

        const horiz = Math.cos(VIEW.el) * dist;
        camera.position.set(
            Math.sin(VIEW.az) * horiz,
            Math.sin(VIEW.el) * dist,
            Math.cos(VIEW.az) * horiz
        );
        camera.lookAt(0, 0, 0);

        // Pan camera and target together by the same vector: the view slides, so
        // the aircraft appears to move the opposite way across the frame.
        if (VIEW.shiftX || VIEW.shiftY) {
            camera.updateMatrixWorld();
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            const pan = right.multiplyScalar(-VIEW.shiftX * span)
                .addScaledVector(up, -VIEW.shiftY * span);
            camera.position.add(pan);
            camera.lookAt(pan.x, pan.y, pan.z);
        }
    }

    function resize() {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        frameModel();
    }
    window.addEventListener('resize', resize);

    function loop() {
        if (!live) return;
        requestAnimationFrame(loop);

        shown += (target - shown) * 0.12;
        const rad = THREE.MathUtils.degToRad(shown);
        pitchGroup.rotation[PITCH_AXIS] = PITCH_SIGN * rad;
        if (readout) readout.textContent = (shown >= 0 ? '+' : '') + shown.toFixed(1) + '°';
        if (typeof drawDial === 'function') drawDial(shown);

        renderer.render(scene, camera);
    }
}
