
export type GameMode = 'SURVIVAL' | 'BATTLE_ROYALE' | 'EDITOR' | 'TRAINING';

export type FSRMode = 'OFF' | 'ULTRA_QUALITY' | 'QUALITY' | 'BALANCED' | 'PERFORMANCE';

export interface GameSettings {
  mode: GameMode;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  graphics: 'LOW' | 'MEDIUM' | 'HIGH';
  sound: boolean;
  fov: number;
  rayTracing: boolean;
  fsrMode: FSRMode; // FidelityFX Super Resolution Mode
}

export interface GameConfig {
  fov: number;
  mouseSensitivity: number;
  physicsStep: number;
  gravity: number;
}

export interface RadarBlip {
  x: number; 
  y: number; 
  id: number;
  team: 'RED' | 'BLUE';
}

export interface KillFeedEntry {
    id: number;
    killer: string;
    victim: string;
    weapon: string; // 'RIFLE', 'SNIPER', etc.
    isHeadshot: boolean;
    timestamp: number;
}

export interface PlayerStats {
  health: number;
  ammo: number;
  maxAmmo: number;
  isReloading: boolean;
  isAiming: boolean;
  fireMode: 'AUTO' | 'SEMI' | 'BOLT' | 'PUMP';
  weaponName: string; 
  weaponTierColor?: string; // New: Color hex for UI
  
  // Region / Location
  currentRegion: string | null;
  
  // Drop Phase UI
  showDropPrompt?: boolean;
  
  // Movement State for HUD hints
  isFalling?: boolean;
  isParachuting?: boolean;

  // Game Mode State
  gameMode: GameMode;
  score: number;
  
  // Mode Specifics
  wave: number;           
  enemiesRemaining: number;
  
  // Battle Royale Specifics
  isOutsideZone?: boolean;
  zoneRadius?: number;
  
  radarBlips: RadarBlip[];
  killFeed: KillFeedEntry[];

  // End Game States
  isDead?: boolean;
  isVictory?: boolean;
}

export enum GameState {
  MENU,
  PLAYING,
  PAUSED
}

export type Vector3Tuple = [number, number, number];
