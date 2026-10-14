//! The visual route shares native identity, focus and protected-target checks.
//! Images are single-window observations; coordinates never target the desktop.
use super::*;

struct ModelCapturePriority;
impl ModelCapturePriority {
    fn new() -> Self {
        unsafe { fielora_computer_visual_priority(true) };
        Self
    }
}
impl Drop for ModelCapturePriority {
    fn drop(&mut self) {
        unsafe { fielora_computer_visual_priority(false) };
    }
}

pub(in crate::computer) fn screenshot_support() -> &'static str {
    if unsafe { fielora_computer_visual_available() } {
        "SUPPORTED"
    } else {
        "UNSUPPORTED"
    }
}

pub(in crate::computer) fn screenshot(
    target: &ComputerTarget,
    observed: &Observation,
    cancelled: &dyn Fn() -> bool,
) -> Result<(VisualFrame, String)> {
    let _pool = Pool::new();
    preflight(target, false, cancelled)?;
    if observed.elements.iter().any(|element| element.protected) {
        return Err(ComputerError::known("COMPUTER_PROTECTED_TARGET"));
    }
    let (_, window) = root(target, false, cancelled)?;
    if token(window.0) != observed.window_token || boolean(window.0, "AXMinimized", false) {
        return Err(ComputerError::known("COMPUTER_TARGET_CHANGED"));
    }
    let geometry = bounds(window.0)
        .ok_or_else(|| ComputerError::known("COMPUTER_PREVIEW_WINDOW_UNAVAILABLE"))?;
    let title = std::ffi::CString::new(text(window.0, "AXTitle", 512))
        .map_err(|_| ComputerError::known("COMPUTER_PREVIEW_WINDOW_UNAVAILABLE"))?;
    if title.as_bytes().is_empty() {
        return Err(ComputerError::known("COMPUTER_PREVIEW_WINDOW_UNAVAILABLE"));
    }
    let _priority = ModelCapturePriority::new();
    // An existing local preview may still own the native single-flight lease.
    // New previews yield to this reservation. Wait without ComputerSession's
    // execution lock; only error 8 is guaranteed to precede any SDK dispatch.
    let image = visual::wait_for_capture(cancelled, Duration::from_millis(3500), || {
        let mut image = NativePreviewImage::default();
        unsafe {
            fielora_computer_visual_capture(
                target.pid,
                geometry.as_ptr(),
                title.as_ptr(),
                &mut image,
            );
        }
        if image.error == 8 {
            Err(ComputerError::known("COMPUTER_BUSY"))
        } else {
            Ok(image)
        }
    })?;
    if cancelled() {
        return Err(ComputerError::known("COMPUTER_CANCELLED"));
    }
    let current = observe(target, cancelled)?;
    if current.elements.iter().any(|element| element.protected) {
        return Err(ComputerError::known("COMPUTER_PROTECTED_TARGET"));
    }
    if current.window_token != observed.window_token
        || current.elements != observed.elements
        || current.focused_token != observed.focused_token
        || current.elements.first().and_then(|element| element.bounds) != Some(geometry)
    {
        return Err(ComputerError::known("COMPUTER_STALE_SNAPSHOT"));
    }
    if !unsafe { CGPreflightScreenCaptureAccess() } {
        return Err(ComputerError::known("COMPUTER_SCREEN_RECORDING_REQUIRED"));
    }
    let data = image
        .data_url(4_194_304, 1280, 960)
        .ok_or_else(|| ComputerError::known(image.error_code()))?;
    Ok((
        VisualFrame {
            width: image.width,
            height: image.height,
            bounds: geometry,
            captured_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
        data,
    ))
}

fn window_for_input(
    target: &ComputerTarget,
    observed: &Observation,
    frame: &VisualFrame,
    cancelled: &dyn Fn() -> bool,
) -> Result<(Owned, Owned)> {
    preflight(target, true, cancelled)?;
    let (application, window) = root(target, true, cancelled)?;
    if token(window.0) != observed.window_token
        || bounds(window.0) != Some(frame.bounds)
        || boolean(window.0, "AXMinimized", false)
    {
        return Err(ComputerError::known("COMPUTER_TARGET_CHANGED"));
    }
    Ok((application, window))
}

fn checked_element(element: Ref) -> Result<Element> {
    unsafe {
        AXUIElementSetMessagingTimeout(element, 0.15);
    }
    let role = text(element, "AXRole", 80);
    if role.is_empty() {
        return Err(ComputerError::known("COMPUTER_AX_READ_FAILED"));
    }
    let secure =
        role == "AXSecureTextField" || text(element, "AXSubrole", 100) == "AXSecureTextField";
    if secure {
        return Err(ComputerError::known("COMPUTER_PROTECTED_TARGET"));
    }
    let title = text(element, "AXTitle", 512);
    let label = if title.is_empty() {
        text(element, "AXDescription", 512)
    } else {
        title
    };
    let item = Element {
        reference: String::new(),
        role,
        label,
        value: String::new(),
        enabled: boolean(element, "AXEnabled", true),
        focused: false,
        protected: false,
        bounds: bounds(element),
        path: vec![],
        token: token(element),
    };
    if !item.enabled {
        return Err(ComputerError::known("COMPUTER_TARGET_DISABLED"));
    }
    if governed_element(&item) {
        return Err(ComputerError::known("COMPUTER_GOVERNED_OPERATION_REQUIRED"));
    }
    Ok(item)
}

/// A canvas may have no useful AX label. Its live hit/focused element must still
/// belong to the exact observed window, including every bounded ancestor.
fn same_window(
    element: Ref,
    target: &ComputerTarget,
    window: Ref,
    cancelled: &dyn Fn() -> bool,
) -> Result<Element> {
    let first = checked_element(element)?;
    let mut current = Owned::retained(element)
        .ok_or_else(|| ComputerError::known("COMPUTER_TARGET_UNAVAILABLE"))?;
    for _ in 0..32 {
        if cancelled() {
            return Err(ComputerError::known("COMPUTER_CANCELLED"));
        }
        if pid(current.0) != Some(target.pid) {
            return Err(ComputerError::known("COMPUTER_TARGET_OCCLUDED"));
        }
        checked_element(current.0)?;
        if unsafe { CFEqual(current.0, window) != 0 } {
            return Ok(first);
        }
        current = attribute(current.0, "AXParent")
            .filter(|value| ax(value.0))
            .ok_or_else(|| ComputerError::known("COMPUTER_TARGET_OCCLUDED"))?;
    }
    Err(ComputerError::known("COMPUTER_TARGET_OCCLUDED"))
}

fn point_target(
    target: &ComputerTarget,
    observed: &Observation,
    frame: &VisualFrame,
    point: Point,
    cancelled: &dyn Fn() -> bool,
) -> Result<()> {
    let (_, window) = window_for_input(target, observed, frame, cancelled)?;
    let mut displays = [0; 16];
    let mut count = 0;
    let on_screen = unsafe { CGGetActiveDisplayList(16, displays.as_mut_ptr(), &mut count) } == 0
        && displays[..(count as usize).min(16)].iter().any(|display| {
            let area = unsafe { CGDisplayBounds(*display) };
            point.x >= area.origin.x
                && point.x < area.origin.x + area.size.width
                && point.y >= area.origin.y
                && point.y < area.origin.y + area.size.height
        });
    if !on_screen {
        return Err(ComputerError::known("COMPUTER_TARGET_OFFSCREEN"));
    }
    let system = Owned::new(unsafe { AXUIElementCreateSystemWide() })
        .ok_or_else(|| ComputerError::known("COMPUTER_TARGET_UNAVAILABLE"))?;
    let mut hit = ptr::null();
    if unsafe {
        AXUIElementCopyElementAtPosition(system.0, point.x as f32, point.y as f32, &mut hit)
    } != 0
    {
        return Err(ComputerError::known("COMPUTER_TARGET_OCCLUDED"));
    }
    let hit = Owned::new(hit).ok_or_else(|| ComputerError::known("COMPUTER_TARGET_OCCLUDED"))?;
    same_window(hit.0, target, window.0, cancelled)?;
    window_for_input(target, observed, frame, cancelled)?;
    Ok(())
}

fn focus_target(
    target: &ComputerTarget,
    observed: &Observation,
    frame: &VisualFrame,
    args: &Value,
    expected: Option<u64>,
    cancelled: &dyn Fn() -> bool,
) -> Result<u64> {
    let (application, window) = window_for_input(target, observed, frame, cancelled)?;
    let focused = checked_attribute(application.0, "AXFocusedUIElement", || {
        preflight(target, true, cancelled)
    })?
    .filter(|value| ax(value.0))
    .ok_or_else(|| ComputerError::known("COMPUTER_FOCUS_CHANGED"))?;
    let identity = token(focused.0);
    if expected.is_some_and(|value| value != identity) || observed.focused_token != Some(identity) {
        return Err(ComputerError::known("COMPUTER_FOCUS_CHANGED"));
    }
    let element = same_window(focused.0, target, window.0, cancelled)?;
    if args["action"] == "press" {
        let key = args["key"].as_str().unwrap_or("").to_ascii_lowercase();
        if (key.contains("delete") || key.contains("backspace"))
            && !matches!(
                element.role.as_str(),
                "AXTextField" | "AXTextArea" | "AXComboBox"
            )
        {
            return Err(ComputerError::known("COMPUTER_GOVERNED_OPERATION_REQUIRED"));
        }
    }
    let confirmed = checked_attribute(application.0, "AXFocusedUIElement", || {
        preflight(target, true, cancelled)
    })?
    .filter(|value| ax(value.0));
    if !confirmed.is_some_and(|value| unsafe { CFEqual(value.0, focused.0) != 0 }) {
        return Err(ComputerError::known("COMPUTER_FOCUS_CHANGED"));
    }
    window_for_input(target, observed, frame, cancelled)?;
    Ok(identity)
}

struct MouseRelease {
    up: Owned,
}
impl Drop for MouseRelease {
    fn drop(&mut self) {
        unsafe {
            CGEventPost(0, self.up.0);
        }
    }
}

pub(in crate::computer) fn visual_input(
    target: &ComputerTarget,
    observed: &Observation,
    frame: &VisualFrame,
    args: &Value,
    cancelled: &dyn Fn() -> bool,
) -> Result<Value> {
    let deadline = Instant::now() + Duration::from_secs(8);
    let timeout = std::cell::Cell::new(false);
    let bounded = || {
        if Instant::now() >= deadline {
            timeout.set(true);
            true
        } else {
            cancelled()
        }
    };
    visual_input_inner(target, observed, frame, args, &bounded).map_err(|error| {
        if timeout.get() {
            if error.outcome_unknown() {
                ComputerError::unknown("COMPUTER_INPUT_TIMEOUT")
            } else {
                ComputerError::known("COMPUTER_INPUT_TIMEOUT")
            }
        } else {
            error
        }
    })
}

fn visual_input_inner(
    target: &ComputerTarget,
    observed: &Observation,
    frame: &VisualFrame,
    args: &Value,
    cancelled: &dyn Fn() -> bool,
) -> Result<Value> {
    let _pool = Pool::new();
    let action = args["action"].as_str().unwrap_or("");
    let point = |x, y| frame.point(args, x, y).map(|[x, y]| Point { x, y });
    let mut feedback = json!({"action":action,"target":{"app_id":target.app_id,"name":target.name},
        "window_bounds":frame.bounds,"coordinate_space":"SCREEN_POINTS"});
    if matches!(action, "type" | "press") {
        let focused = focus_target(target, observed, frame, args, None, cancelled)?;
        if action == "press" {
            let (key, flags) = parse_key(args["key"].as_str().unwrap())?;
            let down = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, true) })?;
            let up = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, false) })?;
            unsafe {
                CGEventSetFlags(down.0, flags);
                CGEventSetFlags(up.0, 0);
            }
            focus_target(target, observed, frame, args, Some(focused), cancelled)?;
            post_pair(&down, &up);
        } else {
            let deadline = Instant::now() + Duration::from_secs(8);
            for (index, units) in unicode_chunks(args["text"].as_str().unwrap())
                .iter()
                .enumerate()
            {
                let next = || -> Result<()> {
                    if Instant::now() >= deadline {
                        return Err(ComputerError::known("COMPUTER_INPUT_TIMEOUT"));
                    }
                    let down = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), 0, true) })?;
                    let up = event(unsafe { CGEventCreateKeyboardEvent(ptr::null(), 0, false) })?;
                    unsafe {
                        CGEventKeyboardSetUnicodeString(down.0, units.len(), units.as_ptr());
                        CGEventKeyboardSetUnicodeString(up.0, units.len(), units.as_ptr());
                        CGEventSetFlags(down.0, 0);
                        CGEventSetFlags(up.0, 0);
                    }
                    focus_target(target, observed, frame, args, Some(focused), cancelled)?;
                    post_pair(&down, &up);
                    Ok(())
                };
                next().map_err(|error| {
                    if index > 0 {
                        ComputerError::unknown(error.code())
                    } else {
                        error
                    }
                })?;
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    } else {
        let start = point("x", "y")?;
        point_target(target, observed, frame, start, cancelled)?;
        feedback["x"] = json!(start.x);
        feedback["y"] = json!(start.y);
        match action {
            "move" => {
                let moved = event(unsafe { CGEventCreateMouseEvent(ptr::null(), 5, start, 0) })?;
                point_target(target, observed, frame, start, cancelled)?;
                unsafe {
                    CGEventPost(0, moved.0);
                }
            }
            "click" => {
                let right = args["button"] == "right";
                let down = event(unsafe {
                    CGEventCreateMouseEvent(
                        ptr::null(),
                        if right { 3 } else { 1 },
                        start,
                        u32::from(right),
                    )
                })?;
                let up = event(unsafe {
                    CGEventCreateMouseEvent(
                        ptr::null(),
                        if right { 4 } else { 2 },
                        start,
                        u32::from(right),
                    )
                })?;
                let count = args["click_count"].as_u64().unwrap_or(1);
                for index in 1..=count {
                    point_target(target, observed, frame, start, cancelled).map_err(|error| {
                        if index > 1 {
                            ComputerError::unknown(error.code())
                        } else {
                            error
                        }
                    })?;
                    unsafe {
                        CGEventSetIntegerValueField(down.0, 1, index as i64);
                        CGEventSetIntegerValueField(up.0, 1, index as i64);
                    }
                    post_pair(&down, &up);
                    if index < count {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
            "scroll" => {
                let amount = args["amount"].as_u64().unwrap() as i32 * 40;
                let (vertical, horizontal) = match args["direction"].as_str().unwrap() {
                    "up" => (amount, 0),
                    "down" => (-amount, 0),
                    "left" => (0, amount),
                    _ => (0, -amount),
                };
                let wheel = scroll_event(vertical, horizontal)?;
                unsafe {
                    CGEventSetLocation(wheel.0, start);
                }
                point_target(target, observed, frame, start, cancelled)?;
                unsafe {
                    CGEventPost(0, wheel.0);
                }
            }
            "drag" => {
                let end = point("end_x", "end_y")?;
                let path = (1..=20)
                    .map(|step| Point {
                        x: start.x + (end.x - start.x) * f64::from(step) / 20.,
                        y: start.y + (end.y - start.y) * f64::from(step) / 20.,
                    })
                    .collect::<Vec<_>>();
                for position in &path {
                    point_target(target, observed, frame, *position, cancelled)?;
                }
                let down = event(unsafe { CGEventCreateMouseEvent(ptr::null(), 1, start, 0) })?;
                let up = event(unsafe { CGEventCreateMouseEvent(ptr::null(), 2, start, 0) })?;
                let dragged = event(unsafe { CGEventCreateMouseEvent(ptr::null(), 6, start, 0) })?;
                point_target(target, observed, frame, start, cancelled)?;
                unsafe {
                    CGEventPost(0, down.0);
                }
                let release = MouseRelease { up };
                for position in path {
                    point_target(target, observed, frame, position, cancelled)
                        .map_err(|error| ComputerError::unknown(error.code()))?;
                    unsafe {
                        CGEventSetLocation(dragged.0, position);
                        CGEventSetLocation(release.up.0, position);
                        CGEventPost(0, dragged.0);
                    }
                    std::thread::sleep(Duration::from_millis(15));
                }
                drop(release);
                feedback["end_x"] = json!(end.x);
                feedback["end_y"] = json!(end.y);
            }
            _ => return Err(ComputerError::known("COMPUTER_UNSUPPORTED_ACTION")),
        }
    }
    std::thread::sleep(Duration::from_millis(80));
    Ok(feedback)
}
