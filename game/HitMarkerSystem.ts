export class HitMarkerSystem {
    private static container: HTMLElement | null = null;
    private static lines: NodeListOf<HTMLElement> | null = null;
    private static timeoutId: number | null = null;

    public static init() {
        this.container = document.getElementById('hit-marker-container');
        if (this.container) {
            this.lines = this.container.querySelectorAll('.hit-line');
        }
    }

    public static show(isHeadshot: boolean) {
        if (!this.container) this.init();
        if (!this.container || !this.lines) return;

        // Clear previous fade
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.container.style.transition = 'none';
        }

        // Set Color
        const color = isHeadshot ? '#ff0000' : '#ffffff';
        this.lines.forEach(line => line.style.backgroundColor = color);

        // Pop Scale
        this.container.style.opacity = '1';
        this.container.style.transform = 'translate(-50%, -50%) scale(1.5)';
        
        // Force Reflow
        void this.container.offsetWidth;

        // Animate Out
        this.container.style.transition = 'all 0.15s ease-out';
        this.container.style.transform = 'translate(-50%, -50%) scale(1.0)';
        
        this.timeoutId = window.setTimeout(() => {
            if (this.container) this.container.style.opacity = '0';
        }, 100);
    }
}