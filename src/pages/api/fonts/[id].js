import { getCustomFontBlob } from '../../../lib/custom-fonts.js';

export async function GET({ params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id < 1) {
    return new Response('Not found', { status: 404 });
  }

  const row = await getCustomFontBlob(id);
  if (!row) {
    return new Response('Not found', { status: 404 });
  }

  let buf = row.data;
  if (buf instanceof ArrayBuffer) buf = new Uint8Array(buf);
  else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) buf = new Uint8Array(buf);
  else if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': row.mime_type || 'font/ttf',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
