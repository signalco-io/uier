import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { jpegImage, pngImage } from './images';

export const imageUrl = (type: string, data: Buffer) => `data:${type};base64,${data.toString('base64')}`;

function chunk(type: string, data: Buffer) {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length);
    bytes.write(type, 4);
    data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
    return bytes;
}

export async function privateImages() {
    const jpeg = await sharp(Buffer.from(jpegImage.split(',')[1]!, 'base64')).withExif({
        IFD0: { Artist: 'Private camera owner' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 48/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '15/1 58/1 0/1' }
    }).jpeg().toBuffer();
    const png = Buffer.from(pngImage.split(',')[1]!, 'base64');
    const text = Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.from('Author\0Private camera owner')),
        png.subarray(33), Buffer.from('private-trailing-data')]);
    const control = Buffer.alloc(8);
    control.writeUInt32BE(2);
    const frame = (sequence: number) => {
        const bytes = Buffer.alloc(26);
        bytes.writeUInt32BE(sequence);
        bytes.writeUInt32BE(3, 4);
        bytes.writeUInt32BE(2, 8);
        bytes.writeUInt16BE(1, 20);
        bytes.writeUInt16BE(10, 22);
        return bytes;
    };
    const compressed: Buffer[] = [];
    for (let offset = 33; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const sequence = Buffer.alloc(4);
    sequence.writeUInt32BE(2);
    const animated = Buffer.concat([png.subarray(0, 33), chunk('acTL', control), chunk('fcTL', frame(0)),
        chunk('IDAT', Buffer.concat(compressed)), chunk('fcTL', frame(1)), chunk('fdAT', Buffer.concat([sequence, ...compressed])), chunk('IEND', Buffer.alloc(0))]);
    return [imageUrl('image/jpeg', jpeg), imageUrl('image/png', text), imageUrl('image/png', animated)];
}

export async function expectPrivateImageRemoved(bytes: Buffer) {
    const metadata = await sharp(bytes).metadata();
    if (metadata.exif || metadata.xmp || metadata.icc || (metadata.pages ?? 1) !== 1)
        throw new Error('Image retained metadata or animation');
    for (const marker of ['Private camera owner', 'private-trailing-data', 'acTL', 'fcTL', 'fdAT', 'tEXt'])
        if (bytes.includes(marker)) throw new Error(`Image retained ${marker}`);
    // Also force a full pixel decode of the result.
    await sharp(bytes).raw().toBuffer();
}
