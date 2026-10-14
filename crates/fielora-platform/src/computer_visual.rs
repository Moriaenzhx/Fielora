//! Snapshot-relative image coordinates; no global desktop coordinate authority.
use super::*;

pub(super) const MAX_AGE: Duration = Duration::from_secs(30);

/// Only the native capture lease's BUSY means acquisition has not begun.
/// This helper must never wrap input or retry a timed-out capture callback.
pub(super) fn wait_for_capture<T>(
    cancelled: &dyn Fn() -> bool,
    max_wait: Duration,
    mut capture: impl FnMut() -> Result<T>,
) -> Result<T> {
    let deadline = Instant::now() + max_wait;
    loop {
        if cancelled() {
            return Err(ComputerError::known("COMPUTER_CANCELLED"));
        }
        match capture() {
            Err(error) if error.code() == "COMPUTER_BUSY" && !error.outcome_unknown() => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(error);
                }
                std::thread::sleep(remaining.min(Duration::from_millis(10)));
            }
            result => return result,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct VisualFrame {
    pub width: u32,
    pub height: u32,
    pub bounds: [f64; 4],
    pub captured_at: u64,
}

impl VisualFrame {
    pub fn point(&self, args: &Value, x: &str, y: &str) -> Result<[f64; 2]> {
        let coordinate = |name: &str, limit: u32| -> Result<f64> {
            args[name]
                .as_u64()
                .filter(|v| *v < u64::from(limit))
                .map(|v| v as f64)
                .ok_or_else(|| ComputerError::known("COMPUTER_COORDINATE_OUT_OF_BOUNDS"))
        };
        if self.width == 0
            || self.height == 0
            || !self.bounds.iter().all(|v| v.is_finite())
            || self.bounds[2] <= 0.
            || self.bounds[3] <= 0.
        {
            return Err(ComputerError::known("COMPUTER_STALE_SNAPSHOT"));
        }
        Ok([
            self.bounds[0] + coordinate(x, self.width)? * self.bounds[2] / f64::from(self.width),
            self.bounds[1] + coordinate(y, self.height)? * self.bounds[3] / f64::from(self.height),
        ])
    }
}

pub(super) fn valid_target_arguments(action: &str, args: &Value) -> bool {
    let has_coordinates = ["x", "y", "end_x", "end_y"]
        .iter()
        .any(|key| args.get(*key).is_some());
    if let Some(reference) = args.get("ref") {
        return !has_coordinates
            && !matches!(action, "move" | "drag")
            && reference.as_str().is_some_and(|v| {
                v.strip_prefix('e').is_some_and(|n| {
                    !n.is_empty() && n.len() <= 3 && n.bytes().all(|b| b.is_ascii_digit())
                })
            });
    }
    if matches!(action, "type" | "press") {
        return !has_coordinates;
    }
    let point = |x: &str, y: &str| {
        args[x].as_u64().is_some_and(|v| v < 16_384) && args[y].as_u64().is_some_and(|v| v < 16_384)
    };
    if !point("x", "y") {
        return false;
    }
    if action == "drag" {
        point("end_x", "end_y")
    } else {
        args.get("end_x").is_none() && args.get("end_y").is_none()
    }
}

pub(super) fn validate_snapshot<'a>(
    snapshot: &'a Snapshot,
    current: &Observation,
) -> Result<&'a VisualFrame> {
    let frame = snapshot
        .visual
        .as_ref()
        .ok_or_else(|| ComputerError::known("COMPUTER_SCREENSHOT_REQUIRED"))?;
    if snapshot.created.elapsed() > MAX_AGE {
        return Err(ComputerError::known("COMPUTER_STALE_SNAPSHOT"));
    }
    let prior = &snapshot.observation;
    if prior.target != current.target
        || prior.window_token != current.window_token
        || current.elements.first().and_then(|e| e.bounds) != Some(frame.bounds)
    {
        return Err(ComputerError::known("COMPUTER_TARGET_CHANGED"));
    }
    if !current.frontmost {
        return Err(ComputerError::known("COMPUTER_FOCUS_CHANGED"));
    }
    if prior.elements != current.elements || prior.focused_token != current.focused_token {
        return Err(ComputerError::known("COMPUTER_STALE_SNAPSHOT"));
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_waits_for_existing_preview_but_never_replays_dispatched_work() {
        let mut attempts = 0;
        let result = wait_for_capture(&|| false, Duration::from_secs(1), || {
            attempts += 1;
            if attempts < 3 {
                Err(ComputerError::known("COMPUTER_BUSY"))
            } else {
                Ok("single acquired capture")
            }
        });
        assert_eq!(result.unwrap(), "single acquired capture");
        assert_eq!(attempts, 3);
        for error in [
            ComputerError::unknown("COMPUTER_BUSY"),
            ComputerError::known("COMPUTER_PREVIEW_TIMEOUT"),
            ComputerError::known("COMPUTER_TARGET_CHANGED"),
        ] {
            let mut attempts = 0;
            let result: Result<()> = wait_for_capture(&|| false, Duration::from_secs(1), || {
                attempts += 1;
                Err(error.clone())
            });
            assert_eq!(result.unwrap_err(), error);
            assert_eq!(attempts, 1);
        }
    }

    #[test]
    fn capture_wait_is_cancellable_and_bounded() {
        let stopped = std::cell::Cell::new(false);
        let mut attempts = 0;
        let result: Result<()> =
            wait_for_capture(&|| stopped.get(), Duration::from_secs(1), || {
                attempts += 1;
                stopped.set(true);
                Err(ComputerError::known("COMPUTER_BUSY"))
            });
        assert_eq!(result.unwrap_err().code(), "COMPUTER_CANCELLED");
        assert_eq!(attempts, 1);
        let result: Result<()> = wait_for_capture(&|| false, Duration::ZERO, || {
            Err(ComputerError::known("COMPUTER_BUSY"))
        });
        assert_eq!(result.unwrap_err().code(), "COMPUTER_BUSY");
    }

    #[test]
    fn coordinates_map_image_pixels_to_actual_window_points() {
        let frame = VisualFrame {
            width: 960,
            height: 640,
            bounds: [-1440., 50., 1440., 960.],
            captured_at: 1,
        };
        assert_eq!(
            frame.point(&json!({"x":480,"y":320}), "x", "y").unwrap(),
            [-720., 530.]
        );
        for args in [
            json!({"x":960,"y":0}),
            json!({"x":0,"y":640}),
            json!({"x":-1,"y":0}),
            json!({"x":0.5,"y":2}),
        ] {
            assert_eq!(
                frame.point(&args, "x", "y").unwrap_err().code(),
                "COMPUTER_COORDINATE_OUT_OF_BOUNDS"
            );
        }
    }
    #[test]
    fn coordinate_and_ref_routes_cannot_be_mixed() {
        assert!(valid_target_arguments(
            "drag",
            &json!({"x":0,"y":0,"end_x":3,"end_y":4})
        ));
        assert!(!valid_target_arguments(
            "drag",
            &json!({"x":0,"y":0,"end_x":3})
        ));
        assert!(!valid_target_arguments(
            "click",
            &json!({"x":1,"y":2,"ref":"e1"})
        ));
        assert!(!valid_target_arguments("move", &json!({"ref":"e1"})));
        assert!(!valid_target_arguments("type", &json!({"x":1,"y":2})));
        assert!(valid_target_arguments("type", &json!({})));
    }
}
