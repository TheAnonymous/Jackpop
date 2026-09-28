/*
 * A small Ogg writer for Opus audio (RFC 3533, RFC 7845): the format of
 * WhatsApp voice messages, so a shared song plays right in the chat. The
 * browser's AudioEncoder makes the Opus packets; this wraps them in pages.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index << 24;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    table[index] = crc >>> 0;
  }
  return table;
})();

/** Ogg's CRC-32: polynomial 0x04C11DB7, no reflection, start and end at zero. */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc >>> 0;
}

export interface OggPacket {
  data: Uint8Array;
  /** Granule position after this packet: 48 kHz samples decoded so far, counting the pre-skip. */
  granule: bigint;
}

const HEADER_TYPE = { continued: 0x01, first: 0x02, last: 0x04 } as const;

function page(packets: Uint8Array[], granule: bigint, serial: number, sequence: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const packet of packets) {
    let remaining = packet.length;
    while (remaining >= 255) {
      lacing.push(255);
      remaining -= 255;
    }
    lacing.push(remaining);
  }
  const bodyLength = packets.reduce((sum, packet) => sum + packet.length, 0);
  const bytes = new Uint8Array(27 + lacing.length + bodyLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4f, 0x67, 0x67, 0x53], 0);
  bytes[4] = 0;
  bytes[5] = flags;
  view.setBigInt64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  bytes[26] = lacing.length;
  bytes.set(lacing, 27);
  let offset = 27 + lacing.length;
  for (const packet of packets) {
    bytes.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
}

/** The identification header; channel mapping family 0 (mono or stereo). */
export function opusHead(channels: number, preSkip: number, inputRate: number): Uint8Array {
  const bytes = new Uint8Array(19);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("OpusHead"), 0);
  bytes[8] = 1;
  bytes[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputRate, true);
  view.setInt16(16, 0, true);
  bytes[18] = 0;
  return bytes;
}

export function opusTags(vendor: string, comments: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const vendorBytes = encoder.encode(vendor);
  const commentBytes = comments.map((comment) => encoder.encode(comment));
  const length = 8 + 4 + vendorBytes.length + 4 + commentBytes.reduce((sum, bytes) => sum + 4 + bytes.length, 0);
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("OpusTags"), 0);
  let offset = 8;
  view.setUint32(offset, vendorBytes.length, true);
  bytes.set(vendorBytes, offset + 4);
  offset += 4 + vendorBytes.length;
  view.setUint32(offset, commentBytes.length, true);
  offset += 4;
  for (const comment of commentBytes) {
    view.setUint32(offset, comment.length, true);
    bytes.set(comment, offset + 4);
    offset += 4 + comment.length;
  }
  return bytes;
}

/**
 * The whole file: a page with the OpusHead, a page with the tags, then the
 * audio packets, as many per page as fit in 255 lacing values.
 */
export function oggOpusFile(head: Uint8Array, tags: Uint8Array, packets: OggPacket[], serial = 0x4a41434b): Uint8Array {
  const pages: Uint8Array[] = [page([head], 0n, serial, 0, HEADER_TYPE.first), page([tags], 0n, serial, 1, 0)];
  let sequence = 2;
  let current: OggPacket[] = [];
  let lacing = 0;
  const flush = (last: boolean) => {
    if (current.length === 0) return;
    pages.push(page(current.map((packet) => packet.data), current[current.length - 1]!.granule, serial, sequence, last ? HEADER_TYPE.last : 0));
    sequence += 1;
    current = [];
    lacing = 0;
  };
  packets.forEach((packet, index) => {
    const needed = Math.floor(packet.data.length / 255) + 1;
    if (lacing + needed > 255) flush(false);
    current.push(packet);
    lacing += needed;
    if (index === packets.length - 1) flush(true);
  });
  const total = pages.reduce((sum, bytes) => sum + bytes.length, 0);
  const file = new Uint8Array(total);
  let offset = 0;
  for (const bytes of pages) {
    file.set(bytes, offset);
    offset += bytes.length;
  }
  return file;
}
