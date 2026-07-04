import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);

let _SerialPort = null;      // serialport: SerialPort class
let _ReadlineParser = null;  // serialport: ReadlineParser transform
export let serialAvailable = false;
export let serialLoadError = '';
try {
  const mod = require('serialport');
  _SerialPort     = mod.SerialPort;
  _ReadlineParser = mod.ReadlineParser;
  serialAvailable = true;
} catch (e) {
  serialLoadError = e.message;
  console.error('[serial-reader] serialport failed to load:', e.message);
  console.error('[serial-reader] Try: npm rebuild serialport');
}

// List available serial ports. RFID readers running in USB-CDC / Virtual COM
// mode show up here as /dev/cu.usbmodem* or /dev/cu.usbserial* (macOS) or COMx
// (Windows). Unlike keyboard-emulating HID readers, serial ports are NOT seized
// by the OS, so the server can open and read them directly on macOS and Windows.
export async function listSerialPorts() {
  if (!serialAvailable) return [];
  const raw = await _SerialPort.list();
  return raw.map(p => ({
    path:         p.path         || '',
    manufacturer: p.manufacturer || '',
    friendlyName: p.friendlyName || p.pnpId || '',
    vendorId:     p.vendorId     || '',
    productId:    p.productId    || '',
    serialNumber: p.serialNumber || '',
  }));
}

export class SerialRFIDReader extends EventEmitter {
  constructor() {
    super();
    this._port    = null;
    this.path     = null;
    this.baudRate = null;
  }

  get isOpen() { return this._port !== null && this._port.isOpen; }

  // Opens the serial port and emits 'card' for each newline-delimited line the
  // reader sends (most serial RFID readers append CR/LF after the card ID).
  // Returns a Promise that resolves once the port is open, or rejects with the
  // open error (e.g. port busy / not found) so the caller can report it.
  open(path, baudRate = 9600) {
    if (!serialAvailable) throw new Error('serialport not installed — run: npm install serialport');
    if (!path) throw new Error('serial port path required');
    this.close();

    return new Promise((resolve, reject) => {
      const port   = new _SerialPort({ path, baudRate, autoOpen: false });
      const parser = port.pipe(new _ReadlineParser({ delimiter: '\n' }));

      parser.on('data', line => {
        const card = String(line).replace(/\r/g, '').trim();
        if (card) this.emit('card', card);
      });

      // Fires on unplug / read failure / unexpected close. Guarded so an
      // intentional close() (which nulls _port first) doesn't emit an error.
      const onGone = err => {
        if (this._port !== port) return;
        this._reset();
        this.emit('error', err || new Error('serial port closed'));
      };
      port.on('error', onGone);
      port.on('close', () => onGone());

      port.open(err => {
        if (err) {
          // Open failed: tear down quietly and reject — no 'error' emit, so a
          // bad manual selection doesn't kick off the auto-retry loop.
          port.removeListener('error', onGone);
          port.removeListener('close', onGone);
          try { if (port.isOpen) port.close(); } catch {}
          this._reset();
          return reject(err);
        }
        this._port    = port;
        this.path     = path;
        this.baudRate = baudRate;
        resolve();
      });
    });
  }

  _reset() {
    this._port    = null;
    this.path     = null;
    this.baudRate = null;
  }

  close() {
    if (this._port) {
      const port = this._port;
      this._reset();   // null first so the 'close' handler treats this as intentional
      try { if (port.isOpen) port.close(); } catch {}
    }
  }
}
