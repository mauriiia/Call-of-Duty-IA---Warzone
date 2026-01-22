export class DamageIndicatorSystem {
  
  public static show(rotationDeg: number) {
    const container = document.getElementById('damage-indicator-container');
    if (!container) return;

    const arrow = document.createElement('div');
    arrow.className = 'damage-arrow';
    
    // Set rotation
    // We add transform directly. The CSS centers it via translate(-50%, -50%).
    // We append the rotate.
    arrow.style.transform = `translate(-50%, -50%) rotate(${rotationDeg}deg)`;
    
    container.appendChild(arrow);

    // Animation Loop for this element
    // 1. Fade In
    requestAnimationFrame(() => {
        arrow.style.opacity = '1';
    });

    // 2. Fade Out after delay
    setTimeout(() => {
        arrow.style.opacity = '0';
        // 3. Remove from DOM after fade out transition (0.2s in CSS)
        setTimeout(() => {
            if (container.contains(arrow)) {
                container.removeChild(arrow);
            }
        }, 500);
    }, 1500); // Visible duration
  }
}