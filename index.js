class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.radius = Math.random() * 3 + 1;
        this.color = color;
        this.life = 1.0;
        this.decay = Math.random() * 0.05 + 0.02;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.vx *= 0.95;
        this.vy *= 0.95;
    }
    draw(ctx) {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class Shard {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 6;
        this.angle = 0;
    }
    update() {
        this.angle += 0.05;
        this.y += Math.sin(this.angle) * 0.2;
    }
    draw(ctx) {
        ctx.fillStyle = '#ff00e5';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ff00e5';
        ctx.beginPath();
        ctx.moveTo(this.x, this.y - 12);
        ctx.lineTo(this.x + 8, this.y);
        ctx.lineTo(this.x, this.y + 12);
        ctx.lineTo(this.x - 8, this.y);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

/**
 * SYNAPSE - Core Game Engine
 * A physics-based tethering game where threads stay in the world.
 */

class SynapseGame {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Game State
        this.running = false;
        this.nodes = [];
        this.threads = [];
        this.particles = [];
        this.shards = [];
        this.platforms = []; // Added for the 'table' platform
        this.score = 0;
        this.combo = 0;
        this.comboTimer = 0;
        this.screenShake = 0;
        this.distanceTravelled = 0;
        this.maxDistance = 0;

        // Camera System
        this.camera = {
            x: 0,
            y: 0,
            targetX: 0,
            lerp: 0.1
        };

        this.player = {
            x: 200,
            y: 300,
            vx: 0,
            vy: 0,
            radius: 8,
            color: '#00f2ff',
            activeTether: null,
            swinging: false,
            dashCooldown: 0,
            trail: [],
            lastSafeNode: null
        };

        // Procedural Gen State
        this.lastGeneratedX = 0;
        this.GEN_DISTANCE = 1200;

        // EASY MODE CONSTANTS
        this.GRAVITY = 0.15; // Lower gravity for slower falling
        this.FRICTION = 0.98;
        this.TETHER_STIFFNESS = 0.22; // Stronger pull
        this.NODE_COUNT = 15; // More nodes per chunk
        this.MOVE_SPEED = 0.9; // Faster keyboard movement (Air control)
        this.MAX_REACH = 600; // Much longer reach

        // Input
        this.mouse = { x: 0, y: 0, down: false };
        this.keys = {};
        this.initInput();

        // Mobile Controls State
        this.joystick = {
            active: false,
            baseX: 0,
            baseY: 0,
            currentX: 0,
            currentY: 0,
            vectorX: 0,
            vectorY: 0,
            maxDist: 60
        };

        // UI
        this.startBtn = document.getElementById('start-btn');
        this.menu = document.getElementById('menu-overlay');
        this.initMobileControls();

        this.startBtn.addEventListener('click', () => this.start());

        const fullScreenBtn = document.getElementById('fullscreen-btn');
        fullScreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
                fullScreenBtn.innerText = 'EXIT FULLSCREEN';
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                    fullScreenBtn.innerText = 'FULLSCREEN';
                }
            }
        });

        requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    initInput() {
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
        });

        window.addEventListener('mousedown', (e) => {
            if (!this.running) return;
            if (e.button === 0) { // Left Click
                this.mouse.down = true;
                this.tryTether();
            } else if (e.button === 2) { // Right Click - Dash
                this.tryDash();
            }
        });

        window.addEventListener('contextmenu', e => e.preventDefault());

        window.addEventListener('mouseup', () => {
            if (this.player.activeTether) {
                this.threads.push({
                    startNode: this.player.activeTether.node,
                    endX: this.player.x,
                    endY: this.player.y,
                    color: 'rgba(0, 242, 255, 0.4)',
                    life: 1.0
                });
                this.createExplosion(this.player.x, this.player.y, '#00f2ff', 5);
            }
            this.mouse.down = false;
            this.player.activeTether = null;
            this.player.swinging = false;
        });

        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space') {
                this.threads = this.threads.slice(-5); // Keep last 5 threads only
                this.createExplosion(this.player.x, this.player.y, '#fff', 20);
                this.screenShake = 10;
                this.updateUI();
            }
        });

        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    }

    initMobileControls() {
        // Joystick
        const joystickZone = document.getElementById('joystick-zone');
        const joystickHandle = document.getElementById('joystick-handle');

        const updateJoystick = (e) => {
            if (!this.joystick.active) return;
            const touch = e.touches[0];
            const dx = touch.clientX - this.joystick.baseX;
            const dy = touch.clientY - this.joystick.baseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const limitedDist = Math.min(dist, this.joystick.maxDist);
            const angle = Math.atan2(dy, dx);

            this.joystick.currentX = Math.cos(angle) * limitedDist;
            this.joystick.currentY = Math.sin(angle) * limitedDist;

            this.joystick.vectorX = this.joystick.currentX / this.joystick.maxDist;
            this.joystick.vectorY = this.joystick.currentY / this.joystick.maxDist;

            joystickHandle.style.transform = `translate(${this.joystick.currentX}px, ${this.joystick.currentY}px)`;
        };

        joystickZone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.joystick.active = true;
            const rect = joystickZone.getBoundingClientRect();
            this.joystick.baseX = rect.left + rect.width / 2;
            this.joystick.baseY = rect.top + rect.height / 2;
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (this.joystick.active) {
                e.preventDefault();
                updateJoystick(e);
            }
        }, { passive: false });

        window.addEventListener('touchend', () => {
            this.joystick.active = false;
            this.joystick.vectorX = 0;
            this.joystick.vectorY = 0;
            joystickHandle.style.transform = `translate(0,0)`;
        });

        // Action Buttons
        document.getElementById('mobile-dash').addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.tryDash();
        });

        document.getElementById('mobile-dissolve').addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.dissolveThreads();
        });

        // Canvas Tethering (Touch)
        this.canvas.addEventListener('touchstart', (e) => {
            if (!this.running || this.joystick.active) return;
            const touch = e.touches[0];
            this.mouse.x = touch.clientX;
            this.mouse.y = touch.clientY;
            this.mouse.down = true;
            this.tryTether();
        }, { passive: true });

        this.canvas.addEventListener('touchmove', (e) => {
            if (!this.running || this.joystick.active) return;
            const touch = e.touches[0];
            this.mouse.x = touch.clientX;
            this.mouse.y = touch.clientY;
        }, { passive: true });

        this.canvas.addEventListener('touchend', () => {
            if (this.player.activeTether) {
                this.threads.push({
                    startNode: this.player.activeTether.node,
                    endX: this.player.x,
                    endY: this.player.y,
                    color: 'rgba(0, 242, 255, 0.4)',
                    life: 1.0
                });
                this.createExplosion(this.player.x, this.player.y, '#00f2ff', 5);
            }
            this.mouse.down = false;
            this.player.activeTether = null;
            this.player.swinging = false;
        });
    }

    dissolveThreads() {
        this.threads = this.threads.slice(-5);
        this.createExplosion(this.player.x, this.player.y, '#fff', 20);
        this.screenShake = 10;
        this.updateUI();
    }

    createExplosion(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(x, y, color));
        }
    }

    tryDash() {
        if (this.player.dashCooldown > 0) return;

        let angle;
        if (this.joystick.active && (Math.abs(this.joystick.vectorX) > 0.1 || Math.abs(this.joystick.vectorY) > 0.1)) {
            angle = Math.atan2(this.joystick.vectorY, this.joystick.vectorX);
        } else {
            // Convert mouse world pos
            const worldMouseX = this.mouse.x + this.camera.x;
            const worldMouseY = this.mouse.y + this.camera.y;
            const dx = worldMouseX - this.player.x;
            const dy = worldMouseY - this.player.y;
            angle = Math.atan2(dy, dx);
        }

        this.player.vx += Math.cos(angle) * 18;
        this.player.vy += Math.sin(angle) * 18;
        this.player.dashCooldown = 20;
        this.screenShake = 6;
        this.createExplosion(this.player.x, this.player.y, '#fff', 15);
    }

    generateChunk(startX) {
        const width = 1200;
        const nodeDensity = 12; // More nodes makes it easier
        for (let i = 0; i < nodeDensity; i++) {
            this.nodes.push({
                x: startX + Math.random() * width,
                y: Math.random() * (this.canvas.height - 250) + 125,
                radius: 14 + Math.random() * 15,
                hue: Math.random() * 60 + 180,
                pulse: 0
            });
        }
        for (let i = 0; i < 5; i++) {
            this.shards.push(new Shard(
                startX + Math.random() * width,
                Math.random() * this.canvas.height
            ));
        }
        // Cleanup old nodes/shards
        if (this.nodes.length > 50) this.nodes.splice(0, 10);
        if (this.shards.length > 30) this.shards.splice(0, 5);
        if (this.threads.length > 40) this.threads.splice(0, 5);
    }

    tryTether() {
        const worldMouseX = this.mouse.x + this.camera.x;
        const worldMouseY = this.mouse.y + this.camera.y;

        let nearestNode = null;
        for (const node of this.nodes) {
            const dx = node.x - worldMouseX;
            const dy = node.y - worldMouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < node.radius + 60) {
                const pDist = Math.sqrt((node.x - this.player.x) ** 2 + (node.y - this.player.y) ** 2);
                if (pDist < this.MAX_REACH) {
                    nearestNode = node;
                    break;
                }
            }
        }

        if (nearestNode) {
            this.player.activeTether = { node: nearestNode, length: Math.sqrt((nearestNode.x - this.player.x) ** 2 + (nearestNode.y - this.player.y) ** 2) * 0.82 };
            this.player.swinging = true;
            this.screenShake = 3;
            this.combo++;
            this.comboTimer = 150;
            this.score += 15 * this.combo;
            this.updateUI();
        }
    }

    start() {
        this.running = true;
        this.menu.style.display = 'none';
        this.score = 0;
        this.combo = 0;
        this.distanceTravelled = 0;
        this.maxDistance = 0;
        this.nodes = [];
        this.shards = [];
        this.threads = [];
        this.platforms = [];
        this.lastGeneratedX = 0;

        // Spawn the "Starting Table"
        this.platforms.push({
            x: 50,
            y: this.canvas.height / 2 + 50,
            width: 300,
            height: 20,
            color: 'rgba(255, 255, 255, 0.15)'
        });

        this.player.x = 200;
        this.player.y = this.canvas.height / 2 - 20;
        this.player.vx = 0;
        this.player.vy = 0;
        this.camera.x = 0;
        this.generateChunk(0);
        this.updateUI();
    }

    update() {
        if (!this.running) return;

        // Player Controls
        if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.joystick.vectorX < -0.3) this.player.vx -= this.MOVE_SPEED;
        if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.joystick.vectorX > 0.3) this.player.vx += this.MOVE_SPEED;
        if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.joystick.vectorY < -0.3) this.player.vy -= this.MOVE_SPEED * 0.5;

        this.player.vy += this.GRAVITY;
        this.player.dashCooldown = Math.max(0, this.player.dashCooldown - 1);

        if (this.player.activeTether) {
            const node = this.player.activeTether.node;
            const dx = this.player.x - node.x;
            const dy = this.player.y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > this.player.activeTether.length) {
                const angle = Math.atan2(dy, dx);
                this.player.vx += (node.x + Math.cos(angle) * this.player.activeTether.length - this.player.x) * this.TETHER_STIFFNESS;
                this.player.vy += (node.y + Math.sin(angle) * this.player.activeTether.length - this.player.y) * this.TETHER_STIFFNESS;
            }
        }

        // Persistent thread collision
        for (const thread of this.threads) {
            this.resolveThreadCollision(thread);
        }

        // Platform collision (The "Table")
        for (const plat of this.platforms) {
            if (this.player.x + this.player.radius > plat.x &&
                this.player.x - this.player.radius < plat.x + plat.width &&
                this.player.y + this.player.radius > plat.y &&
                this.player.y - this.player.radius < plat.y + plat.height) {

                if (this.player.vy > 0 && this.player.y < plat.y + 10) {
                    this.player.y = plat.y - this.player.radius;
                    this.player.vy = 0;
                }
            }
        }

        this.player.vx *= this.FRICTION;
        this.player.vy *= this.FRICTION;
        this.player.x += this.player.vx;
        this.player.y += this.player.vy;

        // Camera follow
        const targetCamX = this.player.x - this.canvas.width * 0.3;
        this.camera.x += (targetCamX - this.camera.x) * this.camera.lerp;

        // Procedural generation
        if (this.player.x + this.GEN_DISTANCE > this.lastGeneratedX) {
            this.generateChunk(this.lastGeneratedX);
            this.lastGeneratedX += 1000;
        }

        // Stats
        this.distanceTravelled = Math.floor(this.player.x / 10);
        if (this.distanceTravelled > this.maxDistance) {
            this.maxDistance = this.distanceTravelled;
            this.updateUI();
        }

        // Trail
        this.player.trail.push({ x: this.player.x, y: this.player.y });
        if (this.player.trail.length > 15) this.player.trail.shift();

        // Shard collection
        this.shards = this.shards.filter(s => {
            const dist = Math.sqrt((s.x - this.player.x) ** 2 + (s.y - this.player.y) ** 2);
            if (dist < 40) {
                this.score += 150 * (this.combo + 1);
                this.createExplosion(s.x, s.y, '#ff00e5', 12);
                this.screenShake = 8;
                this.updateUI();
                return false;
            }
            s.update();
            return true;
        });

        // Combo timer
        if (this.comboTimer > 0) {
            this.comboTimer--;
            if (this.comboTimer === 0) { this.combo = 0; this.updateUI(); }
        }

        // Screen shake decay
        this.screenShake *= 0.9;

        // Particles
        this.particles.forEach(p => p.update());
        this.particles = this.particles.filter(p => p.life > 0);

        // Ground death / reset
        if (this.player.y > this.canvas.height + 400) {
            // Safety Net: If you fall, we just reset you to the top of the screen at your current X
            // but take some score away as a penalty
            this.score = Math.max(0, this.score - 500);
            this.player.y = -100;
            this.player.vy = 0;
            this.player.vx *= 0.5;
            this.screenShake = 15;
            this.combo = 0;
            this.updateUI();
        }
    }

    resolveThreadCollision(thread) {
        // Simple point-to-line segment collision
        const x1 = thread.startNode.x;
        const y1 = thread.startNode.y;
        const x2 = thread.endX;
        const y2 = thread.endY;
        const pX = this.player.x;
        const pY = this.player.y;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((pX - x1) * dx + (pY - y1) * dy) / lenSq));

        const projX = x1 + t * dx;
        const projY = y1 + t * dy;

        const distDx = pX - projX;
        const distDy = pY - projY;
        const dist = Math.sqrt(distDx * distDx + distDy * distDy);

        // If player is falling onto the thread
        if (dist < this.player.radius && this.player.vy > 0) {
            this.player.y = projY - this.player.radius;
            this.player.vy = 0;
            this.player.vx *= 0.95; // Walk friction
        }
    }

    draw() {
        this.ctx.save();
        if (this.screenShake > 0.1) {
            this.ctx.translate((Math.random() - 0.5) * this.screenShake, (Math.random() - 0.5) * this.screenShake);
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply Camera
        this.ctx.translate(-this.camera.x, -this.camera.y);

        // Draw Platforms (The Table)
        for (const plat of this.platforms) {
            this.ctx.fillStyle = plat.color;
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = 'white';
            this.ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
            // Table legs for extra "Table-ness"
            this.ctx.fillRect(plat.x + 10, plat.y + plat.height, 5, 400);
            this.ctx.fillRect(plat.x + plat.width - 15, plat.y + plat.height, 5, 400);
            this.ctx.shadowBlur = 0;
        }

        // Grid Background (Parallax feel)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;
        const startGrid = Math.floor(this.camera.x / 100) * 100;
        for (let x = startGrid; x < startGrid + this.canvas.width + 200; x += 100) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        // Particles
        this.particles.forEach(p => p.draw(this.ctx));
        // Shards
        this.shards.forEach(s => s.draw(this.ctx));

        // Draw Nodes
        for (const node of this.nodes) {
            const glow = this.ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * 2.5);
            glow.addColorStop(0, `hsla(${node.hue}, 100%, 70%, 0.15)`);
            glow.addColorStop(1, 'transparent');
            this.ctx.fillStyle = glow;
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius * 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.fillStyle = `hsl(${node.hue}, 100%, 70%)`;
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = `hsl(${node.hue}, 100%, 70%)`;
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
        }

        // Draw Persistent Threads
        this.ctx.lineWidth = 2;
        for (const thread of this.threads) {
            this.ctx.strokeStyle = thread.color;
            this.ctx.shadowBlur = 8;
            this.ctx.shadowColor = '#00f2ff';
            this.ctx.beginPath();
            this.ctx.moveTo(thread.startNode.x, thread.startNode.y);
            this.ctx.lineTo(thread.endX, thread.endY);
            this.ctx.stroke();
            this.ctx.shadowBlur = 0;
        }

        // Draw Player Trail
        this.ctx.lineWidth = 2;
        for (let i = 0; i < this.player.trail.length - 1; i++) {
            const p1 = this.player.trail[i];
            const p2 = this.player.trail[i + 1];
            const alpha = i / this.player.trail.length;
            this.ctx.strokeStyle = `rgba(0, 242, 255, ${alpha * 0.4})`;
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
        }

        // Draw Active Tether
        if (this.player.activeTether) {
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(this.player.activeTether.node.x, this.player.activeTether.node.y);
            this.ctx.lineTo(this.player.x, this.player.y);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw Player
        this.ctx.fillStyle = this.player.color;
        this.ctx.shadowBlur = 20;
        this.ctx.shadowColor = this.player.color;
        this.ctx.beginPath();
        this.ctx.arc(this.player.x, this.player.y, this.player.radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        this.ctx.restore();
    }

    updateUI() {
        document.getElementById('stat-connections').innerText = this.threads.length;
        document.getElementById('stat-score').innerText = this.score;
        document.getElementById('stat-combo').innerText = 'x' + this.combo;
        document.getElementById('stat-combo').style.opacity = this.combo > 0 ? 1 : 0;
        document.getElementById('stat-distance').innerText = this.maxDistance + 'm';
    }

    loop(time) {
        this.update();
        this.draw();
        requestAnimationFrame((t) => this.loop(t));
    }
}

// Start the game
window.onload = () => {
    new SynapseGame();
};
