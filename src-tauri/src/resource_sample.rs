//! The machine's free memory and CPU load, for the task scheduler (src/core/engineScheduler.ts, resourcePolicy.ts).
//!
//! Without a measurement the scheduler runs one heavy job at a time, so one slow or stuck job held up every other task.
//! With one, it admits a second or third heavy job only while the CPU has headroom and memory is free. Only whole-system
//! figures are read: nothing about other programs.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /** Whole-machine CPU use since the previous sample, 0 to 1. Absent on the first sample (no interval yet). */
    pub cpu: Option<f32>,
    pub available_memory_bytes: u64,
}

pub struct Sampler(Mutex<Option<System>>);

impl Default for Sampler { fn default() -> Self { Self::new() } }

impl Sampler {
    pub fn new() -> Self { Sampler(Mutex::new(None)) }

    /// None when the system figures can't be read here (then the scheduler keeps to one heavy job at a time).
    pub fn sample(&self) -> Option<Sample> {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let first = guard.is_none();
        if first {
            *guard = Some(System::new_with_specifics(
                RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_usage()).with_memory(MemoryRefreshKind::nothing().with_ram())).ok()?);
        }
        let system = guard.as_mut()?;
        system.refresh_cpu_usage();
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        let cpu = (!first).then(|| (system.global_cpu_usage() / 100.0).clamp(0.0, 1.0));
        Some(Sample { cpu, available_memory_bytes: system.available_memory() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_are_real_fractions_and_bytes() {
        let sampler = Sampler::new();
        let first = sampler.sample().expect("system figures");
        assert_eq!(first.cpu, None, "no CPU figure before there is an interval to measure");
        assert!(first.available_memory_bytes > 0);
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let second = sampler.sample().expect("system figures");
        let cpu = second.cpu.expect("a CPU figure once there is an interval");
        assert!((0.0..=1.0).contains(&cpu));
    }
}
