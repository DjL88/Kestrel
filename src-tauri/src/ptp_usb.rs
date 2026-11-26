//! USB link to a camera for tethered shooting (desktop app). Only the pipe lives here: find cameras that present the
//! USB Still Image class (6/1/1, PTP), claim that interface, and move bytes on its bulk and interrupt endpoints. The
//! PTP protocol itself is InFlight's shared code in `src/core/ptp.ts`, the same on every platform.
//!
//! Frames are written by `save_frame`: as `name.part`, renamed when complete, never over an existing file.
//!
//! Platform notes, said plainly in the app: on Windows a camera is normally held by Windows' own camera driver (WPD),
//! so this link only works with a WinUSB driver bound to it; on macOS the system's camera service (ptpcamerad) may hold
//! it while Photos or Image Capture is open. Linux works once the person can open the device.

use nusb::descriptors::TransferType;
use nusb::transfer::{Bulk, Direction, In, Interrupt, Out};
use nusb::MaybeFuture;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

const STILL_IMAGE_CLASS: u8 = 6;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CameraInfo {
    /// Stable for as long as the camera stays plugged in.
    pub id: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
}

fn device_key(info: &nusb::DeviceInfo) -> String {
    format!("{:?}", info.id())
}

fn still_image_interface(info: &nusb::DeviceInfo) -> Option<u8> {
    info.interfaces().find(|interface| interface.class() == STILL_IMAGE_CLASS && interface.subclass() == 1).map(|interface| interface.interface_number())
}

/// Cameras plugged in now that speak PTP over USB.
pub fn list() -> Result<Vec<CameraInfo>, String> {
    let devices = nusb::list_devices().wait().map_err(|error| format!("USB devices could not be listed: {error}"))?;
    Ok(devices
        .filter(|info| still_image_interface(info).is_some())
        .map(|info| CameraInfo {
            id: device_key(&info),
            vendor_id: info.vendor_id(),
            product_id: info.product_id(),
            manufacturer: info.manufacturer_string().map(str::to_string),
            product: info.product_string().map(str::to_string),
        })
        .collect())
}

pub struct PtpUsb {
    _interface: nusb::Interface,
    out: nusb::Endpoint<Bulk, Out>,
    inp: nusb::Endpoint<Bulk, In>,
    event: Option<nusb::Endpoint<Interrupt, In>>,
    out_packet: usize,
}

pub fn open(id: &str) -> Result<PtpUsb, String> {
    let devices = nusb::list_devices().wait().map_err(|error| format!("USB devices could not be listed: {error}"))?;
    let info = devices.into_iter().find(|info| device_key(info) == id).ok_or_else(|| "The camera is no longer connected.".to_string())?;
    let number = still_image_interface(&info).ok_or_else(|| "This device is not a camera InFlight can talk to.".to_string())?;
    let device = info.open().wait().map_err(|error| busy_reason(&error.to_string()))?;
    let interface = device.detach_and_claim_interface(number).wait().map_err(|error| busy_reason(&error.to_string()))?;
    let descriptor = interface.descriptor().ok_or_else(|| "The camera did not describe its connection.".to_string())?;
    let (mut bulk_out, mut bulk_in, mut interrupt_in) = (None, None, None);
    for endpoint in descriptor.endpoints() {
        match (endpoint.transfer_type(), endpoint.direction()) {
            (TransferType::Bulk, Direction::Out) if bulk_out.is_none() => bulk_out = Some((endpoint.address(), endpoint.max_packet_size())),
            (TransferType::Bulk, Direction::In) if bulk_in.is_none() => bulk_in = Some(endpoint.address()),
            (TransferType::Interrupt, Direction::In) if interrupt_in.is_none() => interrupt_in = Some(endpoint.address()),
            _ => {}
        }
    }
    let ((out_address, out_packet), in_address) = bulk_out.zip(bulk_in).ok_or_else(|| "The camera's USB connection is missing a data channel.".to_string())?;
    let out = interface.endpoint::<Bulk, Out>(out_address).map_err(|error| error.to_string())?;
    let inp = interface.endpoint::<Bulk, In>(in_address).map_err(|error| error.to_string())?;
    let event = interrupt_in.and_then(|address| interface.endpoint::<Interrupt, In>(address).ok());
    Ok(PtpUsb { _interface: interface, out, inp, event, out_packet: out_packet.max(1) })
}

fn busy_reason(detail: &str) -> String {
    format!("The camera is in use by another app or by the system's own camera driver. Close the maker's tether app, Photos or Image Capture, then try again. ({detail})")
}

impl PtpUsb {
    pub fn has_events(&self) -> bool { self.event.is_some() }

    pub fn write(&mut self, bytes: Vec<u8>, timeout: Duration) -> Result<(), String> {
        let ends_on_packet = !bytes.is_empty() && bytes.len() % self.out_packet == 0;
        self.out.submit(bytes.into());
        let done = self.out.wait_next_complete(timeout).ok_or_else(|| { self.out.cancel_all(); "The camera stopped listening.".to_string() })?;
        done.status.map_err(|error| format!("Sending to the camera failed: {error}"))?;
        if ends_on_packet {
            // USB: a transfer that ends exactly on a packet boundary is closed with a zero-length packet.
            self.out.submit(Vec::<u8>::new().into());
            if let Some(done) = self.out.wait_next_complete(timeout) { done.status.map_err(|error| format!("Sending to the camera failed: {error}"))?; }
        }
        Ok(())
    }

    /// One bulk-in transfer (up to a short packet or `max` bytes).
    pub fn read(&mut self, max: usize, timeout: Duration) -> Result<Vec<u8>, String> {
        let packet = self.inp.max_packet_size().max(1);
        let length = max.max(packet).div_ceil(packet) * packet;
        let buffer = self.inp.allocate(length);
        self.inp.submit(buffer);
        match self.inp.wait_next_complete(timeout) {
            Some(done) => { done.status.map_err(|error| format!("Reading from the camera failed: {error}"))?; Ok(done.buffer.into_vec()) }
            None => {
                self.inp.cancel_all();
                let _ = self.inp.wait_next_complete(Duration::from_secs(1));
                Err("The camera took too long to answer.".to_string())
            }
        }
    }

    /// One event packet, or None when the camera said nothing within `timeout`.
    pub fn read_event(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String> {
        let Some(event) = self.event.as_mut() else { return Ok(None) };
        if event.pending() == 0 {
            let buffer = event.allocate(event.max_packet_size().max(64));
            event.submit(buffer);
        }
        // An unanswered event read stays queued for the next look, so no event is lost between looks.
        match event.wait_next_complete(timeout) {
            Some(done) => { done.status.map_err(|error| format!("The camera's event channel failed: {error}"))?; Ok(Some(done.buffer.into_vec())) }
            None => Ok(None),
        }
    }
}

/// A file name safe to create in the folder: the last path part only, no characters Windows refuses.
pub fn safe_name(requested: &str) -> Option<String> {
    let last = requested.rsplit(['/', '\\']).next()?.trim();
    let cleaned: String = last.chars().filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')).collect();
    let cleaned = cleaned.trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() || cleaned.len() > 200 { None } else { Some(cleaned) }
}

/// A path in `folder` for `name` that does not exist yet: a frame already there is never overwritten.
pub fn free_path(folder: &Path, name: &str) -> PathBuf {
    let taken = |candidate: &str| folder.join(candidate).exists() || folder.join(format!("{candidate}.part")).exists();
    if !taken(name) { return folder.join(name); }
    let (stem, extension) = match name.rsplit_once('.') { Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")), _ => (name, String::new()) };
    for index in 2..10_000 {
        let next = format!("{stem} ({index}){extension}");
        if !taken(&next) { return folder.join(next); }
    }
    folder.join(format!("{stem} ({}){extension}", std::process::id()))
}

/// Write one frame into the live-shoot folder: `name.part` first, renamed once every byte is on disk.
pub fn save_frame(folder: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = safe_name(name).ok_or_else(|| "The camera gave the photo a name InFlight cannot use.".to_string())?;
    fs::create_dir_all(folder).map_err(|error| format!("The tether folder could not be made: {error}"))?;
    let path = free_path(folder, &name);
    let partial = PathBuf::from(format!("{}.part", path.display()));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&partial)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&partial, &path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&partial);
        return Err(format!("The photo could not be saved: {error}"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_saved_whole_and_never_overwrite() {
        let folder = std::env::temp_dir().join(format!("inflight-tether-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        let first = save_frame(&folder, "DSC_0001.NEF", b"one").unwrap();
        let second = save_frame(&folder, "../DSC_0001.NEF", b"two").unwrap();
        assert_eq!(first.file_name().unwrap(), "DSC_0001.NEF");
        assert_eq!(second.file_name().unwrap(), "DSC_0001 (2).NEF");
        assert_eq!(fs::read(&first).unwrap(), b"one");
        assert_eq!(fs::read(&second).unwrap(), b"two");
        assert!(!folder.join("DSC_0001.NEF.part").exists());
        assert!(save_frame(&folder, "..", b"x").is_err());
        fs::remove_dir_all(&folder).unwrap();
    }
}
