"""Independent classic TIFF integrity gate. Does NOT establish RAW sensor or colour parity."""
import argparse
import hashlib
import json
import struct
from pathlib import Path

class TiffError(ValueError):
    pass

def verify(path):
    data = Path(path).read_bytes()
    if len(data) < 8 or data[:2] not in (b'II', b'MM'):
        raise TiffError('not a classic TIFF')
    endian = '<' if data[:2] == b'II' else '>'
    def unpack(fmt, pos):
        size = struct.calcsize(fmt)
        if pos < 0 or pos + size > len(data):
            raise TiffError('truncated TIFF')
        return struct.unpack_from(endian + fmt, data, pos)
    def u16(pos): return unpack('H', pos)[0]
    def u32(pos): return unpack('I', pos)[0]
    if u16(2) != 42:
        raise TiffError('not classic TIFF (BigTIFF unsupported)')
    start = u32(4)
    count = u16(start)
    if count > 4096 or start + 2 + 12 * count + 4 > len(data):
        raise TiffError('invalid IFD')
    tags = {}
    for i in range(count):
        pos = start + 2 + 12 * i
        tag, typ, n, val = u16(pos), u16(pos + 2), u32(pos + 4), u32(pos + 8)
        if tag in tags: raise TiffError('duplicate TIFF tag')
        if typ not in (3, 4, 7): continue
        size = {3: 2, 4: 4, 7: 1}[typ] * n
        if size > len(data): raise TiffError('oversized TIFF tag')
        raw = data[pos + 8:pos + 8 + size] if size <= 4 else data[val:val + size]
        if len(raw) != size: raise TiffError('truncated TIFF tag')
        tags[tag] = (list(struct.unpack(endian + str(n) + ('H' if typ == 3 else 'I'), raw))
                     if typ in (3, 4) else raw)
    def scalar(tag):
        v = tags.get(tag)
        if not isinstance(v, list) or len(v) != 1:
            raise TiffError(f'missing/invalid tag {tag}')
        return v[0]
    width, height = scalar(256), scalar(257)
    if width < 1 or height < 1 or width * height > 500_000_000:
        raise TiffError('invalid dimensions')
    if tags.get(258) != [16, 16, 16] or scalar(259) != 1 or scalar(262) != 2:
        raise TiffError('requires uncompressed 16-bit RGB')
    if scalar(277) != 3 or scalar(284) != 1:
        raise TiffError('requires interleaved RGB samples')
    profile = tags.get(34675)
    if not isinstance(profile, bytes) or len(profile) < 128 or profile[36:40] != b'acsp':
        raise TiffError('missing/invalid embedded ICC profile')
    if int.from_bytes(profile[:4], 'big') != len(profile):
        raise TiffError('ICC length mismatch')
    offsets, lengths = tags.get(273), tags.get(279)
    if not isinstance(offsets, list) or not isinstance(lengths, list) or len(offsets) != len(lengths) or not offsets:
        raise TiffError('missing/mismatched strips')
    rows = scalar(278)
    if rows < 1 or len(offsets) != (height + rows - 1) // rows:
        raise TiffError('incomplete strip inventory')
    digest = hashlib.sha256()
    first, nonflat = None, False
    for i, (offset, length) in enumerate(zip(offsets, lengths)):
        expected = width * min(rows, height - i * rows) * 6
        if length != expected or offset + length > len(data):
            raise TiffError('truncated or wrong-size pixel strip')
        pixels = data[offset:offset + length]
        digest.update(pixels)
        for (value,) in struct.iter_unpack(endian + 'H', pixels):
            if first is None: first = value
            elif value != first: nonflat = True
    if not nonflat: raise TiffError('flat samples: cannot establish meaningful image data')
    return dict(width=width, height=height, bits_per_sample=16, channels=3,
                icc_sha256=hashlib.sha256(profile).hexdigest(),
                pixel_sha256=digest.hexdigest(), strips=len(offsets),
                scope='TIFF structure and pixel integrity only; NOT RAW/colour parity')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('tiff', type=Path)
    p.add_argument('--expected-width', type=int)
    p.add_argument('--expected-height', type=int)
    a = p.parse_args()
    try:
        result = verify(a.tiff)
        if a.expected_width is not None and result['width'] != a.expected_width:
            raise TiffError('width differs from source expectation')
        if a.expected_height is not None and result['height'] != a.expected_height:
            raise TiffError('height differs from source expectation')
        print(json.dumps(dict(status='PASS', **result), sort_keys=True))
    except (TiffError, OSError) as exc:
        print(json.dumps(dict(status='FAIL', reason=str(exc))))
        raise SystemExit(1)

if __name__ == '__main__':
    main()
