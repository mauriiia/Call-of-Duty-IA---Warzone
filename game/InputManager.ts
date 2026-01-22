
export class InputManager {
  public keys: Record<string, boolean> = {};
  public mouseDelta: { x: number; y: number } = { x: 0, y: 0 };
  
  // Normalized Device Coordinates (-1 to +1) for Raycasting
  public mouseNDC: { x: number; y: number } = { x: 0, y: 0 };
  
  public isLocked: boolean = false;
  public isAiming: boolean = false;
  public isMouseDown: boolean = false;
  
  // Callbacks
  public onReload: (() => void) | null = null;
  public onWeaponSelect: ((index: number) => void) | null = null;
  public onToggleFireMode: (() => void) | null = null;
  public onDebugToggle: (() => void) | null = null;

  constructor() {
    this.bindEvents();
  }

  private bindEvents() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyR' && this.onReload) this.onReload();
      if (e.code === 'KeyV' && this.onToggleFireMode) this.onToggleFireMode();
      if (e.code === 'KeyP' && this.onDebugToggle) this.onDebugToggle();
      
      if (e.code === 'Digit1' && this.onWeaponSelect) this.onWeaponSelect(0);
      if (e.code === 'Digit2' && this.onWeaponSelect) this.onWeaponSelect(1);
      if (e.code === 'Digit3' && this.onWeaponSelect) this.onWeaponSelect(2);
      if (e.code === 'Digit4' && this.onWeaponSelect) this.onWeaponSelect(3); 
    });
    
    window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    
    window.addEventListener('mousedown', (e) => {
      // ONLY trigger shooting on LEFT CLICK (0)
      if (e.button === 0) this.isMouseDown = true;
      // ONLY trigger aiming on RIGHT CLICK (2)
      if (e.button === 2) this.isAiming = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.isMouseDown = false;
      if (e.button === 2) this.isAiming = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      // 1. Delta for FPS Camera
      if (this.isLocked) {
        this.mouseDelta.x = Math.max(-500, Math.min(500, e.movementX));
        this.mouseDelta.y = Math.max(-500, Math.min(500, e.movementY));
      }

      // 2. NDC for RTS/Editor Cursor
      this.mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement !== null;
      if (!this.isLocked) {
        // We don't reset aiming here anymore to allow RMB in editor if needed, 
        // but typically for FPS we want to reset.
        // For hybrid approach, we handle state in the logic.
      }
    });
    
    // Handle Window Resize for NDC calculations
    window.addEventListener('resize', () => {
        // Handled naturally by clientX/innerWidth calculation in mousemove
    });
  }

  public lockPointer() {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const promise = (canvas as any).requestPointerLock();
      if (promise && typeof promise.catch === 'function') {
        promise.catch((e: any) => {});
      }
    }
  }
  
  public unlockPointer() {
      if (document.pointerLockElement) {
          document.exitPointerLock();
      }
  }

  public resetDelta() {
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }
}
