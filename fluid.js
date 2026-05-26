class FluidSimulation {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: false });
        if (!this.gl) throw new Error('WebGL not supported');

        this.simWidth = 256;
        this.simHeight = 256;
        this.dyeWidth = 1024;
        this.dyeHeight = 1024;

        this.dt = 0.016;
        this.dissipation = 0.97;
        this.pressureIterations = 20;
        this.curl = 25;
        this.splatRadius = 0.002;

        this._resize();
        this._initGL();
        this._initFramebuffers();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) {
            this.simWidth = Math.floor(256 * aspectRatio);
            this.simHeight = 256;
            this.dyeWidth = Math.floor(1024 * aspectRatio);
            this.dyeHeight = 1024;
        } else {
            this.simWidth = 256;
            this.simHeight = Math.floor(256 / aspectRatio);
            this.dyeWidth = 1024;
            this.dyeHeight = Math.floor(1024 / aspectRatio);
        }
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(shader));
        return shader;
    }

    _createProgram(vs, fs) {
        const gl = this.gl;
        const prog = gl.createProgram();
        gl.attachShader(prog, this._compileShader(gl.VERTEX_SHADER, vs));
        gl.attachShader(prog, this._compileShader(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(prog));
        const uniforms = {};
        const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const info = gl.getActiveUniform(prog, i);
            uniforms[info.name] = gl.getUniformLocation(prog, info.name);
        }
        return { program: prog, uniforms };
    }

    _createFBO(w, h, type) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { texture: tex, fbo, width: w, height: h };
    }

    _createDoubleFBO(w, h, type) {
        return {
            read: this._createFBO(w, h, type),
            write: this._createFBO(w, h, type),
            swap() { [this.read, this.write] = [this.write, this.read]; }
        };
    }

    _initFramebuffers() {
        const gl = this.gl;
        const halfFloat = gl.getExtension('OES_texture_half_float');
        const type = halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
        gl.getExtension('OES_texture_half_float_linear');

        this.velocity = this._createDoubleFBO(this.simWidth, this.simHeight, type);
        this.pressure = this._createDoubleFBO(this.simWidth, this.simHeight, type);
        this.dye = this._createDoubleFBO(this.dyeWidth, this.dyeHeight, type);
        this.divergenceFBO = this._createFBO(this.simWidth, this.simHeight, type);
        this.curlFBO = this._createFBO(this.simWidth, this.simHeight, type);
        this.bloomFBO = this._createFBO(this.dyeWidth, this.dyeHeight, type);
    }

    _initGL() {
        const gl = this.gl;
        const quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        const baseVS = `attribute vec2 a_position;
            varying vec2 vUv;
            void main() {
                vUv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }`;

        this.programs = {
            advection: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uVelocity;
                uniform sampler2D uSource;
                uniform vec2 texelSize;
                uniform float dt;
                uniform float dissipation;
                void main() {
                    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                    gl_FragColor = dissipation * texture2D(uSource, coord);
                }
            `),
            splat: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTarget;
                uniform vec3 color;
                uniform vec2 point;
                uniform float radius;
                uniform float aspectRatio;
                void main() {
                    vec2 p = vUv - point;
                    p.x *= aspectRatio;
                    vec3 splat = exp(-dot(p,p) / radius) * color;
                    vec3 base = texture2D(uTarget, vUv).xyz;
                    gl_FragColor = vec4(base + splat, 1.0);
                }
            `),
            divergence: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uVelocity;
                uniform vec2 texelSize;
                void main() {
                    float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0)).x;
                    float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0)).x;
                    float T = texture2D(uVelocity, vUv + vec2(0, texelSize.y)).y;
                    float B = texture2D(uVelocity, vUv - vec2(0, texelSize.y)).y;
                    gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
                }
            `),
            pressure: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uPressure;
                uniform sampler2D uDivergence;
                uniform vec2 texelSize;
                void main() {
                    float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0)).x;
                    float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0)).x;
                    float T = texture2D(uPressure, vUv + vec2(0, texelSize.y)).x;
                    float B = texture2D(uPressure, vUv - vec2(0, texelSize.y)).x;
                    float div = texture2D(uDivergence, vUv).x;
                    gl_FragColor = vec4((L + R + T + B - div) * 0.25, 0.0, 0.0, 1.0);
                }
            `),
            gradientSubtract: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uPressure;
                uniform sampler2D uVelocity;
                uniform vec2 texelSize;
                void main() {
                    float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0)).x;
                    float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0)).x;
                    float T = texture2D(uPressure, vUv + vec2(0, texelSize.y)).x;
                    float B = texture2D(uPressure, vUv - vec2(0, texelSize.y)).x;
                    vec2 vel = texture2D(uVelocity, vUv).xy;
                    vel -= vec2(R - L, T - B) * 0.5;
                    gl_FragColor = vec4(vel, 0.0, 1.0);
                }
            `),
            curl: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uVelocity;
                uniform vec2 texelSize;
                void main() {
                    float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0)).y;
                    float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0)).y;
                    float T = texture2D(uVelocity, vUv + vec2(0, texelSize.y)).x;
                    float B = texture2D(uVelocity, vUv - vec2(0, texelSize.y)).x;
                    gl_FragColor = vec4(R - L - T + B, 0.0, 0.0, 1.0);
                }
            `),
            vorticity: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uVelocity;
                uniform sampler2D uCurl;
                uniform vec2 texelSize;
                uniform float curl;
                uniform float dt;
                void main() {
                    float L = texture2D(uCurl, vUv - vec2(texelSize.x, 0)).x;
                    float R = texture2D(uCurl, vUv + vec2(texelSize.x, 0)).x;
                    float T = texture2D(uCurl, vUv + vec2(0, texelSize.y)).x;
                    float B = texture2D(uCurl, vUv - vec2(0, texelSize.y)).x;
                    float C = texture2D(uCurl, vUv).x;
                    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                    float len = length(force) + 0.0001;
                    force = force / len * curl * C;
                    vec2 vel = texture2D(uVelocity, vUv).xy + force * dt;
                    gl_FragColor = vec4(vel, 0.0, 1.0);
                }
            `),
            bloom: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform vec2 texelSize;
                void main() {
                    vec3 sum = vec3(0.0);
                    for (int x = -2; x <= 2; x++) {
                        for (int y = -2; y <= 2; y++) {
                            vec2 offset = vec2(float(x), float(y)) * texelSize * 1.5;
                            sum += texture2D(uTexture, vUv + offset).rgb;
                        }
                    }
                    sum /= 25.0;
                    gl_FragColor = vec4(sum, 1.0);
                }
            `),
            display: this._createProgram(baseVS, `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform sampler2D uBloom;
                void main() {
                    vec3 base = texture2D(uTexture, vUv).rgb;
                    vec3 bloom = texture2D(uBloom, vUv).rgb;
                    vec3 c = base + bloom * 0.6;
                    gl_FragColor = vec4(c, 1.0);
                }
            `)
        };
    }
    // PLACEHOLDER_METHODS

    _blit(target) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
        if (target) gl.viewport(0, 0, target.width, target.height);
        else gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    _useProgram(prog) {
        this.gl.useProgram(prog.program);
        return prog.uniforms;
    }

    splat(x, y, dx, dy, color) {
        const gl = this.gl;
        const u = this._useProgram(this.programs.splat);
        gl.uniform2f(u.point, x, y);
        gl.uniform3f(u.color, dx * 10, dy * 10, 0);
        gl.uniform1f(u.radius, this.splatRadius);
        gl.uniform1f(u.aspectRatio, this.canvas.width / this.canvas.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uTarget, 0);
        this._blit(this.velocity.write);
        this.velocity.swap();

        const u2 = this._useProgram(this.programs.splat);
        gl.uniform2f(u2.point, x, y);
        gl.uniform3f(u2.color, color[0], color[1], color[2]);
        gl.uniform1f(u2.radius, this.splatRadius);
        gl.uniform1f(u2.aspectRatio, this.canvas.width / this.canvas.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.dye.read.texture);
        gl.uniform1i(u2.uTarget, 0);
        this._blit(this.dye.write);
        this.dye.swap();
    }

    step() {
        const gl = this.gl;
        const simTexel = [1.0 / this.simWidth, 1.0 / this.simHeight];
        const dyeTexel = [1.0 / this.dyeWidth, 1.0 / this.dyeHeight];

        // Curl
        let u = this._useProgram(this.programs.curl);
        gl.uniform2f(u.texelSize, simTexel[0], simTexel[1]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uVelocity, 0);
        this._blit(this.curlFBO);

        // Vorticity
        u = this._useProgram(this.programs.vorticity);
        gl.uniform2f(u.texelSize, simTexel[0], simTexel[1]);
        gl.uniform1f(u.curl, this.curl);
        gl.uniform1f(u.dt, this.dt);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.curlFBO.texture);
        gl.uniform1i(u.uCurl, 1);
        this._blit(this.velocity.write);
        this.velocity.swap();

        // Advect velocity
        u = this._useProgram(this.programs.advection);
        gl.uniform2f(u.texelSize, simTexel[0], simTexel[1]);
        gl.uniform1f(u.dt, this.dt);
        gl.uniform1f(u.dissipation, this.dissipation);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uSource, 1);
        this._blit(this.velocity.write);
        this.velocity.swap();

        // Advect dye
        u = this._useProgram(this.programs.advection);
        gl.uniform2f(u.texelSize, dyeTexel[0], dyeTexel[1]);
        gl.uniform1f(u.dt, this.dt);
        gl.uniform1f(u.dissipation, 0.97);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.dye.read.texture);
        gl.uniform1i(u.uSource, 1);
        this._blit(this.dye.write);
        this.dye.swap();

        // Divergence
        u = this._useProgram(this.programs.divergence);
        gl.uniform2f(u.texelSize, simTexel[0], simTexel[1]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uVelocity, 0);
        this._blit(this.divergenceFBO);

        // Pressure solve
        u = this._useProgram(this.programs.pressure);
        gl.uniform2f(u.texelSize, simTexel[0], simTexel[1]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.divergenceFBO.texture);
        gl.uniform1i(u.uDivergence, 1);
        for (let i = 0; i < this.pressureIterations; i++) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.texture);
            gl.uniform1i(u.uPressure, 0);
            this._blit(this.pressure.write);
            this.pressure.swap();
        }

        // Gradient subtract
        u = this._useProgram(this.programs.gradientSubtract);
        gl.uniform2f(u.texelSize, simTexel[0], simTexel[1]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.texture);
        gl.uniform1i(u.uPressure, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
        gl.uniform1i(u.uVelocity, 1);
        this._blit(this.velocity.write);
        this.velocity.swap();
    }

    render() {
        const gl = this.gl;

        let u = this._useProgram(this.programs.bloom);
        gl.uniform2f(u.texelSize, 1.0 / this.dyeWidth, 1.0 / this.dyeHeight);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.dye.read.texture);
        gl.uniform1i(u.uTexture, 0);
        this._blit(this.bloomFBO);

        u = this._useProgram(this.programs.display);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.dye.read.texture);
        gl.uniform1i(u.uTexture, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomFBO.texture);
        gl.uniform1i(u.uBloom, 1);
        this._blit(null);
    }
}
