//! Kestrel-owned Nikon HE/HE* container inspector.
//!
//! This is deliberately NOT a decompressor. It reads public TIFF/NEF structure,
//! locates and bounds-checks a Nikon HE codestream, and reports provenance.
//! No external codec library, linked SDK, copied decoder source, or network call.
//! Decoding sensor samples, applying transfer curves, and exporting are future
//! independent, separately verified stages. Never call a header-only result RAW decoded.

use std::collections::HashSet;

const MAX_IFDS: usize = 64;
const MAX_ENTRIES: usize = 512;
const MAX_SUBIFDS: usize = 64;
const MAX_PIXELS: u64 = 200_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeMode {
    He,
    HeStar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Evidence {
    /// HE-family container/codestream was located; no sensor values were decoded.
    HeaderOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeContainer {
    pub raw_width: u32,
    pub raw_height: u32,
    pub strip_offset: usize,
    pub strip_length: usize,
    /// Nikon MakerNote compression mode, when trustworthy and present.
    pub mode: Option<HeMode>,
    pub evidence: Evidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeError {
    NotTiff,
    Malformed,
    OutOfBounds,
    ResourceLimit,
    NoHeCodestream,
    InvalidHeHeader,
}

#[derive(Clone, Copy)]
enum ByteOrder {
    Little,
    Big,
}

#[derive(Clone, Copy)]
struct Entry {
    tag: u16,
    kind: u16,
    count: u32,
    value_at: usize,
}

struct Tiff<'a> {
    bytes: &'a [u8],
    base: usize,
    order: ByteOrder,
}

fn area(bytes: &[u8], start: usize, len: usize) -> Result<&[u8], ProbeError> {
    let end = start.checked_add(len).ok_or(ProbeError::OutOfBounds)?;
    bytes.get(start..end).ok_or(ProbeError::OutOfBounds)
}

fn u16_at(bytes: &[u8], at: usize, order: ByteOrder) -> Result<u16, ProbeError> {
    let b = area(bytes, at, 2)?;
    Ok(match order {
        ByteOrder::Little => u16::from_le_bytes([b[0], b[1]]),
        ByteOrder::Big => u16::from_be_bytes([b[0], b[1]]),
    })
}

fn u32_at(bytes: &[u8], at: usize, order: ByteOrder) -> Result<u32, ProbeError> {
    let b = area(bytes, at, 4)?;
    Ok(match order {
        ByteOrder::Little => u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
        ByteOrder::Big => u32::from_be_bytes([b[0], b[1], b[2], b[3]]),
    })
}

impl<'a> Tiff<'a> {
    fn open(bytes: &'a [u8], base: usize) -> Result<(Self, u32), ProbeError> {
        let h = area(bytes, base, 8)?;
        let order = match &h[..2] {
            b"II" => ByteOrder::Little,
            b"MM" => ByteOrder::Big,
            _ => return Err(ProbeError::NotTiff),
        };
        if u16_at(bytes, base + 2, order)? != 42 {
            return Err(ProbeError::NotTiff);
        }
        let first = u32_at(bytes, base + 4, order)?;
        Ok((Self { bytes, base, order }, first))
    }

    fn address(&self, offset: u32) -> Result<usize, ProbeError> {
        self.base.checked_add(offset as usize).ok_or(ProbeError::OutOfBounds)
    }

    fn entries(&self, offset: u32) -> Result<(Vec<Entry>, u32), ProbeError> {
        let at = self.address(offset)?;
        let count = u16_at(self.bytes, at, self.order)? as usize;
        if count > MAX_ENTRIES {
            return Err(ProbeError::ResourceLimit);
        }
        let first = at.checked_add(2).ok_or(ProbeError::OutOfBounds)?;
        let entries_size = count.checked_mul(12).ok_or(ProbeError::OutOfBounds)?;
        area(self.bytes, first, entries_size + 4)?;
        let mut result = Vec::with_capacity(count);
        for index in 0..count {
            let p = first + index * 12;
            result.push(Entry {
                tag: u16_at(self.bytes, p, self.order)?,
                kind: u16_at(self.bytes, p + 2, self.order)?,
                count: u32_at(self.bytes, p + 4, self.order)?,
                value_at: p + 8,
            });
        }
        let next = u32_at(self.bytes, first + entries_size, self.order)?;
        Ok((result, next))
    }

    fn payload(&self, e: Entry) -> Result<&'a [u8], ProbeError> {
        // Only TIFF types we actually inspect. An unsupported field is never
        // silently interpreted as an offset or decoded pixel data.
        let unit = match e.kind {
            1 | 2 | 6 | 7 => 1usize, // BYTE, ASCII, SBYTE, UNDEFINED
            3 | 8 => 2,            // SHORT, SSHORT
            4 | 9 | 11 => 4,       // LONG, SLONG, FLOAT
            5 | 10 | 12 => 8,      // RATIONAL, SRATIONAL, DOUBLE
            _ => return Err(ProbeError::Malformed),
        };
        let len = (e.count as usize)
            .checked_mul(unit)
            .ok_or(ProbeError::ResourceLimit)?;
        if len <= 4 {
            area(self.bytes, e.value_at, len)
        } else {
            let raw_offset = u32_at(self.bytes, e.value_at, self.order)?;
            area(self.bytes, self.address(raw_offset)?, len)
        }
    }

    fn scalar(&self, e: Entry) -> Result<u32, ProbeError> {
        if e.count != 1 {
            return Err(ProbeError::Malformed);
        }
        let bytes = self.payload(e)?;
        match e.kind {
            3 => Ok(u16_at(bytes, 0, self.order)? as u32),
            4 => u32_at(bytes, 0, self.order),
            _ => Err(ProbeError::Malformed),
        }
    }

    fn number(&self, entries: &[Entry], tag: u16) -> Result<Option<u32>, ProbeError> {
        match entries.iter().find(|e| e.tag == tag) {
            Some(e) => self.scalar(*e).map(Some),
            None => Ok(None),
        }
    }
}

/// Nikon Type-3 MakerNote, when present. An absent/malformed note is UNKNOWN,
/// not an excuse to guess HE versus HE* from filename or file size.
fn nikon_mode(root: &Tiff<'_>, exif_ifd: u32) -> Option<HeMode> {
    let (exif, _) = root.entries(exif_ifd).ok()?;
    let maker = *exif.iter().find(|entry| entry.tag == 0x927c)?;
    let bytes = root.payload(maker).ok()?;
    if bytes.len() < 18 || !bytes.starts_with(b"Nikon\0") {
        return None;
    }
    let (nested, first_ifd) = Tiff::open(bytes, 10).ok()?;
    let (tags, _) = nested.entries(first_ifd).ok()?;
    let value = nested.payload(*tags.iter().find(|entry| entry.tag == 0x0051)?).ok()?;
    let mode = u16::from_le_bytes([*value.get(10)?, *value.get(11)?]);
    match mode {
        13 => Some(HeMode::He),
        14 => Some(HeMode::HeStar),
        _ => None,
    }
}

/// Validate only the fixed JPEG XS start and bounded CAP/PIH marker segments.
/// This never decompresses anything and never confers RAW export eligibility.
fn check_he_header(stream: &[u8]) -> Result<(), ProbeError> {
    if stream.len() < 14 || !stream.starts_with(&[0xff, 0x10, 0xff, 0x50]) {
        return Err(ProbeError::InvalidHeHeader);
    }
    let cap_len = u16::from_be_bytes([stream[4], stream[5]]) as usize;
    if cap_len < 2 {
        return Err(ProbeError::InvalidHeHeader);
    }
    let pih = 4usize.checked_add(cap_len).ok_or(ProbeError::InvalidHeHeader)?;
    let marker = area(stream, pih, 4).map_err(|_| ProbeError::InvalidHeHeader)?;
    if marker[..2] != [0xff, 0x12] {
        return Err(ProbeError::InvalidHeHeader);
    }
    let pih_len = u16::from_be_bytes([marker[2], marker[3]]) as usize;
    if pih_len < 2 {
        return Err(ProbeError::InvalidHeHeader);
    }
    area(stream, pih + 2, pih_len).map_err(|_| ProbeError::InvalidHeHeader)?;
    if !stream.ends_with(&[0xff, 0x11]) {
        return Err(ProbeError::InvalidHeHeader);
    }
    Ok(())
}

/// Locate the largest plausible CFA RAW IFD with Nikon compression 34713,
/// a single bounded JPEG XS strip and its Nikon compression-mode metadata.
/// No external SDK, library, network service or decoded image is involved.
pub fn inspect_nef(bytes: &[u8]) -> Result<HeContainer, ProbeError> {
    let (tiff, first) = Tiff::open(bytes, 0)?;
    if first == 0 {
        return Err(ProbeError::NoHeCodestream);
    }
    let mut ifds = vec![first];
    let mut visited = HashSet::new();
    let mut exif_ifds = vec![];
    let mut best: Option<HeContainer> = None;

    let mut index = 0;
    while index < ifds.len() {
        if ifds.len() > MAX_IFDS {
            return Err(ProbeError::ResourceLimit);
        }
        let offset = ifds[index];
        index += 1;
        if offset == 0 || !visited.insert(offset) {
            continue;
        }

        let (entries, next) = tiff.entries(offset)?;
        if next != 0 {
            ifds.push(next);
        }
        if let Some(subs) = entries.iter().find(|entry| entry.tag == 0x014a) {
            if subs.kind != 4 || subs.count as usize > MAX_SUBIFDS {
                return Err(ProbeError::ResourceLimit);
            }
            for chunk in tiff.payload(*subs)?.chunks_exact(4) {
                let offset = match tiff.order {
                    ByteOrder::Little => u32::from_le_bytes(chunk.try_into().unwrap()),
                    ByteOrder::Big => u32::from_be_bytes(chunk.try_into().unwrap()),
                };
                if offset != 0 {
                    ifds.push(offset);
                }
            }
        }
        if let Some(exif_offset) = tiff.number(&entries, 0x8769)? {
            exif_ifds.push(exif_offset);
        }

        if tiff.number(&entries, 0x0106)? != Some(32803)
            || tiff.number(&entries, 0x0103)? != Some(34713)
        {
            continue;
        }
        let width = tiff.number(&entries, 0x0100)?.ok_or(ProbeError::Malformed)?;
        let height = tiff.number(&entries, 0x0101)?.ok_or(ProbeError::Malformed)?;
        let pixels = (width as u64) * (height as u64);
        if pixels == 0 || pixels > MAX_PIXELS {
            return Err(ProbeError::ResourceLimit);
        }
        let strip_offset = tiff.number(&entries, 0x0111)?.ok_or(ProbeError::Malformed)? as usize;
        let strip_length = tiff.number(&entries, 0x0117)?.ok_or(ProbeError::Malformed)? as usize;
        let stream = area(bytes, strip_offset, strip_length)?;
        check_he_header(stream)?;
        let candidate = HeContainer {
            raw_width: width,
            raw_height: height,
            strip_offset,
            strip_length,
            mode: None,
            evidence: Evidence::HeaderOnly,
        };
        if best.as_ref().map_or(true, |old| {
            pixels > (old.raw_width as u64) * (old.raw_height as u64)
        }) {
            best = Some(candidate);
        }
    }
    let mut selected = best.ok_or(ProbeError::NoHeCodestream)?;
    selected.mode = exif_ifds.into_iter().find_map(|offset| nikon_mode(&tiff, offset));
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16le(bytes: &mut [u8], at: usize, value: u16) {
        bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }
    fn u32le(bytes: &mut [u8], at: usize, value: u32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }
    fn tag(bytes: &mut [u8], at: usize, id: u16, kind: u16, count: u32, value: u32) {
        u16le(bytes, at, id);
        u16le(bytes, at + 2, kind);
        u32le(bytes, at + 4, count);
        u32le(bytes, at + 8, value);
    }
    fn fixture(mode: Option<HeMode>) -> Vec<u8> {
        // Synthetic TIFF with IFD0 -> SubIFD (RAW), plus optional Nikon MakerNote.
        // Not a real photograph, and deliberately not a JPEG XS-encoded frame.
        let mut bytes = vec![0u8; 640];
        bytes[..2].copy_from_slice(b"II");
        u16le(&mut bytes, 2, 42);
        u32le(&mut bytes, 4, 8);
        u16le(&mut bytes, 8, if mode.is_some() { 2 } else { 1 });
        tag(&mut bytes, 10, 0x014a, 4, 1, 128);
        if mode.is_some() {
            tag(&mut bytes, 22, 0x8769, 4, 1, 256);
        }
        u16le(&mut bytes, 128, 7);
        let raw_tags: [(u16, u16, u32); 7] = [
            (0x00fe, 4, 0), (0x0100, 4, 8280), (0x0101, 4, 5520),
            (0x0103, 3, 34713), (0x0106, 3, 32803),
            (0x0111, 4, 360), (0x0117, 4, 18),
        ];
        for (i, (id, kind, value)) in raw_tags.into_iter().enumerate() {
            tag(&mut bytes, 130 + i * 12, id, kind, 1, value);
        }
        bytes[360..378].copy_from_slice(&[
            0xff, 0x10, 0xff, 0x50, 0x00, 0x04, 0x00, 0x00,
            0xff, 0x12, 0x00, 0x06, 0, 0, 0, 0,
            0xff, 0x11,
        ]);

        if let Some(mode) = mode {
            u16le(&mut bytes, 256, 1);
            tag(&mut bytes, 258, 0x927c, 7, 72, 440);
            bytes[440..446].copy_from_slice(b"Nikon\0");
            bytes[450..452].copy_from_slice(b"II");
            u16le(&mut bytes, 452, 42);
            u32le(&mut bytes, 454, 8);
            u16le(&mut bytes, 458, 1);
            tag(&mut bytes, 460, 0x0051, 7, 12, 40);
            // The tag payload begins at note offset 50 (absolute 490).
            // Its Nikon compression code sits 10 bytes later (absolute 500).
            u16le(&mut bytes, 500, match mode {
                HeMode::He => 13,
                HeMode::HeStar => 14,
            });
        }
        bytes
    }

    #[test]
    fn identifies_he_container_without_claiming_sensor_decode() {
        let found = inspect_nef(&fixture(Some(HeMode::He))).unwrap();
        assert_eq!((found.raw_width, found.raw_height), (8280, 5520));
        assert_eq!((found.strip_offset, found.strip_length), (360, 18));
        assert_eq!(found.evidence, Evidence::HeaderOnly);
        assert_eq!(found.mode, Some(HeMode::He));
    }

    #[test]
    fn identifies_he_star() {
        assert_eq!(inspect_nef(&fixture(Some(HeMode::HeStar))).unwrap().mode, Some(HeMode::HeStar));
    }

    #[test]
    fn unknown_mode_is_not_guessed_from_header_or_size() {
        assert_eq!(inspect_nef(&fixture(None)).unwrap().mode, None);
    }

    #[test]
    fn refuses_out_of_bounds_strip_without_panicking() {
        let mut bytes = fixture(None);
        u32le(&mut bytes, 198, u32::MAX);
        assert_eq!(inspect_nef(&bytes), Err(ProbeError::OutOfBounds));
    }

    #[test]
    fn refuses_false_codec_marker() {
        let mut bytes = fixture(None);
        bytes[360] = 0;
        assert_eq!(inspect_nef(&bytes), Err(ProbeError::InvalidHeHeader));
    }

    #[test]
    fn refuses_wrong_compression_type() {
        let mut bytes = fixture(None);
        u16le(&mut bytes, 174, 1);
        assert_eq!(inspect_nef(&bytes), Err(ProbeError::NoHeCodestream));
    }

    #[test]
    fn malformed_and_non_tiff_data_fail_closed() {
        assert_eq!(inspect_nef(b"not a raw"), Err(ProbeError::NotTiff));
        assert!(inspect_nef(&fixture(None)[..40]).is_err());
    }
}
