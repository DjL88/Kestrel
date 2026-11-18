"""Read-only classic TIFF RGB16/ICC metadata preflight; not a colour-fidelity test."""
import argparse
import json
import struct
from pathlib import Path


class InvalidTiff(ValueError):
    pass


def inspect(data: bytes) -> dict:
    if len(data) < 8 or data[:2] not in (b"II", b"MM"):
        raise InvalidTiff("Invalid TIFF header")
    endian = "<" if data[:2] == b"II" else ">"
    def u16(offset):
        return struct.unpack_from(endian + "H", data, offset)[0]
    def u32(offset):
        return struct.unpack_from(endian + "I", data, offset)[0]
    if u16(2) != 42:
        raise InvalidTiff("Only classic TIFF is supported")
    offset = u32(4)
    if offset > len(data) - 2:
        raise InvalidTiff("IFD outside file")
    count = u16(offset)
    if count > (len(data) - offset - 2) // 12:
        raise InvalidTiff("Truncated IFD")
    tags = {}
    for i in range(count):
        pos = offset + 2 + i * 12
        tag, typ, n = u16(pos), u16(pos + 2), u32(pos + 4)
        if tag not in (256, 257, 258, 262, 277, 34675):
            continue
        unit = {1: 1, 3: 2, 4: 4, 7: 1}.get(typ)
        if unit is None or n > len(data) // unit:
            raise InvalidTiff("Invalid tag type/count")
        size = n * unit
        if size > 4:
            start = u32(pos + 8)
            if start > len(data) or size > len(data) - start:
                raise InvalidTiff("Tag payload outside file")
            payload = data[start:start + size]
        else:
            payload = data[pos + 8:pos + 8 + size]
        if tag == 34675:
            tags[tag] = len(payload)
        elif typ == 3:
            tags[tag] = list(struct.unpack(endian + str(n) + "H", payload))
        elif typ == 4:
            tags[tag] = list(struct.unpack(endian + str(n) + "I", payload))
        else:
            raise InvalidTiff("Unexpected metadata type")
    def scalar(tag):
        values = tags.get(tag, [])
        return values[0] if len(values) == 1 else None
    width, height = scalar(256), scalar(257)
    if not width or not height or width * height > 1_000_000_000:
        raise InvalidTiff("Invalid dimensions")
    return {
        "width": width, "height": height,
        "bits_per_sample": tags.get(258),
        "samples_per_pixel": scalar(277),
        "photometric": scalar(262),
        "icc_profile_bytes": tags.get(34675, 0),
        "rgb16_metadata": tags.get(258) == [16, 16, 16]
            and scalar(277) == 3 and scalar(262) == 2,
        "profile_embedded": tags.get(34675, 0) > 0,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tiff", type=Path)
    report = inspect(parser.parse_args().tiff.read_bytes())
    print(json.dumps(report, indent=2))
    if not report["rgb16_metadata"] or not report["profile_embedded"]:
        raise SystemExit(2)
