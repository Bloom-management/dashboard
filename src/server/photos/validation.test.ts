import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validatePhotoBytes } from './validation';

for (const format of ['jpeg', 'png', 'webp'] as const) {
  test(`decodes synthetic ${format} and rejects MIME/size spoofing`, async () => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).toFormat(format).toBuffer();
    assert.equal(await validatePhotoBytes(bytes, bytes.length, `image/${format}`), `image/${format}`);
    await assert.rejects(validatePhotoBytes(bytes, bytes.length + 1, `image/${format}`), /VALIDATION_ERROR/);
    await assert.rejects(validatePhotoBytes(bytes, bytes.length, 'text/plain'), /VALIDATION_ERROR/);
    const truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
    await assert.rejects(validatePhotoBytes(truncated, truncated.length, `image/${format}`), /VALIDATION_ERROR/);
  });
}
test('rejects fake image, SVG, empty and oversized uploads', async () => {
  for (const bytes of [Buffer.from('not a photo'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), Buffer.alloc(0), Buffer.alloc(10_485_761)]) {
    await assert.rejects(validatePhotoBytes(bytes, bytes.length, 'image/png'), /VALIDATION_ERROR/);
  }
});
