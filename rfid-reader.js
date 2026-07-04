import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);

let _hid = null;
export let hidAvailable = false;
export let hidLoadError = '';
try {
  _hid = require('node-hid');
  hidAvailable = true;
} catch (e) {
  hidLoadError = e.message;
  console.error('[rfid-reader] node-hid failed to load:', e.message);
  console.error('[rfid-reader] Try: npm rebuild node-hid');
}

// USB HID keyboard usage codes → ASCII (standard keyboard-emulating RFID readers)
const KEYMAP = new Map([
  ...Array.from({ length: 26 }, (_, i) => [0x04 + i, String.fromCharCode(97 + i)]), // a–z
  ...Array.from({ length:  9 }, (_, i) => [0x1E + i, String(i + 1)]),               // 1–9
  [0x27, '0'],
  [0x2C, ' '],
  [0x2D, '-'],
]);

// showAll=false → only keyboard-type HID devices (what RFID readers emulate)
export function listDevices(showAll = false) {
  if (!hidAvailable) return [];
  const raw = _hid.devices();
  const mapped = raw.map(d => ({
    vendorId:     d.vendorId,
    productId:    d.productId,
    path:         d.path || '',
    manufacturer: d.manufacturer || '',
    product:      d.product || '',
    usagePage:    d.usagePage,
    usage:        d.usage,
  }));
  if (showAll) return mapped;
  // usagePage=1 (Generic Desktop), usage=6 (Keyboard) is the standard for
  // RFID readers that emulate a USB keyboard to type card IDs.
  return mapped.filter(d => d.usagePage === 1 && d.usage === 6);
}

export class RFIDReader extends EventEmitter {
  constructor() {
    super();
    this._dev      = null;
    this._buf      = '';
    this.vendorId  = null;
    this.productId = null;
  }

  get isOpen() { return this._dev !== null; }

  open(vendorId, productId) {
    if (!hidAvailable) throw new Error('node-hid not installed — run: npm install node-hid');
    this.close();
    const dev = new _hid.HID(vendorId, productId);
    dev.on('data',  buf => this._onData(buf));
    dev.on('error', err => {
      this._dev = null;
      this._buf = '';
      this.emit('error', err);
    });
    this._dev      = dev;
    this.vendorId  = vendorId;
    this.productId = productId;
    return this;
  }

  // HID keyboard report: [modifier, reserved, key1..key6]
  // Emits 'card' with the assembled card ID when Enter (0x28) is received.
  _onData(data) {
    const shift = (data[0] & 0x22) !== 0; // LShift=0x02, RShift=0x20
    for (let i = 2; i < Math.min(data.length, 8); i++) {
      const code = data[i];
      if (!code) continue;
      if (code === 0x28) {
        const card = this._buf.trim();
        this._buf = '';
        if (card) this.emit('card', card);
        return;
      }
      let ch = KEYMAP.get(code);
      if (!ch) continue;
      if (shift && ch >= 'a' && ch <= 'z') ch = ch.toUpperCase();
      this._buf += ch;
    }
  }

  close() {
    if (this._dev) {
      try { this._dev.close(); } catch {}
      this._dev      = null;
      this._buf      = '';
      this.vendorId  = null;
      this.productId = null;
    }
  }
}
