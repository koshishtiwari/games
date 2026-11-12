// First encounters use a short visual focus. Rules and rewards do not change.
const EVENTS = {
  chain: { bit: 1, duration: 1.8, title: 'CHAIN!', text: 'Touching chips of the same value flip together.' },
  freeze: { bit: 2, duration: 2.6, title: 'FREEZE', text: 'Freezes nearby chips. Ice stops the chain.' },
  steal: { bit: 4, duration: 2.6, title: 'STOLEN', text: 'Turns the whole chain into a Bank loss.' },
  double: { bit: 16, duration: 2.4, title: 'DOUBLE!', text: 'Join a chain to double its value.' },
  move: { bit: 32, duration: 2.4, title: '+1 MOVE', text: 'Join a chain for one extra move.' },
  thaw: { bit: 8, duration: 2.1, title: 'ICE BREAK', text: 'Touch one frozen chip to break all ice.' }
};
export class FirstPlayFocus {
  constructor(seen = 0, save = () => {}) {
    this.seen = seen; this.save = save; this.active = null; this.queue = [];
  }
  show(kind, chips, source = null) {
    const event = EVENTS[kind];
    if (!event || this.seen & event.bit || this.active?.kind === kind || this.queue.some(e => e.kind === kind)) return false;
    const entry = { kind, ...event, age: 0, source, chips: chips.map(c => ({ id: c.id, serial: c.serial, type: c.type, x: c.x, y: c.y })) };
    if (!this.active) this.active = entry; else this.queue.push(entry);
    return true;
  }
  advance(dt) {
    if (!this.active || !(dt > 0)) return;
    const event = this.active;
    event.age += dt;
    // Do not mark a focus as seen if the player closes it before it appears.
    if (event.age >= .35 && !(this.seen & event.bit)) {
      this.seen |= event.bit; this.save(this.seen);
    }
    if (event.age >= event.duration) this.active = this.queue.shift() || null;
  }
  clear() { this.active = null; this.queue = []; }
  get speed() { return this.active ? .2 : 1; }
  get strength() {
    if (!this.active) return 0;
    const { age, duration } = this.active;
    return Math.min(1, age / .12, (duration - age) / .18);
  }
}
