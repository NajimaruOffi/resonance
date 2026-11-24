// Entrées clavier/souris. On utilise event.code (position physique) :
// ZQSD sur AZERTY et WASD sur QWERTY fonctionnent sans configuration.

export class Input {
  constructor(target) {
    this.keys = new Set();
    this._pressed = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, buttons: new Set(), _pressed: new Set() };
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this._pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons.clear(); });
    window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    target.addEventListener('mousedown', (e) => {
      this.mouse.buttons.add(e.button);
      this.mouse._pressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouse.buttons.delete(e.button));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this._pressed.has(code); }
  mousePressed(btn) { return this.mouse._pressed.has(btn); }

  endFrame() {
    this._pressed.clear();
    this.mouse._pressed.clear();
  }
}
