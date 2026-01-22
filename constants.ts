
import { GameConfig } from './types';

export const CONFIG: GameConfig = {
  fov: 75,
  mouseSensitivity: 0.0010,
  physicsStep: 1 / 60,
  gravity: -9.82
};

export const WATER_LEVEL = 5.0;

export const PHYSICS_MATERIALS = {
  ground: { friction: 0.8, restitution: 0.1 },
  player: { friction: 0.0, restitution: 0.0 }, 
  object: { friction: 0.5, restitution: 0.2 }
};

export const TIER_COLORS = {
    COMMON: 0xcccccc,    // Gray
    UNCOMMON: 0x00ff00,  // Green
    RARE: 0xa020f0,      // Purple
    LEGENDARY: 0xffd700  // Gold
};

export const WEAPON_OFFSET = {
  x: 0.3,
  y: -0.25,
  z: -0.5
};

export const MOVEMENT = {
    WALK_SPEED: 3.5,
    SPRINT_SPEED: 7.0,
    CROUCH_SPEED: 2.0,
    SLIDE_INITIAL_SPEED: 12.0, 
    SLIDE_DURATION: 0.8, 
    SLIDE_COOLDOWN: 1.0,
    
    LEAN_ANGLE: 0.35, 
    LEAN_OFFSET: 0.4, 
    VAULT_DIST: 1.5, 
    VAULT_IMPULSE_Y: 6.5,
    VAULT_IMPULSE_FWD: 8.0,
    
    HEIGHT_STAND: 0.6,
    HEIGHT_CROUCH: -0.4,
    
    DAMPING_GROUND: 0.95, 
    DAMPING_SLIDE: 0.2,   
    DAMPING_AIR: 0.1
};

export const COLORS = {
  fog: 0xcccccc, 
  skyTop: 0x8899aa, 
  skyBottom: 0xcccccc,
  ground: 0x222222,
  barrier: 0x999999,
  containerRed: 0x8b3a3a,
  containerBlue: 0x3a4a8b,
  containerYellow: 0x8b7b3a,
  muzzleFlash: 0xffaa00
};
