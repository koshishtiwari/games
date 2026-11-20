export const ENTRY_GEMS = 10;
export const POINTS_PER_GEM = 100;

const whole = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

// Keep existing gems separate from the Bank at risk in this run.
// Report the current payout so closing the WebView also keeps the winnings.
export class RunWallet {
  constructor() { this.ready = false; this.reserve = 0; this.bank = 0; this.active = false; }
  seed(value) {
    if (this.ready) return false;
    this.reserve = whole(value); this.ready = true; return true;
  }
  get payout() { return this.active ? Math.floor(Math.max(0, this.bank) / POINTS_PER_GEM) : 0; }
  get balance() { return this.reserve + this.payout; }
  get canStart() { return this.ready && !this.active && this.balance >= ENTRY_GEMS; }
  start() {
    if (!this.canStart) return false;
    this.reserve -= ENTRY_GEMS; this.bank = 0; this.active = true; return true;
  }
  update(points) { if (this.active && Number.isFinite(points)) this.bank = points; }
  finish() {
    const payout = this.payout;
    this.reserve = this.balance; this.bank = 0; this.active = false;
    return payout;
  }
  grant(value) { if (this.ready) this.reserve += whole(value); }
}
