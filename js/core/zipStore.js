// ZIP with stored entries. MIDI files are small; no compression or runtime dependency needed.
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
    for (let i = 0; i < 8; i++) byte = (byte >>> 1) ^ ((byte & 1) ? 0xedb88320 : 0);
    return byte;
});
const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
};

export function zipStoredFiles(files) {
    const encoder = new TextEncoder();
    const entries = files.map(({ name, data }) => ({ name: encoder.encode(name), data: new Uint8Array(data) }));
    const centralSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
    const centralStart = entries.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
    if (entries.length > 65535 || centralStart + centralSize + 22 > 0xffffffff || entries.some(e => e.name.length > 65535)) {
        throw new Error('The archive is too large.');
    }
    const bytes = new Uint8Array(centralStart + centralSize + 22);
    const view = new DataView(bytes.buffer);
    const u16 = (at, value) => view.setUint16(at, value, true);
    const u32 = (at, value) => view.setUint32(at, value, true);
    let local = 0, central = centralStart;
    for (const { name, data } of entries) {
        const crc = crc32(data);
        u32(local, 0x04034b50); u16(local + 4, 20); u16(local + 6, 0x800);
        u16(local + 12, 33); // 1980-01-01, valid DOS date
        u32(local + 14, crc); u32(local + 18, data.length); u32(local + 22, data.length); u16(local + 26, name.length);
        bytes.set(name, local + 30); bytes.set(data, local + 30 + name.length);
        u32(central, 0x02014b50); u16(central + 4, 20); u16(central + 6, 20); u16(central + 8, 0x800);
        u16(central + 14, 33); u32(central + 16, crc); u32(central + 20, data.length); u32(central + 24, data.length);
        u16(central + 28, name.length); u32(central + 42, local); bytes.set(name, central + 46);
        local += 30 + name.length + data.length;
        central += 46 + name.length;
    }
    u32(central, 0x06054b50); u16(central + 8, entries.length); u16(central + 10, entries.length);
    u32(central + 12, centralSize); u32(central + 16, centralStart);
    return bytes;
}
