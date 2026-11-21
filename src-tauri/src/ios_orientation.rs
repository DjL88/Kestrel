//! Which way the screen may turn on iOS.
//!
//! An iPhone stays upright (portrait) except while a photo is shown full screen, when the person may turn the phone to
//! see a landscape photo bigger. An iPad is never limited: it turns freely and keeps the full workspace.
//!
//! The window library answers the system's "which orientations are allowed?" question from a fixed setting that the
//! app cannot change afterwards, so this replaces that one answer on the window's view controller with one that reads
//! a switch. The page flips the switch through the `set_landscape_allowed` command (`src/providers/orientationLock.ts`).
//! `Info.plist` allows landscape for iPhone so the system never blocks it; this is what keeps the phone upright.

use std::mem;
use std::sync::atomic::{AtomicUsize, Ordering};

use objc2::runtime::{AnyObject, Sel};
use objc2::{class, msg_send, Encode, Encoding, RefEncode};

// UIInterfaceOrientationMask bits.
const PORTRAIT: usize = 1 << 1;
const PORTRAIT_UPSIDE_DOWN: usize = 1 << 2;
const LANDSCAPE: usize = (1 << 3) | (1 << 4);
const ALL: usize = PORTRAIT | PORTRAIT_UPSIDE_DOWN | LANDSCAPE;

/// What the replaced `supportedInterfaceOrientations` answers. Upright until the page says otherwise.
static MASK: AtomicUsize = AtomicUsize::new(PORTRAIT);

extern "C" fn supported_orientations(_this: &AnyObject, _cmd: Sel) -> usize {
    MASK.load(Ordering::Relaxed)
}

/// Allow (or stop allowing) landscape, and turn the screen to match.
///
/// # Safety
/// `view_controller` must be the window's live `UIViewController`, and this must run on the main thread
/// (`with_webview` guarantees both).
pub unsafe fn apply(view_controller: *mut AnyObject, landscape_allowed: bool) {
    if view_controller.is_null() {
        return;
    }
    let device: *mut AnyObject = msg_send![class!(UIDevice), currentDevice];
    let idiom: isize = msg_send![device, userInterfaceIdiom];
    let is_pad = idiom == 1; // UIUserInterfaceIdiomPad
    let mask = if is_pad {
        ALL
    } else if landscape_allowed {
        PORTRAIT | LANDSCAPE
    } else {
        PORTRAIT
    };
    MASK.store(mask, Ordering::Relaxed);

    // Replace the answer on this view controller's class (adds it when the class inherits it).
    let class = objc2::ffi::object_getClass(view_controller.cast());
    let implementation = mem::transmute::<extern "C" fn(&AnyObject, Sel) -> usize, unsafe extern "C-unwind" fn()>(supported_orientations);
    let selector = objc2::ffi::sel_registerName(c"supportedInterfaceOrientations".as_ptr());
    objc2::ffi::class_replaceMethod(class.cast_mut(), selector.expect("the selector name is a valid C string"), implementation, c"Q@:".as_ptr());
    let _: () = msg_send![view_controller, setNeedsUpdateOfSupportedInterfaceOrientations];

    // Ask the window scene to turn to an allowed orientation now (back upright when landscape is switched off).
    let view: *mut AnyObject = msg_send![view_controller, view];
    if view.is_null() {
        return;
    }
    let window: *mut AnyObject = msg_send![view, window];
    if window.is_null() {
        return;
    }
    let scene: *mut AnyObject = msg_send![window, windowScene];
    if scene.is_null() {
        return;
    }
    let allocated: *mut AnyObject = msg_send![class!(UIWindowSceneGeometryPreferencesIOS), alloc];
    let preferences: *mut AnyObject = msg_send![allocated, initWithInterfaceOrientations: mask];
    let no_handler: *mut AnyObject = std::ptr::null_mut();
    let _: () = msg_send![scene, requestGeometryUpdateWithPreferences: preferences, errorHandler: no_handler];
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Point { x: f64, y: f64 }
#[repr(C)]
#[derive(Clone, Copy)]
struct Size { width: f64, height: f64 }
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect { origin: Point, size: Size }
// SAFETY: these match CoreGraphics' CGPoint, CGSize and CGRect (two f64s each) on 64-bit iOS.
unsafe impl Encode for Point { const ENCODING: Encoding = Encoding::Struct("CGPoint", &[Encoding::Double, Encoding::Double]); }
unsafe impl Encode for Size { const ENCODING: Encoding = Encoding::Struct("CGSize", &[Encoding::Double, Encoding::Double]); }
unsafe impl Encode for Rect { const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]); }
unsafe impl RefEncode for Rect { const ENCODING_REF: Encoding = Encoding::Pointer(&Rect::ENCODING); }

#[repr(C)]
#[derive(Clone, Copy)]
struct Insets { top: f64, left: f64, bottom: f64, right: f64 }
// SAFETY: matches UIEdgeInsets (four f64s) on 64-bit iOS.
unsafe impl Encode for Insets { const ENCODING: Encoding = Encoding::Struct("UIEdgeInsets", &[Encoding::Double, Encoding::Double, Encoding::Double, Encoding::Double]); }

/// Make the web view cover the whole window.
///
/// The web view's frame was already the whole window, but the page inside measured 96 pt short (778 pt on an 874 pt
/// screen: the two safe areas), so the footer floated above an empty band. Zeroing the scroll view's insets and then
/// nudging the frame by a point makes the page measure itself again at full height. The page pads for the safe areas
/// itself (`env(safe-area-inset-*)`).
///
/// # Safety
/// `web_view` must be the live `WKWebView`, and this must run on the main thread (`with_webview` guarantees both).
pub unsafe fn fill_window(web_view: *mut AnyObject) {
    if web_view.is_null() {
        return;
    }
    let window: *mut AnyObject = msg_send![web_view, window];
    if window.is_null() {
        return;
    }
    let bounds: Rect = msg_send![window, bounds];
    let _: () = msg_send![web_view, setFrame: bounds];
    // UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight
    let _: () = msg_send![web_view, setAutoresizingMask: 18usize];
    // The page does its own safe-area padding, so the scroll view must not add a second inset.
    let scroll_view: *mut AnyObject = msg_send![web_view, scrollView];
    let _: () = msg_send![scroll_view, setContentInsetAdjustmentBehavior: 2isize]; // UIScrollViewContentInsetAdjustmentNever
    let zero = Insets { top: 0.0, left: 0.0, bottom: 0.0, right: 0.0 };
    let _: () = msg_send![scroll_view, setContentInset: zero];
    let _: () = msg_send![scroll_view, setScrollIndicatorInsets: zero];
    // The page only re-measures when the view's size changes, so nudge it by a point and put it back.
    let nudged = Rect { origin: bounds.origin, size: Size { width: bounds.size.width, height: bounds.size.height - 1.0 } };
    let _: () = msg_send![web_view, setFrame: nudged];
    let _: () = msg_send![web_view, setFrame: bounds];
    let _: () = msg_send![web_view, layoutIfNeeded];
    // The edge swipe becomes the page's Back, so a dialog that listens for it (useBackToClose) closes like on Android.
    let _: () = msg_send![web_view, setAllowsBackForwardNavigationGestures: true];
}

