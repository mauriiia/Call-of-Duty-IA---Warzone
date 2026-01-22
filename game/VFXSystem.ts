
import * as THREE from 'three';

interface Bullet {
    mesh: THREE.Mesh;
    // Light removed for performance
    velocity: THREE.Vector3;
    target: THREE.Vector3;
    distanceTraveled: number;
    totalDistance: number;
    active: boolean;
}

export class VFXSystem {
    private scene: THREE.Scene;
    private bulletHoleTexture: THREE.Texture;
    
    // Bullet System
    private bullets: Bullet[] = [];
    private bulletGeo: THREE.BufferGeometry;
    private bulletMat: THREE.MeshBasicMaterial;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.bulletHoleTexture = this.createProceduralHoleTexture();

        // VISIBILITY UPGRADE: Use a Sphere (Glowing Orb) instead of a thin cylinder
        this.bulletGeo = new THREE.SphereGeometry(0.08, 8, 8);
        
        this.bulletMat = new THREE.MeshBasicMaterial({ 
            color: 0xffdd44, // Golden/Yellow Tracer
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            toneMapped: false // Critical for Bloom glow
        });
    }

    public update(dt: number) {
        const bulletSpeed = 200; // Slower speed to make it easier to see (was 300)

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            if (!b.active) continue;

            const moveDist = bulletSpeed * dt;
            const step = b.velocity.clone().multiplyScalar(moveDist);
            
            b.mesh.position.add(step);
            b.distanceTraveled += moveDist;

            // Check if reached target or max range
            if (b.distanceTraveled >= b.totalDistance) {
                this.removeBullet(i);
            }
        }
    }

    public createProjectile(start: THREE.Vector3, end: THREE.Vector3, color: number = 0xffdd44, scale: number = 1.0) {
        let mat = this.bulletMat;
        if (color !== 0xffdd44) {
            mat = this.bulletMat.clone();
            mat.color.setHex(color);
        }

        const mesh = new THREE.Mesh(this.bulletGeo, mat);
        mesh.name = "Projectile"; 
        
        // --- VISIBILITY FIX ---
        mesh.layers.enableAll();    
        mesh.frustumCulled = false; 
        // ---------------------

        mesh.position.copy(start);
        mesh.lookAt(end);
        
        // Stretch the sphere slightly to look like a slug
        mesh.scale.set(scale, scale, scale * 2.0); 
        
        // PERFORMANCE FIX: Removed PointLight attachment. 
        // Adding dynamic lights per bullet causes massive shader recompilation stutter.
        // Bloom handles the glow via toneMapped: false material.

        this.scene.add(mesh);

        const direction = new THREE.Vector3().subVectors(end, start);
        const totalDistance = direction.length();
        direction.normalize();

        this.bullets.push({
            mesh,
            velocity: direction,
            target: end,
            distanceTraveled: 0,
            totalDistance: totalDistance,
            active: true
        });
    }

    private removeBullet(index: number) {
        const b = this.bullets[index];
        b.active = false;
        this.scene.remove(b.mesh);
        
        if (b.mesh.material !== this.bulletMat) {
            (b.mesh.material as THREE.Material).dispose();
        }
        
        this.bullets.splice(index, 1);
    }

    private createProceduralHoleTexture(): THREE.Texture {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.beginPath();
            ctx.arc(32, 32, 10, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
            
            const gradient = ctx.createRadialGradient(32, 32, 10, 32, 32, 25);
            gradient.addColorStop(0, 'rgba(20, 20, 20, 0.8)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    public createBulletHole(position: THREE.Vector3, normal: THREE.Vector3) {
        const geometry = new THREE.PlaneGeometry(0.15, 0.15);
        const material = new THREE.MeshBasicMaterial({ 
            map: this.bulletHoleTexture, 
            transparent: true,
            depthWrite: false, 
            polygonOffset: true,
            polygonOffsetFactor: -4
        });

        const hole = new THREE.Mesh(geometry, material);
        hole.position.copy(position).add(normal.clone().multiplyScalar(0.02));
        hole.lookAt(position.clone().add(normal));

        this.scene.add(hole);

        setTimeout(() => {
            this.scene.remove(hole);
            geometry.dispose();
            material.dispose();
        }, 10000);
    }

    public createBloodEffect(position: THREE.Vector3) {
        const particleCount = 8;
        const color = 0xcc0000; 

        for (let i = 0; i < particleCount; i++) {
            const size = 0.05 + Math.random() * 0.05;
            const geometry = new THREE.BoxGeometry(size, size, size);
            const material = new THREE.MeshBasicMaterial({ color: color });
            const particle = new THREE.Mesh(geometry, material);
            particle.position.copy(position);
            
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.2) * 0.5 + 0.2, 
                (Math.random() - 0.5) * 0.5
            );

            this.scene.add(particle);
            this.animateParticle(particle, velocity);
        }
    }

    public createTracer(start: THREE.Vector3, end: THREE.Vector3, color: number = 0xffffaa) {
        this.createProjectile(start, end, color);
    }

    private animateParticle(mesh: THREE.Mesh, velocity: THREE.Vector3) {
        let life = 1.0;
        const update = () => {
            life -= 0.05; 
            if (life <= 0) {
                this.scene.remove(mesh);
                return;
            }
            velocity.y -= 0.02; 
            mesh.position.add(velocity);
            mesh.rotation.x += 0.1;
            mesh.rotation.z += 0.1;
            mesh.scale.setScalar(life);
            requestAnimationFrame(update);
        };
        update();
    }
    
    public createImpactSparks(position: THREE.Vector3, normal: THREE.Vector3) {
        const particleCount = 5;
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.BoxGeometry(0.03, 0.03, 0.1);
            const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
            const spark = new THREE.Mesh(geometry, material);
            
            spark.position.copy(position);
            spark.lookAt(position.clone().add(normal)); 
            
            const velocity = normal.clone().multiplyScalar(0.2).add(
                 new THREE.Vector3((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2)
            );

            this.scene.add(spark);
            this.animateParticle(spark, velocity);
        }
    }
}
