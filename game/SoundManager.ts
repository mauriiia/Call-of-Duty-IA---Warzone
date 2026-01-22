
import * as THREE from 'three';

export type SoundType = 'RIFLE' | 'PISTOL' | 'SHOTGUN' | 'SNIPER' | 'GRENADE_LAUNCH' | 'EXPLOSION';
export type MaterialType = 'CONCRETE' | 'METAL' | 'FLESH' | 'DIRT';

export class SoundManager {
  private static instance: SoundManager;
  private ctx: AudioContext;
  private masterGain: GainNode;
  private listener: THREE.Object3D | null = null;
  
  private lastSoundTimes: Record<string, number> = {};
  private noiseBuffer: AudioBuffer;

  // --- PLANE AUDIO ---
  private planeAudio: HTMLAudioElement | null = null;
  
  // --- WIND AUDIO ---
  private windNode: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private usingProceduralWind: boolean = true; 

  // Helpers
  private _vec3 = new THREE.Vector3();
  private _camRight = new THREE.Vector3();

  private constructor() {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
    
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5; 

    this.masterGain.connect(compressor);
    compressor.connect(this.ctx.destination);

    this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
  }

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public setListener(object: THREE.Object3D) {
      this.listener = object;
  }

  public async resumeContext() {
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        console.warn("Audio resume failed", e);
      }
    }
  }

  // --- PLANE SOUND SYSTEM ---
  public preloadPlaneSound(url: string) {
      const el = document.getElementById('plane-audio') as HTMLAudioElement;
      if (el) {
          el.src = url;
          el.volume = 0;
          el.play().then(() => {
              console.log("[Sound] Plane audio unlocked");
          }).catch(e => console.warn("Plane audio blocked:", e));
      }
  }

  public startPlaneSound() {
      const el = document.getElementById('plane-audio') as HTMLAudioElement;
      if (el && el.paused) {
          el.play().catch(() => {});
      }
  }

  public setPlaneVolume(volume: number) {
      const el = document.getElementById('plane-audio') as HTMLAudioElement;
      if (el) el.volume = Math.max(0, Math.min(1, volume));
  }

  public stopPlaneSound() {
      const el = document.getElementById('plane-audio') as HTMLAudioElement;
      if (el) {
          el.pause();
          el.currentTime = 0;
      }
  }

  // --- WIND SOUND SYSTEM ---
  public preloadWindSound(url: string) {
      const el = document.getElementById('wind-audio') as HTMLAudioElement;
      if (el) {
          if (url && !url.includes("placeholder")) {
              this.usingProceduralWind = false;
              el.src = url;
              el.volume = 0;
              el.play().then(() => {
                  console.log("[Sound] Wind audio unlocked (File)");
              }).catch(() => {
                  console.warn("[Sound] Wind file failed, fallback to procedural");
                  this.usingProceduralWind = true;
              });
          } else {
              this.usingProceduralWind = true;
          }
      }
  }

  public startWind() {
      if (this.usingProceduralWind) {
          if (!this.windNode) {
              const src = this.ctx.createBufferSource();
              src.buffer = this.noiseBuffer;
              src.loop = true;
              const filter = this.ctx.createBiquadFilter();
              filter.type = 'lowpass';
              filter.frequency.value = 400; 
              this.windGain = this.ctx.createGain();
              this.windGain.gain.value = 0;
              src.connect(filter);
              filter.connect(this.windGain);
              this.windGain.connect(this.masterGain);
              src.start();
              this.windNode = src;
              (this.windNode as any)._filter = filter;
          }
      } else {
          const el = document.getElementById('wind-audio') as HTMLAudioElement;
          if (el && el.paused) {
              el.play().catch(() => {});
          }
      }
  }

  public updateWind(intensity: number) {
      const clampInt = Math.max(0, Math.min(1, intensity));
      if (this.usingProceduralWind) {
          if (this.windNode && this.windGain) {
              const targetVol = 0.1 + (clampInt * 0.8); 
              this.windGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.1);
              const filter = (this.windNode as any)._filter as BiquadFilterNode;
              if (filter) {
                  const targetFreq = 200 + (clampInt * 1000);
                  filter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
              }
          }
      } else {
          const el = document.getElementById('wind-audio') as HTMLAudioElement;
          if (el) {
              el.volume = 0.2 + (clampInt * 0.8);
          }
      }
  }

  public stopWind() {
      if (this.usingProceduralWind) {
          if (this.windGain) {
              this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
              setTimeout(() => {
                  if (this.windNode) {
                      this.windNode.stop();
                      this.windNode.disconnect();
                      this.windNode = null;
                  }
              }, 300);
          }
      } else {
          const el = document.getElementById('wind-audio') as HTMLAudioElement;
          if (el) {
              const fade = setInterval(() => {
                  if (el.volume > 0.05) el.volume -= 0.05;
                  else {
                      el.pause();
                      el.currentTime = 0;
                      clearInterval(fade);
                  }
              }, 50);
          }
      }
  }

  public playVoice(text: string, priority: boolean = false) {
      // Voice functionality placeholder
  }

  private canPlaySound(key: string, cooldownMs: number): boolean {
      const now = performance.now();
      const last = this.lastSoundTimes[key] || 0;
      if (now - last > cooldownMs) {
          this.lastSoundTimes[key] = now;
          return true;
      }
      return false;
  }

  public playUiClick() {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.canPlaySound('ui_click', 50)) return;

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
      
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.start(t);
      osc.stop(t + 0.08);

      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 3000; 
      const noiseGain = this.ctx.createGain();
      
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.masterGain);

      noiseGain.gain.setValueAtTime(0.15, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      
      noise.start(t);
      noise.stop(t + 0.05);
  }

  public playHitMarker(isHeadshot: boolean) {
      if (!this.canPlaySound('hitmarker', 80)) return;

      const t = this.ctx.currentTime;
      const gain = this.ctx.createGain();
      gain.connect(this.masterGain);

      const osc = this.ctx.createOscillator();
      osc.type = isHeadshot ? 'triangle' : 'sine'; 
      
      const freqStart = isHeadshot ? 2000 : 800;
      const freqEnd = isHeadshot ? 1000 : 200;

      osc.frequency.setValueAtTime(freqStart, t);
      osc.frequency.exponentialRampToValueAtTime(freqEnd, t + 0.1);
      
      gain.gain.setValueAtTime(isHeadshot ? 0.4 : 0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 0.1);
  }

  // --- SPATIAL AUDIO GUNSHOT SYSTEM ---
  public playGunshot(type: SoundType, position?: THREE.Vector3) {
      // 1. Calculate Distance & Spatial Props
      let distance = 0;
      let pan = 0;
      let filterFreq = 22000; // Full brightness
      let volume = 1.0;

      if (position && this.listener) {
          // It's a remote shot (Enemy)
          const listenerPos = this.listener.getWorldPosition(this._vec3);
          distance = position.distanceTo(listenerPos);

          // Cull sound if too far (Optimization)
          if (distance > 150) return;

          // Inverse Distance Falloff (Realistic)
          // refDist = 10, maxDist = 150
          // vol = ref / (ref + dist)
          volume = 15 / (10 + distance);
          
          // LowPass Filter based on distance (Air Absorption)
          // 0m = 22000Hz, 100m = 500Hz
          filterFreq = THREE.MathUtils.lerp(18000, 400, Math.min(1, distance / 100));

          // Stereo Panning
          this._camRight.set(1, 0, 0).applyQuaternion(this.listener.quaternion);
          const dirToSource = position.clone().sub(listenerPos).normalize();
          pan = dirToSource.dot(this._camRight); // -1 (Left) to 1 (Right)

          // Reduce priority/volume of bot shots slightly more
          volume *= 0.8; 

      } else {
          // It's the Player shooting (Local)
          volume = 0.6; // Not too loud for user
      }

      if (!this.canPlaySound(`gun_${type}_${distance < 5 ? 'near' : 'far'}`, 90)) return;

      const t = this.ctx.currentTime;
      const rnd = Math.random() * 0.1 - 0.05; 

      // Define Gun Characteristics
      let punchFreq = 150;
      let punchDecay = 0.2;
      let noiseFilterFreq = 1200;
      let noiseDuration = 0.3;
      let mechVol = 0.1;
      
      switch (type) {
          case 'SNIPER':
              punchFreq = 80; punchDecay = 0.6; noiseFilterFreq = 800; noiseDuration = 0.8; mechVol = 0.05;
              break;
          case 'SHOTGUN':
              punchFreq = 100; punchDecay = 0.3; noiseFilterFreq = 600; noiseDuration = 0.4; mechVol = 0.2; 
              break;
          case 'RIFLE':
              punchFreq = 200; punchDecay = 0.15; noiseFilterFreq = 2500; noiseDuration = 0.25; mechVol = 0.15;
              break;
          case 'PISTOL':
              punchFreq = 350; punchDecay = 0.1; noiseFilterFreq = 3000; noiseDuration = 0.15; mechVol = 0.2;
              break;
      }

      // Chain: Sources -> SpatialNode -> Master
      const spatialChainStart = this.ctx.createGain(); // Local mix bus
      
      // Setup Spatial Nodes
      if (position) {
          // Stereo Panner (Web Audio API)
          const panner = this.ctx.createStereoPanner();
          panner.pan.value = pan;
          
          // Distance Filter (LowPass)
          const distFilter = this.ctx.createBiquadFilter();
          distFilter.type = 'lowpass';
          distFilter.frequency.value = filterFreq;

          // Connect Chain
          spatialChainStart.connect(distFilter);
          distFilter.connect(panner);
          panner.connect(this.masterGain);
      } else {
          // Direct connection for player
          spatialChainStart.connect(this.masterGain);
      }
      
      // Apply Calculated Volume
      spatialChainStart.gain.value = volume;

      // --- SYNTHESIS ---

      // 1. The "Punch" (Sine Body)
      const punchOsc = this.ctx.createOscillator();
      const punchGain = this.ctx.createGain();
      punchOsc.type = 'sine'; 
      punchOsc.frequency.setValueAtTime(punchFreq, t);
      punchOsc.frequency.exponentialRampToValueAtTime(40, t + punchDecay);
      
      punchGain.gain.setValueAtTime(1.0, t);
      punchGain.gain.exponentialRampToValueAtTime(0.001, t + punchDecay);
      
      punchOsc.connect(punchGain);
      punchGain.connect(spatialChainStart);
      punchOsc.start(t);
      punchOsc.stop(t + punchDecay);

      // 2. The "Crack" (Noise)
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = this.noiseBuffer;
      const randomOffset = Math.random() * (this.noiseBuffer.duration - 1.0); 
      
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(Math.min(noiseFilterFreq, filterFreq), t); // Clamp by distance filter
      noiseFilter.frequency.linearRampToValueAtTime(100, t + noiseDuration); 

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.8, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + noiseDuration);

      noiseSource.playbackRate.value = 1.0 + rnd; 

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(spatialChainStart);
      
      noiseSource.start(t, randomOffset, noiseDuration);

      // 3. The "Mech" (Only hear close up)
      if (distance < 15) {
          const mechOsc = this.ctx.createOscillator();
          const mechGain = this.ctx.createGain();
          mechOsc.type = 'square'; 
          mechOsc.frequency.setValueAtTime(800, t);
          mechOsc.frequency.exponentialRampToValueAtTime(2000, t + 0.03); 
          
          mechGain.gain.setValueAtTime(mechVol, t);
          mechGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

          const highPass = this.ctx.createBiquadFilter();
          highPass.type = 'highpass';
          highPass.frequency.value = 2000;

          mechOsc.connect(highPass);
          highPass.connect(mechGain);
          mechGain.connect(spatialChainStart);
          mechOsc.start(t);
          mechOsc.stop(t + 0.05);
      }
  }

  public playImpact(material: MaterialType) {
      if (!this.canPlaySound(`impact_${material}`, 100)) return;

      const t = this.ctx.currentTime;
      const gain = this.ctx.createGain();
      gain.connect(this.masterGain);

      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      
      noise.connect(filter);
      filter.connect(gain);

      if (material === 'METAL') {
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(3000 + Math.random()*500, t);
          filter.Q.value = 10;
          
          gain.gain.setValueAtTime(0.3, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
          noise.start(t, Math.random(), 0.4);

          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1200, t);
          osc.frequency.exponentialRampToValueAtTime(800, t + 0.2);
          const oscGain = this.ctx.createGain();
          oscGain.gain.setValueAtTime(0.2, t);
          oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          osc.connect(oscGain);
          oscGain.connect(this.masterGain);
          osc.start(t); osc.stop(t+0.2);

      } else if (material === 'FLESH') {
          filter.type = 'lowpass';
          filter.frequency.value = 600;
          
          gain.gain.setValueAtTime(0.5, t);
          gain.gain.linearRampToValueAtTime(0.001, t + 0.15);
          noise.start(t, Math.random(), 0.15);

      } else {
          filter.type = 'highpass';
          filter.frequency.value = 200;
          
          gain.gain.setValueAtTime(0.4, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
          noise.start(t, Math.random(), 0.1);
      }
  }

  public playFootstep(isRunning: boolean) {
      if (!this.canPlaySound('footstep', isRunning ? 280 : 380)) return;

      const t = this.ctx.currentTime;
      const duration = isRunning ? 0.12 : 0.18;
      const volume = isRunning ? 0.35 : 0.15;

      const thud = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(isRunning ? 80 : 60, t);
      thud.frequency.exponentialRampToValueAtTime(20, t + 0.05);
      
      thudGain.gain.setValueAtTime(volume * 0.8, t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      
      thud.connect(thudGain);
      thudGain.connect(this.masterGain);
      thud.start(t);
      thud.stop(t + 0.05);

      const crunch = this.ctx.createBufferSource();
      crunch.buffer = this.noiseBuffer;
      const offset = Math.random() * (this.noiseBuffer.duration - 0.2);
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = isRunning ? 1200 : 800; 
      filter.Q.value = 1.0;

      const crunchGain = this.ctx.createGain();
      crunchGain.gain.setValueAtTime(volume, t);
      crunchGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      crunch.connect(filter);
      filter.connect(crunchGain);
      crunchGain.connect(this.masterGain);
      
      crunch.start(t, offset, duration);
  }

  public playVault() {
      if (!this.canPlaySound('vault', 1000)) return;
      const t = this.ctx.currentTime;
      
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(200, t);
      filter.frequency.linearRampToValueAtTime(600, t + 0.1); 

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.1);
      gain.gain.linearRampToValueAtTime(0.0, t + 0.3);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start(t, 0, 0.3);
  }
}
