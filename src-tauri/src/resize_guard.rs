//! Remembers the last window size the iOS web view was made to fill, so the one-point nudge inside `fill_window`
//! (`ios_orientation.rs`) cannot start a loop of its own resize events. Plain arithmetic, so it is tested on any computer.

use std::sync::atomic::{AtomicUsize, Ordering};

/// The window size last seen, width in the high 32 bits and height in the low 32.
pub struct ResizeGuard(AtomicUsize);

impl ResizeGuard {
    pub const fn new() -> Self {
        Self(AtomicUsize::new(0))
    }

    /// True when `width` x `height` differs from the size seen last (and the first call), and remembers it.
    pub fn changed(&self, width: u32, height: u32) -> bool {
        let packed = ((width as usize) << 32) | height as usize;
        self.0.swap(packed, Ordering::Relaxed) != packed
    }
}

#[cfg(test)]
mod tests {
    use super::ResizeGuard;

    #[test]
    fn a_resize_to_the_same_size_does_not_run_again() {
        let guard = ResizeGuard::new();
        assert!(guard.changed(1206, 2622), "the first size is new");
        assert!(!guard.changed(1206, 2622), "the same size again is ignored");
        assert!(guard.changed(2622, 1206), "turning the phone is a new size");
        assert!(guard.changed(1206, 2622), "and turning back is new again");
    }

    #[test]
    fn width_and_height_are_not_confused() {
        let guard = ResizeGuard::new();
        assert!(guard.changed(100, 200));
        assert!(guard.changed(200, 100), "swapped dimensions are a different size");
    }
}
