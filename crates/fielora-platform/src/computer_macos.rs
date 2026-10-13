//! Fixed macOS Accessibility / CoreGraphics adapter. Native handles never cross
//! the tool boundary or survive an operation. No AppleScript or arbitrary code.
use super::*;
use std::ffi::{CStr, c_char, c_void};
use std::ptr;

type Ref = *const c_void;
type Obj = *mut c_void;
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect {
    origin: Point,
    size: Size,
}
#[repr(C)]
struct Range {
    location: isize,
    length: isize,
}
#[repr(C)]
#[derive(Default)]
struct ProcessSerialNumber {
    high: u32,
    low: u32,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: Ref);
    fn CFRetain(value: Ref) -> Ref;
    fn CFGetTypeID(value: Ref) -> usize;
    fn CFHash(value: Ref) -> usize;
    fn CFEqual(a: Ref, b: Ref) -> u8;
    fn CFStringGetTypeID() -> usize;
    fn CFStringCreateWithCString(allocator: Ref, text: *const c_char, encoding: u32) -> Ref;
    fn CFStringGetLength(value: Ref) -> isize;
    fn CFStringGetBytes(
        value: Ref,
        range: Range,
        encoding: u32,
        loss: u8,
        external: u8,
        buffer: *mut u8,
        size: isize,
        used: *mut isize,
    ) -> isize;
    fn CFArrayGetCount(value: Ref) -> isize;
    fn CFArrayGetValueAtIndex(value: Ref, index: isize) -> Ref;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: Ref) -> u8;
    fn CFDictionaryGetValue(value: Ref, key: Ref) -> Ref;
}
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn GetCurrentProcess(process: *mut ProcessSerialNumber) -> i16;
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> Ref;
    fn AXUIElementCreateSystemWide() -> Ref;
    fn AXUIElementGetTypeID() -> usize;
    fn AXUIElementGetPid(element: Ref, pid: *mut i32) -> i32;
    fn AXUIElementSetMessagingTimeout(element: Ref, seconds: f32) -> i32;
    fn AXUIElementCopyAttributeValue(element: Ref, name: Ref, value: *mut Ref) -> i32;
    fn AXUIElementGetAttributeValueCount(element: Ref, name: Ref, count: *mut isize) -> i32;
    fn AXUIElementCopyAttributeValues(
        element: Ref,
        name: Ref,
        index: isize,
        max: isize,
        values: *mut Ref,
    ) -> i32;
    fn AXUIElementCopyElementAtPosition(element: Ref, x: f32, y: f32, result: *mut Ref) -> i32;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetValue(value: Ref, kind: u32, result: *mut c_void) -> bool;
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGPreflightPostEventAccess() -> bool;
    fn CGSessionCopyCurrentDictionary() -> Ref;
    fn CGEventCreateMouseEvent(source: Ref, kind: u32, position: Point, button: u32) -> Ref;
    fn CGEventCreateKeyboardEvent(source: Ref, key: u16, down: bool) -> Ref;
    fn CGEventKeyboardSetUnicodeString(event: Ref, length: usize, text: *const u16);
    fn CGEventSetFlags(event: Ref, flags: u64);
    fn CGEventSetLocation(event: Ref, position: Point);
    fn CGEventCreateScrollWheelEvent(source: Ref, units: u32, wheels: u32, ...) -> Ref;
    fn CGEventPost(tap: u32, event: Ref);
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> Rect;
}
// AppKit is needed only for application identity and activation. AX and CGEvent
// are C APIs and are invoked on the serialized blocking worker, never Renderer.
#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}
#[link(name = "SystemConfiguration", kind = "framework")]
unsafe extern "C" {
    fn SCDynamicStoreCopyConsoleUser(store: Ref, uid: *mut u32, gid: *mut u32) -> Ref;
}
#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> Obj;
    fn sel_registerName(name: *const c_char) -> Obj;
    fn objc_msgSend();
    fn objc_autoreleasePoolPush() -> Obj;
    fn objc_autoreleasePoolPop(pool: Obj);
}

struct Owned(Ref);
impl Owned {
    fn new(value: Ref) -> Option<Self> {
        // Construct lazily: then_some evaluates and drops Self(NULL) even when
        // false, and CoreFoundation deliberately traps CFRelease(NULL).
        (!value.is_null()).then(|| Self(value))
    }
    fn retained(value: Ref) -> Option<Self> {
        Self::new(value).inspect(|v| unsafe {
            CFRetain(v.0);
        })
    }
}
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.0);
        }
    }
}
struct Pool(Obj);
impl Pool {
    fn new() -> Self {
        Self(unsafe { objc_autoreleasePoolPush() })
    }
}
impl Drop for Pool {
    fn drop(&mut self) {
        unsafe {
            objc_autoreleasePoolPop(self.0);
        }
    }
}

// Each objc_msgSend cast matches the specific Objective-C method signature.
fn id(object: Obj, selector: &CStr) -> Obj {
    if object.is_null() {
        return ptr::null_mut();
    }
    let call: unsafe extern "C" fn(Obj, Obj) -> Obj =
        unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    unsafe { call(object, sel_registerName(selector.as_ptr())) }
}
fn int(object: Obj, selector: &CStr) -> i32 {
    let call: unsafe extern "C" fn(Obj, Obj) -> i32 =
        unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    unsafe { call(object, sel_registerName(selector.as_ptr())) }
}
fn usize_value(object: Obj, selector: &CStr) -> usize {
    let call: unsafe extern "C" fn(Obj, Obj) -> usize =
        unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    unsafe { call(object, sel_registerName(selector.as_ptr())) }
}
fn bool_value(object: Obj, selector: &CStr) -> bool {
    if object.is_null() {
        return false;
    }
    let call: unsafe extern "C" fn(Obj, Obj) -> bool =
        unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    unsafe { call(object, sel_registerName(selector.as_ptr())) }
}
fn string(value: Ref, max: usize) -> String {
    if value.is_null() || unsafe { CFGetTypeID(value) != CFStringGetTypeID() } {
        return String::new();
    }
    let mut bytes = vec![0; max];
    let mut used = 0;
    unsafe {
        CFStringGetBytes(
            value,
            Range {
                location: 0,
                length: CFStringGetLength(value),
            },
            0x0800_0100,
            b'?',
            0,
            bytes.as_mut_ptr(),
            max as isize,
            &mut used,
        );
    }
    bytes.truncate(used.max(0) as usize);
    String::from_utf8_lossy(&bytes).into_owned()
}
fn cfstring(value: &str) -> Owned {
    let value = std::ffi::CString::new(value).expect("fixed AX attribute has no NUL");
    Owned::new(unsafe { CFStringCreateWithCString(ptr::null(), value.as_ptr(), 0x0800_0100) })
        .expect("CFString allocation")
}
fn app(pid: i32) -> Obj {
    let class = unsafe { objc_getClass(c"NSRunningApplication".as_ptr()) };
    let call: unsafe extern "C" fn(Obj, Obj, i32) -> Obj =
        unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    unsafe {
        call(
            class,
            sel_registerName(c"runningApplicationWithProcessIdentifier:".as_ptr()),
            pid,
        )
    }
}

fn process_launch_identity(pid: i32) -> Option<String> {
    if pid <= 0 {
        return None;
    }
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>();
    let copied = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size as i32,
        )
    };
    if copied != size as i32 {
        return None;
    }
    let info = unsafe { info.assume_init() };
    if info.pbi_pid != pid as u32 || info.pbi_start_tvsec == 0 || info.pbi_start_tvusec >= 1_000_000
    {
        return None;
    }
    Some(format!(
        "kernel:{}:{:06}",
        info.pbi_start_tvsec, info.pbi_start_tvusec
    ))
}

fn identity(application: Obj) -> Option<ComputerTarget> {
    if application.is_null() || bool_value(application, c"isTerminated") {
        return None;
    }
    let pid = int(application, c"processIdentifier");
    // NSRunningApplication.launchDate is absent for apps launched without
    // LaunchServices, including Electron development hosts. Kernel start time
    // binds both launch routes without ever falling back to reusable PID alone.
    let launch_identity = process_launch_identity(pid)?;
    let name = string(id(application, c"localizedName").cast_const(), 256);
    let bundle_id = string(id(application, c"bundleIdentifier").cast_const(), 256);
    let executable = string(
        id(id(application, c"executableURL"), c"path").cast_const(),
        4096,
    );
    if executable.is_empty() {
        return None;
    }
    // Do not combine cached application properties with a recycled process ID.
    if process_launch_identity(pid).as_deref() != Some(launch_identity.as_str()) {
        return None;
    }
    Some(ComputerTarget {
        app_id: pid.to_string(),
        pid,
        name,
        bundle_id,
        executable,
        launch_identity,
    })
}
fn applications() -> Vec<ComputerTarget> {
    let workspace = id(
        unsafe { objc_getClass(c"NSWorkspace".as_ptr()) },
        c"sharedWorkspace",
    );
    let array = id(workspace, c"runningApplications");
    if array.is_null() {
        return vec![];
    }
    let count = usize_value(array, c"count").min(256);
    let index: unsafe extern "C" fn(Obj, Obj, usize) -> Obj =
        unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    (0..count)
        .filter_map(|i| {
            let application =
                unsafe { index(array, sel_registerName(c"objectAtIndex:".as_ptr()), i) };
            if int(application, c"activationPolicy") > 1 {
                return None;
            }
            identity(application)
        })
        .collect()
}

pub fn status() -> Value {
    let _pool = Pool::new();
    let apps = applications()
        .into_iter()
        .map(|target| {
            let protected = protected_target(&target);
            json!({"target":target,"protected":protected})
        })
        .collect::<Vec<_>>();
    let ax = unsafe { AXIsProcessTrusted() };
    let post = unsafe { CGPreflightPostEventAccess() };
    json!({"platform":"macos","backend":"MACOS_AX_CGEVENT","available":ax,
        "accessibility":if ax { "GRANTED" } else { "REQUIRED" },
        "input_permission":if post { "GRANTED" } else { "REQUIRED" },
        "screen_recording":if unsafe { CGPreflightScreenCaptureAccess() } { "GRANTED" } else { "REQUIRED" },
        "interactive_desktop":interactive_desktop(),"screenshots":"UNSUPPORTED",
        "applications":apps,"application_limit":256,"content_observed":false,
        "guidance":"Application identities only. macOS Accessibility must be granted by the human to the actual packaged application. Product Full control cannot grant OS permission. Target content requires Harness approval for this task, application and model service."})
}
pub fn prepare_target(app_id: &str) -> Result<ComputerTarget> {
    let _pool = Pool::new();
    let matches = if let Ok(pid) = app_id.parse::<i32>() {
        identity(app(pid)).into_iter().collect::<Vec<_>>()
    } else {
        applications()
            .into_iter()
            .filter(|a| a.bundle_id == app_id)
            .collect::<Vec<_>>()
    };
    if matches.len() != 1 {
        return Err(ComputerError::known(if matches.is_empty() {
            "COMPUTER_APP_NOT_FOUND"
        } else {
            "COMPUTER_TARGET_AMBIGUOUS"
        }));
    }
    let target = matches.into_iter().next().unwrap();
    if protected_target(&target) {
        return Err(ComputerError::known("COMPUTER_PROTECTED_APPLICATION"));
    }
    Ok(target)
}
fn protected_target(target: &ComputerTarget) -> bool {
    // The Core is supervised directly by Electron Main. Protect both production
    // Fielora and its development Electron parent from self-approval by input.
    protected_application(target) || target.pid == unsafe { libc::getppid() }
}
fn interactive_desktop() -> bool {
    let Some(session) = Owned::new(unsafe { CGSessionCopyCurrentDictionary() }) else {
        return false;
    };
    let bool_at = |key: &str| {
        let key = cfstring(key);
        let value = unsafe { CFDictionaryGetValue(session.0, key.0) };
        !value.is_null()
            && unsafe {
                CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(value) != 0
            }
    };
    // Current macOS can omit kCGSessionOnConsoleKey. Missing metadata is not a
    // locked-screen fact; independently match the active console UID instead.
    let mut uid = u32::MAX;
    let console = Owned::new(unsafe {
        SCDynamicStoreCopyConsoleUser(ptr::null(), &mut uid, ptr::null_mut())
    });
    console.is_some()
        && uid == unsafe { libc::geteuid() }
        && !bool_at("CGSSessionScreenIsLocked")
        && bool_at("kCGSessionLoginDoneKey")
}
fn preflight(target: &ComputerTarget, input: bool, cancelled: &dyn Fn() -> bool) -> Result<()> {
    if cancelled() {
        return Err(ComputerError::known("COMPUTER_CANCELLED"));
    }
    if prepare_target(&target.app_id)? != *target {
        return Err(ComputerError::known("COMPUTER_TARGET_CHANGED"));
    }
    if !unsafe { AXIsProcessTrusted() } {
        return Err(ComputerError::known("COMPUTER_ACCESSIBILITY_REQUIRED"));
    }
    if !interactive_desktop() {
        return Err(ComputerError::known("COMPUTER_DESKTOP_UNAVAILABLE"));
    }
    if input {
        if !unsafe { CGPreflightPostEventAccess() } {
            return Err(ComputerError::known("COMPUTER_INPUT_PERMISSION_REQUIRED"));
        }
        if !frontmost(target, cancelled)? {
            return Err(ComputerError::known("COMPUTER_FOCUS_CHANGED"));
        }
    }
    Ok(())
}

fn frontmost(target: &ComputerTarget, cancelled: &dyn Fn() -> bool) -> Result<bool> {
    // NSRunningApplication.isActive is updated through AppKit's main run loop.
    // Core's blocking worker has no AppKit loop; ask AX for current OS focus.
    Ok(focused_application_pid(|| preflight(target, false, cancelled))? == Some(target.pid))
}

fn focused_application_pid(mut validate: impl FnMut() -> Result<()>) -> Result<Option<i32>> {
    validate()?;
    // A CLI sidecar can link AppKit without checking in with Process Manager.
    // Then system-wide AX focus queries immediately return CannotComplete,
    // even while direct app AX reads work. Processes.h explicitly recommends
    // GetCurrentProcess to initialize that connection. This identity-only C
    // call neither activates an app nor depends on AppKit's cached properties.
    // Do not replace it with NSRunningApplication.currentApplication: that
    // replacement provides identity without the required process check-in.
    let mut process = ProcessSerialNumber::default();
    if unsafe { GetCurrentProcess(&mut process) } != 0 {
        return Err(ComputerError::known("COMPUTER_PROCESS_MANAGER_UNAVAILABLE"));
    }
    let system = Owned::new(unsafe { AXUIElementCreateSystemWide() })
        .ok_or_else(|| ComputerError::known("COMPUTER_AX_FAILURE"))?;
    let focused = checked_attribute(system.0, "AXFocusedApplication", validate)?;
    let Some(focused) = focused else {
        return Ok(None);
    };
    if !ax(focused.0) {
        return Err(ComputerError::known("COMPUTER_AX_UNEXPECTED_TYPE"));
    }
    Ok(pid(focused.0))
}

fn attribute(element: Ref, name: &str) -> Option<Owned> {
    let key = cfstring(name);
    let mut value = ptr::null();
    if unsafe { AXUIElementCopyAttributeValue(element, key.0, &mut value) } != 0 {
        return None;
    }
    Owned::new(value)
}

fn ax_read_error(code: i32) -> ComputerError {
    ComputerError::known(match code {
        -25200 => "COMPUTER_AX_FAILURE",
        -25201 => "COMPUTER_AX_ILLEGAL_ARGUMENT",
        -25202 => "COMPUTER_AX_INVALID_ELEMENT",
        -25204 => "COMPUTER_AX_CANNOT_COMPLETE",
        -25205 => "COMPUTER_AX_ATTRIBUTE_UNSUPPORTED",
        -25208 => "COMPUTER_AX_NOT_IMPLEMENTED",
        -25211 => "COMPUTER_ACCESSIBILITY_REQUIRED",
        _ => "COMPUTER_AX_READ_FAILED",
    })
}

fn retry_ax_read<T>(
    mut read: impl FnMut() -> std::result::Result<Option<T>, i32>,
    mut validate: impl FnMut() -> Result<()>,
) -> Result<Option<T>> {
    // AXError.h defines CannotComplete as a messaging failure or a busy
    // application. Retry only the read, at most twice; never retry OS input,
    // NoValue, invalid references or actual target/focus changes.
    for attempt in 0..3 {
        validate()?;
        let result = read();
        validate()?;
        match result {
            Ok(value) => return Ok(value),
            Err(-25212) => return Ok(None),
            Err(-25204) if attempt < 2 => std::thread::sleep(Duration::from_millis(20)),
            Err(code) => return Err(ax_read_error(code)),
        }
    }
    unreachable!("three bounded AX reads always return")
}

fn checked_attribute(
    element: Ref,
    name: &str,
    validate: impl FnMut() -> Result<()>,
) -> Result<Option<Owned>> {
    // For a system-wide AX ref this sets the current client process's default,
    // not an OS/user-wide policy. Every AX query in this native adapter must be
    // bounded even when a newly copied reference has no explicit timeout yet.
    let configured = unsafe { AXUIElementSetMessagingTimeout(element, 0.15) };
    if configured != 0 {
        return Err(ax_read_error(configured));
    }
    let key = cfstring(name);
    retry_ax_read(
        || {
            let mut value = ptr::null();
            let code = unsafe { AXUIElementCopyAttributeValue(element, key.0, &mut value) };
            let value = Owned::new(value);
            if code == 0 { Ok(value) } else { Err(code) }
        },
        validate,
    )
}

fn text(element: Ref, name: &str, max: usize) -> String {
    attribute(element, name).map_or_else(String::new, |v| string(v.0, max))
}
fn boolean(element: Ref, name: &str, default: bool) -> bool {
    attribute(element, name).map_or(default, |v| {
        if unsafe { CFGetTypeID(v.0) == CFBooleanGetTypeID() } {
            unsafe { CFBooleanGetValue(v.0) != 0 }
        } else {
            default
        }
    })
}
fn token(element: Ref) -> u64 {
    unsafe { CFHash(element) as u64 }
}
fn pid(element: Ref) -> Option<i32> {
    let mut pid = 0;
    (unsafe { AXUIElementGetPid(element, &mut pid) } == 0).then_some(pid)
}
fn ax(element: Ref) -> bool {
    !element.is_null() && unsafe { CFGetTypeID(element) == AXUIElementGetTypeID() }
}
fn bounds(element: Ref) -> Option<[f64; 4]> {
    let position = attribute(element, "AXPosition")?;
    let size = attribute(element, "AXSize")?;
    if unsafe {
        CFGetTypeID(position.0) != AXValueGetTypeID() || CFGetTypeID(size.0) != AXValueGetTypeID()
    } {
        return None;
    }
    let mut point = Point::default();
    let mut extent = Size::default();
    if !unsafe {
        AXValueGetValue(position.0, 1, (&mut point as *mut Point).cast())
            && AXValueGetValue(size.0, 2, (&mut extent as *mut Size).cast())
    } {
        return None;
    }
    let values = [point.x, point.y, extent.width, extent.height];
    (values.iter().all(|v| v.is_finite()) && extent.width > 0. && extent.height > 0.)
        .then_some(values)
}
fn root(
    target: &ComputerTarget,
    input: bool,
    cancelled: &dyn Fn() -> bool,
) -> Result<(Owned, Owned)> {
    let application = Owned::new(unsafe { AXUIElementCreateApplication(target.pid) })
        .ok_or_else(|| ComputerError::known("COMPUTER_APP_UNAVAILABLE"))?;
    let window = checked_attribute(application.0, "AXFocusedWindow", || {
        preflight(target, input, cancelled)
    })?
    .ok_or_else(|| ComputerError::known("COMPUTER_NO_FOCUSED_WINDOW"))?;
    if !ax(window.0) {
        return Err(ComputerError::known("COMPUTER_AX_UNEXPECTED_TYPE"));
    }
    if pid(window.0) != Some(target.pid) {
        return Err(ComputerError::known("COMPUTER_PROTECTED_TARGET"));
    }
    unsafe {
        AXUIElementSetMessagingTimeout(window.0, 0.15);
    }
    Ok((application, window))
}
fn children(element: Ref, max: usize) -> (Vec<Owned>, bool) {
    let key = cfstring("AXChildren");
    let mut count = 0;
    if unsafe { AXUIElementGetAttributeValueCount(element, key.0, &mut count) } != 0 || count <= 0 {
        return (vec![], false);
    }
    let limited = (count as usize).min(max);
    if limited == 0 {
        return (vec![], true);
    }
    let mut array = ptr::null();
    if unsafe { AXUIElementCopyAttributeValues(element, key.0, 0, limited as isize, &mut array) }
        != 0
    {
        return (vec![], true);
    }
    let Some(array) = Owned::new(array) else {
        return (vec![], true);
    };
    let len = unsafe { CFArrayGetCount(array.0) }.max(0) as usize;
    let result = (0..len.min(limited))
        .filter_map(|index| {
            let child = unsafe { CFArrayGetValueAtIndex(array.0, index as isize) };
            ax(child).then(|| Owned::retained(child)).flatten()
        })
        .collect();
    (result, count as usize > limited)
}
pub fn observe(target: &ComputerTarget, cancelled: &dyn Fn() -> bool) -> Result<Observation> {
    let _pool = Pool::new();
    preflight(target, false, cancelled)?;
    let (application, window) = root(target, false, cancelled)?;
    let focused = checked_attribute(application.0, "AXFocusedUIElement", || {
        preflight(target, false, cancelled)
    })?
    .filter(|v| ax(v.0) && pid(v.0) == Some(target.pid))
    .map(|v| token(v.0));
    let window_token = token(window.0);
    let mut elements = Vec::new();
    let mut queue = std::collections::VecDeque::from([(window, vec![])]);
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut bytes = 0;
    let mut truncated = false;
    while let Some((element, path)) = queue.pop_front() {
        if cancelled() {
            return Err(ComputerError::known("COMPUTER_CANCELLED"));
        }
        if elements.len() >= MAX_ELEMENTS || Instant::now() >= deadline || bytes >= MAX_TEXT_BYTES {
            truncated = true;
            break;
        }
        if pid(element.0) != Some(target.pid) {
            truncated = true;
            continue;
        }
        unsafe {
            AXUIElementSetMessagingTimeout(element.0, 0.15);
        }
        let role = text(element.0, "AXRole", 80);
        let subrole = text(element.0, "AXSubrole", 100);
        let protected = subrole == "AXSecureTextField" || role == "AXSecureTextField";
        let budget = MAX_TEXT_BYTES.saturating_sub(bytes);
        let title = text(element.0, "AXTitle", budget.min(512));
        let label = if title.is_empty() {
            text(element.0, "AXDescription", budget.min(512))
        } else {
            title
        };
        bytes += label.len();
        let value = if protected {
            String::new()
        } else {
            text(
                element.0,
                "AXValue",
                MAX_TEXT_BYTES.saturating_sub(bytes).min(2048),
            )
        };
        bytes += value.len();
        let current_token = token(element.0);
        elements.push(Element {
            reference: format!("e{}", elements.len()),
            role,
            label,
            value,
            enabled: boolean(element.0, "AXEnabled", true),
            focused: focused == Some(current_token),
            protected,
            bounds: bounds(element.0),
            path: path.clone(),
            token: current_token,
        });
        if path.len() < 12 && !protected {
            let (nodes, omitted) = children(
                element.0,
                MAX_ELEMENTS.saturating_sub(elements.len() + queue.len()),
            );
            truncated |= omitted;
            for (index, child) in nodes.into_iter().enumerate() {
                let mut child_path = path.clone();
                child_path.push(index);
                queue.push_back((child, child_path));
            }
        } else if !protected {
            truncated = true;
        }
    }
    preflight(target, false, cancelled)?;
    let (_, current_window) = root(target, false, cancelled)?;
    if token(current_window.0) != window_token {
        return Err(ComputerError::known("COMPUTER_TARGET_CHANGED"));
    }
    Ok(Observation {
        target: target.clone(),
        window_token,
        elements,
        truncated,
        frontmost: frontmost(target, cancelled)?,
        focused_token: focused,
    })
}
pub fn activate(target: &ComputerTarget, cancelled: &dyn Fn() -> bool) -> Result<()> {
    let _pool = Pool::new();
    preflight(target, false, cancelled)?;
    let call: unsafe extern "C" fn(Obj, Obj, usize) -> bool =
        unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    if !unsafe {
        call(
            app(target.pid),
            sel_registerName(c"activateWithOptions:".as_ptr()),
            2,
        )
    } {
        return Err(ComputerError::known("COMPUTER_ACTIVATION_REFUSED"));
    }
    let deadline = Instant::now() + Duration::from_millis(800);
    while !frontmost(target, cancelled).map_err(|error| ComputerError::unknown(error.code()))? {
        if cancelled() {
            return Err(ComputerError::unknown("COMPUTER_CANCELLED_AFTER_INPUT"));
        }
        if Instant::now() >= deadline {
            return Err(ComputerError::unknown("COMPUTER_ACTIVATION_UNCONFIRMED"));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}
fn locate(window: Ref, path: &[usize]) -> Result<Owned> {
    let mut current = Owned::retained(window).unwrap();
    for index in path {
        let key = cfstring("AXChildren");
        let mut array = ptr::null();
        if unsafe {
            AXUIElementCopyAttributeValues(current.0, key.0, *index as isize, 1, &mut array)
        } != 0
        {
            return Err(ComputerError::known("COMPUTER_STALE_REFERENCE"));
        }
        let array =
            Owned::new(array).ok_or_else(|| ComputerError::known("COMPUTER_STALE_REFERENCE"))?;
        if unsafe { CFArrayGetCount(array.0) } != 1 {
            return Err(ComputerError::known("COMPUTER_STALE_REFERENCE"));
        }
        let element = unsafe { CFArrayGetValueAtIndex(array.0, 0) };
        if !ax(element) {
            return Err(ComputerError::known("COMPUTER_STALE_REFERENCE"));
        }
        current = Owned::retained(element).unwrap();
    }
    Ok(current)
}
fn hit_point(element: Ref, target: &ComputerTarget, bound: [f64; 4]) -> Result<Point> {
    let point = Point {
        x: bound[0] + bound[2] / 2.,
        y: bound[1] + bound[3] / 2.,
    };
    let mut displays = [0; 16];
    let mut count = 0;
    let on_screen = unsafe { CGGetActiveDisplayList(16, displays.as_mut_ptr(), &mut count) } == 0
        && displays[..(count as usize).min(16)].iter().any(|d| {
            let rect = unsafe { CGDisplayBounds(*d) };
            point.x >= rect.origin.x
                && point.x < rect.origin.x + rect.size.width
                && point.y >= rect.origin.y
                && point.y < rect.origin.y + rect.size.height
        });
    if !on_screen {
        return Err(ComputerError::known("COMPUTER_TARGET_OFFSCREEN"));
    }
    let system = Owned::new(unsafe { AXUIElementCreateSystemWide() })
        .ok_or_else(|| ComputerError::known("COMPUTER_TARGET_UNAVAILABLE"))?;
    let mut found = ptr::null();
    if unsafe {
        AXUIElementCopyElementAtPosition(system.0, point.x as f32, point.y as f32, &mut found)
    } != 0
    {
        return Err(ComputerError::known("COMPUTER_TARGET_OCCLUDED"));
    }
    let mut hit =
        Owned::new(found).ok_or_else(|| ComputerError::known("COMPUTER_TARGET_OCCLUDED"))?;
    // An observed button may be hit through its static-text child, but never
    // through a different process/window or an unrelated overlapping element.
    for _ in 0..8 {
        if pid(hit.0) != Some(target.pid) {
            break;
        }
        if unsafe { CFEqual(hit.0, element) != 0 } {
            return Ok(point);
        }
        let Some(parent) = attribute(hit.0, "AXParent").filter(|v| ax(v.0)) else {
            break;
        };
        hit = parent;
    }
    Err(ComputerError::known("COMPUTER_TARGET_OCCLUDED"))
}
fn event(value: Ref) -> Result<Owned> {
    Owned::new(value).ok_or_else(|| ComputerError::known("COMPUTER_EVENT_UNAVAILABLE"))
}
fn post_pair(down: &Owned, up: &Owned) {
    // No await/cancellation boundary between key/button down and release.
    unsafe {
        CGEventPost(0, down.0);
        CGEventPost(0, up.0);
    }
}
fn input_target(
    target: &ComputerTarget,
    current: &Observation,
    element: &Element,
    needs_focus: bool,
    cancelled: &dyn Fn() -> bool,
) -> Result<Owned> {
    preflight(target, true, cancelled)?;
    let (application, window) = root(target, true, cancelled)?;
    if token(window.0) != current.window_token {
        return Err(ComputerError::known("COMPUTER_TARGET_CHANGED"));
    }
    let live = locate(window.0, &element.path)?;
    if token(live.0) != element.token
        || bounds(live.0) != element.bounds
        || !boolean(live.0, "AXEnabled", true)
    {
        return Err(ComputerError::known("COMPUTER_STALE_REFERENCE"));
    }
    let mut current_element = element.clone();
    current_element.role = text(live.0, "AXRole", 80);
    let title = text(live.0, "AXTitle", 512);
    current_element.label = if title.is_empty() {
        text(live.0, "AXDescription", 512)
    } else {
        title
    };
    if governed_element(&current_element) {
        return Err(ComputerError::known("COMPUTER_GOVERNED_OPERATION_REQUIRED"));
    }
    if current_element.role != element.role || current_element.label != element.label {
        return Err(ComputerError::known("COMPUTER_STALE_REFERENCE"));
    }
    if text(live.0, "AXSubrole", 100) == "AXSecureTextField" {
        return Err(ComputerError::known("COMPUTER_PROTECTED_TARGET"));
    }
    if needs_focus {
        let focused = checked_attribute(application.0, "AXFocusedUIElement", || {
            preflight(target, true, cancelled)
        })?
        .filter(|v| ax(v.0));
        if !focused.is_some_and(|v| unsafe { CFEqual(v.0, live.0) != 0 })
            || text(live.0, "AXSubrole", 100) == "AXSecureTextField"
        {
            return Err(ComputerError::known("COMPUTER_FOCUS_CHANGED"));
        }
    }
    Ok(live)
}
pub fn input(
    target: &ComputerTarget,
    current: &Observation,
    element: &Element,
    args: &Value,
    cancelled: &dyn Fn() -> bool,
) -> Result<()> {
    let _pool = Pool::new();
    let action = args["action"].as_str().unwrap();
    let live = input_target(
        target,
        current,
        element,
        matches!(action, "type" | "press"),
        cancelled,
    )?;
    match action {
        "click" => {
            let point = hit_point(
                live.0,
                target,
                element
                    .bounds
                    .ok_or_else(|| ComputerError::known("COMPUTER_TARGET_OFFSCREEN"))?,
            )?;
            let right = args["button"] == "right";
            let button = u32::from(right);
            let down = event(unsafe {
                CGEventCreateMouseEvent(ptr::null(), if right { 3 } else { 1 }, point, button)
            })?;
            let up = event(unsafe {
                CGEventCreateMouseEvent(ptr::null(), if right { 4 } else { 2 }, point, button)
            })?;
            let live = input_target(target, current, element, false, cancelled)?;
            hit_point(live.0, target, element.bounds.unwrap())?;
            post_pair(&down, &up);
        }
        "press" => {
            let (key, flags) = parse_key(args["key"].as_str().unwrap())?;
            let down = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, true) })?;
            let up = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, false) })?;
            unsafe {
                CGEventSetFlags(down.0, flags);
                CGEventSetFlags(up.0, 0);
            }
            input_target(target, current, element, true, cancelled)?;
            post_pair(&down, &up);
        }
        "type" => {
            let mut dispatched = false;
            let deadline = Instant::now() + Duration::from_secs(8);
            for units in unicode_chunks(args["text"].as_str().unwrap()) {
                let next = || -> Result<()> {
                    if Instant::now() >= deadline {
                        return Err(ComputerError::known("COMPUTER_INPUT_TIMEOUT"));
                    }
                    // Short events preserve Unicode scalar boundaries and let
                    // cancellation/user focus changes stop subsequent text.
                    let down = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), 0, true) })?;
                    let up = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), 0, false) })?;
                    unsafe {
                        CGEventKeyboardSetUnicodeString(down.0, units.len(), units.as_ptr());
                        CGEventKeyboardSetUnicodeString(up.0, units.len(), units.as_ptr());
                        CGEventSetFlags(down.0, 0);
                        CGEventSetFlags(up.0, 0);
                    }
                    input_target(target, current, element, true, cancelled)?;
                    post_pair(&down, &up);
                    Ok(())
                };
                next().map_err(|error| {
                    if dispatched {
                        // Preserve the concrete refusal for recovery diagnostics;
                        // partial dispatch still makes the outcome unknown.
                        ComputerError::unknown(error.code())
                    } else {
                        error
                    }
                })?;
                dispatched = true;
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        "scroll" => {
            let point = hit_point(
                live.0,
                target,
                element
                    .bounds
                    .ok_or_else(|| ComputerError::known("COMPUTER_TARGET_OFFSCREEN"))?,
            )?;
            let direction = args["direction"].as_str().unwrap();
            let amount = args["amount"].as_u64().unwrap() as i32 * 40;
            let vertical = match direction {
                "up" => amount,
                "down" => -amount,
                _ => 0,
            };
            let horizontal = match direction {
                "left" => amount,
                "right" => -amount,
                _ => 0,
            };
            let wheel = event(unsafe {
                CGEventCreateScrollWheelEvent(ptr::null(), 0, 2, vertical, horizontal)
            })?;
            unsafe {
                CGEventSetLocation(wheel.0, point);
            }
            let live = input_target(target, current, element, false, cancelled)?;
            hit_point(live.0, target, element.bounds.unwrap())?;
            unsafe {
                CGEventPost(0, wheel.0);
            }
        }
        _ => return Err(ComputerError::known("COMPUTER_UNSUPPORTED_ACTION")),
    }
    // Give the native event queue a short bounded settling interval. This is
    // observation latency, never a replay or a promise of semantic completion.
    std::thread::sleep(Duration::from_millis(80));
    Ok(())
}

fn unicode_chunks(text: &str) -> Vec<Vec<u16>> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    for character in text.chars() {
        let mut encoded = [0; 2];
        let units = character.encode_utf16(&mut encoded);
        if current.len() + units.len() > 16 {
            chunks.push(std::mem::take(&mut current));
        }
        current.extend_from_slice(units);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires an unlocked macOS desktop and existing Accessibility permission; reads only focused PID"]
    fn fresh_cli_process_can_query_current_focus_identity_on_worker_thread() {
        const CHILD: &str = "FIELORA_FOCUS_IDENTITY_TEST_CHILD";
        if std::env::var_os(CHILD).is_none() {
            // A new process is essential: another native test may already have
            // initialized Process Manager and hidden this CLI startup failure.
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "computer::native::tests::fresh_cli_process_can_query_current_focus_identity_on_worker_thread",
                    "--ignored",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .output()
                .unwrap();
            eprintln!("{}", String::from_utf8_lossy(&output.stdout));
            eprintln!("{}", String::from_utf8_lossy(&output.stderr));
            assert!(
                output.status.success(),
                "fresh CLI focus identity query failed"
            );
            return;
        }
        let _pool = Pool::new();
        assert!(unsafe { AXIsProcessTrusted() });
        assert!(interactive_desktop());
        // Diagnostic only; the regression assertion is the production helper
        // below. No titles, values, window contents or native input are read.
        let system = Owned::new(unsafe { AXUIElementCreateSystemWide() }).unwrap();
        let attribute = cfstring("AXFocusedApplication");
        let mut before = ptr::null();
        unsafe { AXUIElementSetMessagingTimeout(system.0, 0.15) };
        let before_code =
            unsafe { AXUIElementCopyAttributeValue(system.0, attribute.0, &mut before) };
        drop(Owned::new(before));
        let focused = focused_application_pid(|| Ok(())).unwrap();
        eprintln!("focus identity: before_code={before_code}, after_pid={focused:?}");
        assert!(focused.is_some_and(|pid| pid > 0));
        let cancelled = focused_application_pid(|| Err(ComputerError::known("COMPUTER_CANCELLED")))
            .unwrap_err();
        assert_eq!(cancelled.code(), "COMPUTER_CANCELLED");
    }

    #[test]
    fn absent_native_reference_never_constructs_an_owned_null() {
        assert!(Owned::new(ptr::null()).is_none());
        assert!(Owned::retained(ptr::null()).is_none());
    }
    #[test]
    fn ax_read_retries_only_temporary_messaging_failure_with_fresh_validation() {
        let attempts = std::cell::Cell::new(0);
        let validations = std::cell::Cell::new(0);
        let result = retry_ax_read(
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() < 3 {
                    Err(-25204)
                } else {
                    Ok(Some("focused"))
                }
            },
            || {
                validations.set(validations.get() + 1);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(result, Some("focused"));
        assert_eq!(attempts.get(), 3);
        assert_eq!(validations.get(), 6);

        let attempts = std::cell::Cell::new(0);
        let error = retry_ax_read::<()>(
            || {
                attempts.set(attempts.get() + 1);
                Err(-25204)
            },
            || Ok(()),
        )
        .unwrap_err();
        assert_eq!(attempts.get(), 3);
        assert_eq!(error.code(), "COMPUTER_AX_CANNOT_COMPLETE");
        assert!(!error.outcome_unknown());
    }

    #[test]
    fn ax_read_preserves_absence_invalidity_and_stops_on_cancel_or_focus_change() {
        for (code, expected) in [
            (-25202, "COMPUTER_AX_INVALID_ELEMENT"),
            (-25205, "COMPUTER_AX_ATTRIBUTE_UNSUPPORTED"),
            (-25208, "COMPUTER_AX_NOT_IMPLEMENTED"),
            (-25211, "COMPUTER_ACCESSIBILITY_REQUIRED"),
        ] {
            let attempts = std::cell::Cell::new(0);
            let error = retry_ax_read::<()>(
                || {
                    attempts.set(attempts.get() + 1);
                    Err(code)
                },
                || Ok(()),
            )
            .unwrap_err();
            assert_eq!(error.code(), expected);
            assert_eq!(attempts.get(), 1);
        }
        let attempts = std::cell::Cell::new(0);
        assert!(
            retry_ax_read::<()>(
                || {
                    attempts.set(attempts.get() + 1);
                    Err(-25212)
                },
                || Ok(()),
            )
            .unwrap()
            .is_none()
        );
        assert_eq!(attempts.get(), 1);

        for code in [
            "COMPUTER_CANCELLED",
            "COMPUTER_FOCUS_CHANGED",
            "COMPUTER_TARGET_CHANGED",
        ] {
            for read_result in [Err(-25204), Ok(Some(()))] {
                let attempts = std::cell::Cell::new(0);
                let error = retry_ax_read(
                    || {
                        attempts.set(attempts.get() + 1);
                        read_result
                    },
                    || {
                        if attempts.get() > 0 {
                            Err(ComputerError::known(code))
                        } else {
                            Ok(())
                        }
                    },
                )
                .unwrap_err();
                assert_eq!(error.code(), code);
                assert_eq!(attempts.get(), 1, "Never retry after a changed safety fact");
            }
        }
    }

    #[test]
    fn command_line_process_identity_uses_kernel_start_time_not_launch_services() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pid = child.id() as i32;
        let first = process_launch_identity(pid);
        let second = process_launch_identity(pid);
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(
            first
                .as_ref()
                .is_some_and(|identity| identity.starts_with("kernel:"))
        );
        assert_eq!(first, second);
        assert!(process_launch_identity(pid).is_none());
        assert!(process_launch_identity(-1).is_none());
    }

    #[test]
    fn unicode_events_are_bounded_without_splitting_surrogate_pairs() {
        let text = "中文😀a".repeat(50);
        let chunks = unicode_chunks(&text);
        assert!(chunks.len() > 1 && chunks.iter().all(|c| c.len() <= 16));
        let rebuilt = chunks
            .iter()
            .map(|c| String::from_utf16(c).unwrap())
            .collect::<String>();
        assert_eq!(rebuilt, text);
    }
    #[test]
    fn native_status_is_read_only_and_reports_actual_permission_without_prompting() {
        let report = status();
        eprintln!(
            "native computer readiness: accessibility={}, input={}, interactive={}",
            report["accessibility"], report["input_permission"], report["interactive_desktop"]
        );
        assert_eq!(report["content_observed"], false);
        assert_eq!(report["screenshots"], "UNSUPPORTED");
        assert!(report["applications"].is_array());
        assert!(!report.to_string().contains("AXValue"));
        assert!(prepare_target(&std::process::id().to_string()).is_err());
    }
}
