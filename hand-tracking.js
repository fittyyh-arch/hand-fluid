class HandTracker {
    constructor(videoElement, onResults) {
        this.video = videoElement;
        this.onResults = onResults;
        this.prevLandmarks = null;
        this.hands = null;
        this.camera = null;
    }

    async start() {
        this.hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
        });

        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults((results) => this._processResults(results));

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 }
        });
        this.video.srcObject = stream;

        this.camera = new Camera(this.video, {
            onFrame: async () => {
                await this.hands.send({ image: this.video });
            },
            width: 640,
            height: 480
        });
        this.camera.start();
    }

    _processResults(results) {
        const points = [];

        if (results.multiHandLandmarks) {
            results.multiHandLandmarks.forEach((landmarks, handIdx) => {
                const fingertips = [4, 8, 12, 16, 20];
                const palm = landmarks[9];

                fingertips.forEach((tipIdx, fingerIdx) => {
                    const tip = landmarks[tipIdx];
                    points.push({
                        x: 1 - tip.x,
                        y: 1 - tip.y,
                        handIdx,
                        fingerIdx
                    });
                });

                points.push({
                    x: 1 - palm.x,
                    y: 1 - palm.y,
                    handIdx,
                    fingerIdx: 5,
                    isPalm: true
                });
            });
        }

        const currentMap = {};
        points.forEach(p => {
            const key = `${p.handIdx}_${p.fingerIdx}`;
            currentMap[key] = p;
        });

        const deltas = [];
        if (this.prevLandmarks) {
            for (const key in currentMap) {
                if (this.prevLandmarks[key]) {
                    const prev = this.prevLandmarks[key];
                    const curr = currentMap[key];
                    const dx = curr.x - prev.x;
                    const dy = curr.y - prev.y;
                    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                        deltas.push({ x: curr.x, y: curr.y, dx, dy, fingerIdx: curr.fingerIdx });
                    }
                }
            }
        }

        this.prevLandmarks = currentMap;
        this.onResults(deltas, points.length > 0);
    }

    stop() {
        if (this.camera) this.camera.stop();
    }
}
