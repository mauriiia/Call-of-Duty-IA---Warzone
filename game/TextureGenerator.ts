
import * as THREE from 'three';

export class TextureGenerator {
  
  // Helper to create context
  private static createContext(size: number): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Optimize for readback
    if (!ctx) throw new Error("Failed to create canvas context");
    return ctx;
  }

  // --- 0. HEIGHTMAP DATA TEXTURE (For Water Depth) ---
  public static createHeightBuffer(size: number, mapSize: number, heightFunc: (x: number, z: number) => number): THREE.DataTexture {
    const data = new Uint8Array(size * size);
    
    for (let j = 0; j < size; j++) { 
        for (let i = 0; i < size; i++) { 
            const x = (i / size) * mapSize - (mapSize / 2);
            const z = (j / size) * mapSize - (mapSize / 2); 
            const h = heightFunc(x, z);
            const val = Math.min(255, Math.max(0, Math.floor(h + 50)));
            const idx = (j * size) + i; 
            data[idx] = val;
        }
    }
    
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  // --- 1. TERRAIN DETAIL (Noise/Grit) ---
  public static createTerrainDetail(size: number = 512): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      
      // 1. Base: White
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);

      // 2. High Frequency Noise (Grit)
      const imgData = ctx.getImageData(0, 0, size, size);
      const data = imgData.data;
      const len = data.length;

      for (let i = 0; i < len; i += 4) {
          const noise = Math.random() * 30; // Reduced intensity
          const val = 225 + noise; // Kept very bright
          data[i] = val;
          data[i+1] = val;
          data[i+2] = val;
          data[i+3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      
      // 3. Organic Spots (Optimized)
      ctx.fillStyle = 'rgba(100, 90, 80, 0.15)'; 
      const spots = size * 1.5;
      for(let i=0; i<spots; i++) {
          const x = Math.random() * size;
          const y = Math.random() * size;
          const r = Math.random() * 2 + 1;
          
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
      }

      const tex = new THREE.CanvasTexture(ctx.canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      // tex.anisotropy = 16; // Let engine handle anisotropy globally
      return tex;
  }

  // --- 2. TERRAIN NORMAL MAP ---
  public static createTerrainNormal(size: number = 512): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      
      ctx.fillStyle = 'rgb(128, 128, 255)';
      ctx.fillRect(0, 0, size, size);

      const imgData = ctx.getImageData(0, 0, size, size);
      const data = imgData.data;
      const len = data.length;

      for (let i = 0; i < len; i += 4) {
          const noiseX = (Math.random() - 0.5) * 20; 
          const noiseY = (Math.random() - 0.5) * 20;
          
          data[i] = Math.min(255, Math.max(0, 128 + noiseX));
          data[i+1] = Math.min(255, Math.max(0, 128 + noiseY));
          data[i+2] = 255; 
          data[i+3] = 255;
      }
      
      ctx.putImageData(imgData, 0, 0);

      const tex = new THREE.CanvasTexture(ctx.canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
  }

  // --- 3. BRICKS ---
  public static createBricks(size: number = 256): THREE.CanvasTexture {
    const ctx = this.createContext(size);
    ctx.fillStyle = '#b0b0b0'; 
    ctx.fillRect(0, 0, size, size);

    const rows = 8;
    const cols = 4;
    const brickH = size / rows;
    const brickW = size / cols;
    const mortarSize = 2;
    
    for(let r=0; r<rows; r++) {
        const offset = (r % 2 === 0) ? 0 : brickW / 2;
        for(let c=-1; c<=cols; c++) {
            const x = (c * brickW) + offset;
            const y = r * brickH;
            
            const hueVar = (Math.random() - 0.5) * 10;
            const satVar = (Math.random() - 0.5) * 10;
            const lightVar = (Math.random() - 0.5) * 15;

            ctx.fillStyle = `hsl(${15 + hueVar}, ${40 + satVar}%, ${45 + lightVar}%)`;
            
            ctx.fillRect(x + mortarSize/2, y + mortarSize/2, brickW - mortarSize, brickH - mortarSize);
        }
    }

    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1); 
    return tex;
  }

  // --- 4. CAUTION ---
  public static createCaution(size: number = 128): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      ctx.fillStyle = '#fdbf2d'; 
      ctx.fillRect(0,0,size,size);
      ctx.fillStyle = '#111111';
      const stripeW = 20;
      
      ctx.translate(size/2, size/2);
      ctx.rotate(-Math.PI / 4);
      ctx.translate(-size, -size);

      for(let i=0; i<size*3; i+=stripeW*2) {
          ctx.fillRect(i, 0, stripeW, size*3);
      }

      const tex = new THREE.CanvasTexture(ctx.canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
  }
  
  // --- 5. DUST ---
  public static createDust(size: number = 64): THREE.CanvasTexture {
    const ctx = this.createContext(size);
    ctx.clearRect(0,0,size,size);
    const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,size,size);
    return new THREE.CanvasTexture(ctx.canvas);
  }

  // --- 6. BLOOD SPLAT (NOVA) ---
  public static createBloodTexture(size: number = 64): THREE.CanvasTexture {
    const ctx = this.createContext(size);
    ctx.clearRect(0,0,size,size);
    
    // Irregular blob
    const cx = size/2, cy = size/2;
    ctx.fillStyle = 'white';
    
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.4, 0, Math.PI*2);
    ctx.fill();
    
    // Add randomness for splat effect
    for(let i=0; i<5; i++) {
        ctx.beginPath();
        const r = size * 0.2 * Math.random();
        const a = Math.random() * Math.PI * 2;
        const dist = size * 0.2 + Math.random() * size * 0.2;
        ctx.arc(cx + Math.cos(a)*dist, cy + Math.sin(a)*dist, r, 0, Math.PI*2);
        ctx.fill();
    }

    const tex = new THREE.CanvasTexture(ctx.canvas);
    return tex;
  }

  // --- 7. CLOUD NOISE (BALANCED) ---
  public static createCloudNoise(size: number = 512): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      
      // Black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      // Accumulative additive blending
      ctx.globalCompositeOperation = 'lighter';

      const drawPuff = (x: number, y: number, r: number, op: number) => {
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, `rgba(255, 255, 255, ${op})`);
          grad.addColorStop(1, `rgba(0, 0, 0, 0)`);
          
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
      };

      const drawSeamless = (x: number, y: number, r: number, op: number) => {
          drawPuff(x, y, r, op);
          if (x < r) drawPuff(x + size, y, r, op);
          if (x > size - r) drawPuff(x - size, y, r, op);
          if (y < r) drawPuff(x, y + size, r, op);
          if (y > size - r) drawPuff(x, y - size, r, op);
      };

      for(let i=0; i<60; i++) {
          const r = size * (0.15 + Math.random() * 0.1);
          drawSeamless(Math.random() * size, Math.random() * size, r, 0.12);
      }
      for(let i=0; i<150; i++) {
          const r = size * (0.08 + Math.random() * 0.08);
          drawSeamless(Math.random() * size, Math.random() * size, r, 0.08); 
      }
      for(let i=0; i<300; i++) {
          const r = size * (0.02 + Math.random() * 0.04);
          drawSeamless(Math.random() * size, Math.random() * size, r, 0.06);
      }

      const tex = new THREE.CanvasTexture(ctx.canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipMapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
  }

  // --- 8. GRASS ---
  public static createGrass(size: number = 256): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      ctx.clearRect(0,0,size,size);
      const blades = 8;
      for(let i=0; i<blades; i++) {
          const x = Math.random() * size;
          const w = 15 + Math.random() * 15;
          const h = size * (0.6 + Math.random() * 0.4);
          ctx.beginPath();
          ctx.moveTo(x - w/2, size);
          ctx.quadraticCurveTo(x, size/2, x + (Math.random()-0.5)*40, size - h);
          ctx.quadraticCurveTo(x, size/2, x + w/2, size);
          const grad = ctx.createLinearGradient(x, size-h, x, size);
          grad.addColorStop(0, '#aaff66'); grad.addColorStop(1, '#006600');
          ctx.fillStyle = grad;
          ctx.fill();
      }
      return new THREE.CanvasTexture(ctx.canvas);
  }

  // --- 9. HIGH QUALITY WATER NORMAL MAP ---
  public static createWaterNormal(size: number = 512): THREE.CanvasTexture {
      // Step 1: Create a Height Map (White noise clouds)
      const heightCanvas = document.createElement('canvas');
      heightCanvas.width = size;
      heightCanvas.height = size;
      const hCtx = heightCanvas.getContext('2d', { willReadFrequently: true });
      if (!hCtx) throw new Error("Canvas");

      // Fill Black
      hCtx.fillStyle = '#000000';
      hCtx.fillRect(0,0,size,size);
      
      // Draw Soft "Waves" (Circles)
      const drawWave = (x: number, y: number, r: number) => {
          const g = hCtx.createRadialGradient(x,y,0,x,y,r);
          g.addColorStop(0, 'rgba(255,255,255,0.2)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          hCtx.fillStyle = g;
          hCtx.beginPath(); hCtx.arc(x,y,r,0,Math.PI*2); hCtx.fill();
      };

      const drawSeamless = (x: number, y: number, r: number) => {
          drawWave(x,y,r);
          if (x<r) drawWave(x+size,y,r);
          if (x>size-r) drawWave(x-size,y,r);
          if (y<r) drawWave(x,y+size,r);
          if (y>size-r) drawWave(x,y-size,r);
      };

      for(let i=0; i<150; i++) {
          drawSeamless(Math.random()*size, Math.random()*size, 20 + Math.random()*40);
      }

      // Step 2: Convert Height Map to Normal Map (Sobel-ish filter)
      const hData = hCtx.getImageData(0,0,size,size).data;
      
      const normalCanvas = document.createElement('canvas');
      normalCanvas.width = size;
      normalCanvas.height = size;
      const nCtx = normalCanvas.getContext('2d');
      if (!nCtx) throw new Error("Canvas");
      const nImg = nCtx.createImageData(size, size);
      const nData = nImg.data;

      const getH = (x: number, y: number) => {
          // Handle wrapping
          const wx = (x + size) % size;
          const wy = (y + size) % size;
          return hData[(wy * size + wx) * 4] / 255.0;
      };

      for(let y=0; y<size; y++) {
          for(let x=0; x<size; x++) {
              // Sobel kernels
              const tl = getH(x-1, y-1); const t = getH(x, y-1); const tr = getH(x+1, y-1);
              const l = getH(x-1, y); const r = getH(x+1, y);
              const bl = getH(x-1, y+1); const b = getH(x, y+1); const br = getH(x+1, y+1);

              const dx = (tr + 2*r + br) - (tl + 2*l + bl);
              const dy = (bl + 2*b + br) - (tl + 2*t + tr);
              const dz = 1.0 / 3.0; // Strength

              const v = new THREE.Vector3(-dx, -dy, dz).normalize();
              
              const idx = (y*size + x) * 4;
              nData[idx] = (v.x * 0.5 + 0.5) * 255;   // R
              nData[idx+1] = (v.y * 0.5 + 0.5) * 255; // G
              nData[idx+2] = (v.z * 0.5 + 0.5) * 255; // B
              nData[idx+3] = 255; // Alpha
          }
      }
      
      nCtx.putImageData(nImg, 0, 0);
      const tex = new THREE.CanvasTexture(normalCanvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
  }

  // --- LENS FLARE ASSETS ---
  public static createLensGlow(size: number = 128): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      ctx.clearRect(0,0,size,size);
      const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      grad.addColorStop(0, 'rgba(255, 255, 240, 1.0)'); 
      grad.addColorStop(1, 'rgba(255, 200, 150, 0.0)'); 
      ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
      return new THREE.CanvasTexture(ctx.canvas);
  }

  public static createLensHex(size: number = 128): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      ctx.clearRect(0,0,size,size);
      const cx = size/2; const cy = size/2; const r = size * 0.4;
      ctx.beginPath();
      for(let i=0; i<6; i++) {
          const a = (Math.PI / 3) * i;
          if(i===0) ctx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
          else ctx.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; ctx.lineWidth = 2; ctx.stroke();
      return new THREE.CanvasTexture(ctx.canvas);
  }

  public static createLensRing(size: number = 128): THREE.CanvasTexture {
      const ctx = this.createContext(size);
      ctx.clearRect(0,0,size,size);
      ctx.beginPath();
      ctx.arc(size/2, size/2, size*0.4, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.lineWidth = size * 0.05; ctx.stroke();
      return new THREE.CanvasTexture(ctx.canvas);
  }
  
  public static createAsphalt(size: number = 256): THREE.CanvasTexture { return this.createTerrainDetail(size); }
  public static createConcrete(size: number = 256): THREE.CanvasTexture { return this.createTerrainDetail(size); }
}
