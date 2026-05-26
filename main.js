const FINGER_COLORS = [
    [1.0, 0.4, 0.7],   // thumb - magenta
    [0.4, 0.7, 1.0],   // index - soft blue
    [0.3, 1.0, 0.9],   // middle - teal
    [0.9, 0.5, 1.0],   // ring - lavender
    [0.5, 0.3, 1.0],   // pinky - indigo
    [0.3, 0.8, 1.0],   // palm - cyan
];

let fluid, tracker;
let lastMouse = null;
let fpsFrames = 0, fpsTime = performance.now();

const canvas = document.getElementById('fluid-canvas');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const handStatusEl = document.getElementById('hand-status');
const video = document.getElementById('camera');

function init() {
    fluid = new FluidSimulation(canvas);
    setupMouseTouch();
    requestAnimationFrame(loop);
}

function loop() {
    fluid.step();
    fluid.render();

    fpsFrames++;
    const now = performance.now();
    if (now - fpsTime > 500) {
        fpsEl.textContent = Math.round(fpsFrames / ((now - fpsTime) / 1000)) + ' FPS';
        fpsFrames = 0;
        fpsTime = now;
    }

    requestAnimationFrame(loop);
}

function setupMouseTouch() {
    let isDown = false;
    let prev = null;

    function getPos(e) {
        const x = (e.clientX || e.touches[0].clientX) / canvas.width;
        const y = 1 - (e.clientY || e.touches[0].clientY) / canvas.height;
        return { x, y };
    }

    function onMove(e) {
        if (!isDown && e.type !== 'mousemove') return;
        if (e.type === 'mousemove' && !isDown) return;
        e.preventDefault();

        const pos = getPos(e);
        if (prev) {
            const dx = pos.x - prev.x;
            const dy = pos.y - prev.y;
            if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
                const hue = (performance.now() * 0.001) % 1;
                const color = hslToRgb(hue, 1, 0.5);
                fluid.splat(pos.x, pos.y, dx * 50, dy * 50, color);
            }
        }
        prev = pos;
    }

    canvas.addEventListener('mousedown', (e) => { isDown = true; prev = getPos(e); });
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', () => { isDown = false; prev = null; });
    canvas.addEventListener('mouseleave', () => { isDown = false; prev = null; });

    canvas.addEventListener('touchstart', (e) => { isDown = true; prev = getPos(e); e.preventDefault(); });
    canvas.addEventListener('touchmove', onMove);
    canvas.addEventListener('touchend', () => { isDown = false; prev = null; });
}

function onHandResults(deltas, hasHands) {
    handStatusEl.textContent = hasHands ? '🖐️ 检测到手部' : '🖐️ 等待手部...';

    deltas.forEach(d => {
        const color = FINGER_COLORS[d.fingerIdx] || FINGER_COLORS[5];
        const strength = 25;
        fluid.splat(d.x, d.y, d.dx * strength, d.dy * strength, color);
    });
}

startBtn.addEventListener('click', async () => {
    overlay.classList.add('hidden');
    statusEl.classList.remove('hidden');

    tracker = new HandTracker(video, onHandResults);
    try {
        await tracker.start();
    } catch (err) {
        handStatusEl.textContent = '⚠️ 摄像头不可用，用鼠标玩吧';
        video.style.display = 'none';
    }
});

overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
        overlay.classList.add('hidden');
        statusEl.classList.remove('hidden');
    }
});

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [r, g, b];
}

init();
