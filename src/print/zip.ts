// A minimal zip writer: files stored without compression (PDFs are already compressed), so there is no dependency.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; bytes: Uint8Array }

/** A zip file holding the entries, in order. `when` sets the stored time (the DOS format has two-second steps from 1980). */
export function zip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = (Math.max(0, when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const record = (size: number, fill: (v: DataView) => void) => {
    const buf = new Uint8Array(size);
    fill(new DataView(buf.buffer));
    return buf;
  };
  for (const { name, bytes } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);
    const common = (v: DataView, at: number) => {
      v.setUint16(at, 20, true); // version needed
      v.setUint16(at + 2, 0x0800, true); // names are UTF-8
      v.setUint16(at + 4, 0, true); // stored
      v.setUint16(at + 6, time, true);
      v.setUint16(at + 8, date, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, bytes.length, true);
      v.setUint32(at + 18, bytes.length, true);
      v.setUint16(at + 22, nameBytes.length, true);
    };
    const local = record(30, (v) => { v.setUint32(0, 0x04034b50, true); common(v, 4); });
    parts.push(local, nameBytes, bytes);
    central.push(record(46, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true); // made by
      common(v, 6);
      v.setUint32(42, offset, true);
    }), nameBytes);
    offset += local.length + nameBytes.length + bytes.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = record(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
  });
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
