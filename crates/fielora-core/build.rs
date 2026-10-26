use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn git(root: &Path, args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_else(|| "UNKNOWN".into())
}

fn fingerprint(root: &Path, paths: &[&str]) -> String {
    let seeds = [
        0xcbf29ce484222325u64,
        0x84222325cbf29ce4,
        0x9e3779b185ebca87,
        0x517cc1b727220a95,
    ];
    seeds
        .into_iter()
        .map(|mut hash| {
            for relative in paths {
                let bytes = fs::read(root.join(relative)).unwrap_or_default();
                for byte in relative.as_bytes().iter().chain(bytes.iter()) {
                    hash ^= u64::from(*byte);
                    hash = hash.wrapping_mul(0x100000001b3);
                }
            }
            format!("{hash:016x}")
        })
        .collect::<String>()
}

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let root = manifest
        .join("../..")
        .canonicalize()
        .expect("workspace root");
    let core = [
        "crates/fielora-core/src/agent_runtime.rs",
        "crates/fielora-core/src/agent_model_repair.rs",
        "crates/fielora-core/src/agent_command_policy_fixture.rs",
        "crates/fielora-core/src/agent_image_history.rs",
        "crates/fielora-core/src/agent_turn_context.rs",
        "crates/fielora-core/src/agent_user_input.rs",
        "crates/fielora-core/src/agent_task_outcome.rs",
        "crates/fielora-core/src/agent_report.rs",
        "crates/fielora-core/src/agent_skill_verification.rs",
        "crates/fielora-core/src/agent_verification.rs",
        "crates/fielora-agent/src/skill_verification.rs",
        "crates/fielora-agent/src/skill_acquisition.rs",
        "crates/fielora-agent/src/capability_catalog.rs",
        "crates/fielora-agent/src/web.rs",
        "crates/fielora-agent/src/web/exa.rs",
        "crates/fielora-core/src/agent_web.rs",
        "crates/fielora-core/src/agent_web_fixture.rs",
        "crates/fielora-agent/src/skills.rs",
        "crates/fielora-agent/src/builtin_skills/interactive_prototype.md",
        "crates/fielora-storage/src/lib.rs",
        "crates/fielora-core/src/agent_request_intent.rs",
        "crates/fielora-core/src/agent_request_scope.rs",
        "crates/fielora-core/src/agent_task_outcome.rs",
        "crates/fielora-core/src/agent_work_plan.rs",
        "crates/fielora-core/src/agent_work_state.rs",
        "crates/fielora-core/src/agent_coding_loop.rs",
        "crates/fielora-core/src/agent_work_review.rs",
        "crates/fielora-core/src/model_runtime.rs",
        "crates/fielora-core/src/agent_recovery.rs",
        "crates/fielora-agent/src/command_diagnostics.rs",
        "crates/fielora-agent/src/command_policy.rs",
        "crates/fielora-platform/src/command_sandbox.rs",
        "crates/fielora-agent/src/tool_acquisition.rs",
        "crates/fielora-agent/src/fonts.rs",
        "crates/fielora-platform/src/fonts.rs",
        "crates/fielora-core/src/agent_browser.rs",
        "crates/fielora-core/src/agent_computer.rs",
        "crates/fielora-core/src/agent_computer_visual_fixture.rs",
        "crates/fielora-core/src/agent_application_preview.rs",
        "crates/fielora-core/src/agent_operation_policy.rs",
        "crates/fielora-core/src/agent_visual_context.rs",
        "crates/fielora-platform/src/computer.rs",
        "crates/fielora-platform/src/computer_macos.rs",
        "crates/fielora-platform/src/computer_visual.rs",
        "crates/fielora-platform/src/computer_visual_macos.rs",
        "crates/fielora-platform/src/computer_preview_macos.m",
        "crates/fielora-agent/src/lib.rs",
        "crates/fielora-model/src/lib.rs",
        "crates/fielora-model/src/response.rs",
    ];
    let renderer = [
        "apps/desktop/src/main.ts",
        "apps/desktop/src/computer-control-overlay.ts",
        "apps/desktop/src/computer-feedback.ts",
        "apps/desktop/src/renderer/ApplicationPreview.tsx",
        "apps/desktop/src/renderer/styles/application-preview.css",
        "apps/desktop/forge.config.ts",
        "apps/desktop/src/prototype-preview.ts",
        "apps/desktop/src/renderer/MarkdownMessage.tsx",
        "apps/desktop/src/renderer/InteractivePrototype.tsx",
        "apps/desktop/src/renderer/interactive-prototype.ts",
        "apps/desktop/src/renderer/styles/interactive-prototype.css",
        "apps/desktop/src/renderer/ProjectWorkspace.tsx",
        "apps/desktop/src/renderer/AgentActivity.tsx",
        "apps/desktop/src/renderer/AgentTurn.tsx",
        "apps/desktop/src/renderer/WebSearchSettings.tsx",
        "apps/desktop/src/renderer/web-search.ts",
        "apps/desktop/src/renderer/agent-activity-projection.ts",
        "apps/desktop/src/renderer/agent-activity-detail.ts",
        "apps/desktop/src/renderer/styles/controls.css",
        "apps/desktop/src/renderer/agent-presentation.ts",
        "apps/desktop/src/fipc.ts",
        "apps/desktop/src/browser-runtime.ts",
        "apps/desktop/src/browser-page-errors.ts",
        "apps/desktop/src/browser-agent-dom.ts",
        "apps/desktop/src/browser-agent-input.ts",
        "apps/desktop/src/browser-input-lifecycle.ts",
        "apps/desktop/src/agent-browser-host.ts",
    ];
    let mut all = core.to_vec();
    all.extend(renderer);
    for relative in &all {
        println!("cargo:rerun-if-changed={}", root.join(relative).display());
    }
    println!(
        "cargo:rerun-if-changed={}",
        root.join("crates/fielora-core/build.rs").display()
    );
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    println!(
        "cargo:rustc-env=FIELORA_BUILD_GIT_HEAD={}",
        git(&root, &["rev-parse", "HEAD"])
    );
    println!(
        "cargo:rustc-env=FIELORA_BUILD_GIT_DIRTY={}",
        !git(&root, &["status", "--porcelain", "--untracked-files=no"]).is_empty()
    );
    println!("cargo:rustc-env=FIELORA_BUILD_TIMESTAMP={timestamp}");
    println!(
        "cargo:rustc-env=FIELORA_SOURCE_FINGERPRINT={}",
        fingerprint(&root, &all)
    );
    println!(
        "cargo:rustc-env=FIELORA_AGENT_CORE_FINGERPRINT={}",
        fingerprint(&root, &core)
    );
    println!(
        "cargo:rustc-env=FIELORA_DESKTOP_RENDERER_FINGERPRINT={}",
        fingerprint(&root, &renderer)
    );
}
