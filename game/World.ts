
import * as THREE from 'three';
import { PhysicsWorld } from './PhysicsWorld';
import { MapGenerator } from './MapGenerator';
import { GameMode } from '../types';

export class World {
  public scene: THREE.Scene;
  public mapGenerator: MapGenerator; 
  
  constructor(physics: PhysicsWorld) {
    this.scene = new THREE.Scene();
    this.mapGenerator = new MapGenerator(this.scene, physics);
    // Initial generation default
    this.mapGenerator.generate();
  }

  public regenerate(mode: GameMode, editorType?: 'NEW' | 'EXISTING') {
      if (mode === 'EDITOR') {
          if (editorType === 'NEW') {
              this.mapGenerator.generateBlank();
          } else {
              this.mapGenerator.generate();
          }
      } 
      else if (mode === 'TRAINING') {
          this.mapGenerator.generateTraining();
      }
      else {
          this.mapGenerator.generate();
      }
  }

  public setWaterQuality(isHigh: boolean) {
      if (this.mapGenerator) {
          this.mapGenerator.setWaterQuality(isHigh);
      }
  }

  public update(dt: number, renderer: THREE.WebGLRenderer, playerPos: THREE.Vector3) {
     if (this.mapGenerator) {
         this.mapGenerator.update(dt, renderer);
     }
  }
}
