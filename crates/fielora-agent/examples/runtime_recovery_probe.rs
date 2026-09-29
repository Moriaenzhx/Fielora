//! Explicit maintenance probe using the same built-in execution backend.
//! Preserves inherited PATH; no production Run or settings are modified.
use fielora_agent::{CommandCancellation, ToolExecutor, ToolRuntime};
use serde_json::{Value, json};
use std::{env, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let project = PathBuf::from(env::args().nth(1).ok_or("project required")?);
    let evidence = project.join("artifacts/time-only-recovery-20260925");
    fs::create_dir_all(&evidence)?;
    let runtime = ToolRuntime::new(&project, &evidence)?;
    let cancel = CommandCancellation::default();
    let discovered = runtime.execute(
        "environment.inspect",
        &json!({"program":"node"}),
        false,
        &cancel,
    )?;
    let mut probes = Vec::new();
    let mut compatible = None;
    for candidate in discovered.receipt["candidates"]
        .as_array()
        .ok_or("no candidates")?
    {
        let program = candidate["program"].as_str().ok_or("bad candidate")?;
        let probe = runtime.execute(
            "run_command",
            &json!({"program":program,"argv":["--version"],"cwd":project}),
            true,
            &cancel,
        )?;
        let major = probe.observation.split_whitespace().find_map(|word| {
            word.strip_prefix('v')
                .and_then(|v| v.split('.').next())
                .and_then(|n| n.parse::<u32>().ok())
        });
        if probe.receipt["success"] == true
            && major.is_some_and(|v| v >= 18)
            && compatible.is_none()
        {
            compatible = Some(program.to_owned());
        }
        probes.push(
            json!({"program":program,"receipt":probe.receipt,"version_output":probe.observation}),
        );
    }
    let program = compatible
        .ok_or("No compatible discovered Node; no automatic fallback installation in this probe")?;
    let mut checks = Vec::<Value>::new();
    for argv in [
        vec![".agents/skills/archify/bin/archify.mjs", "doctor"],
        vec![
            ".agents/skills/archify/bin/archify.mjs",
            "deliver",
            "architecture",
            "artifacts/archify-generation-20260925/fielora-architecture.json",
            "artifacts/time-only-recovery-20260925/architecture-runtime-proof.html",
            "--quality",
            "showcase",
            "--json",
        ],
    ] {
        let check = runtime.execute(
            "run_command",
            &json!({"program":program,"argv":argv,"cwd":project,"timeout_ms":120000}),
            true,
            &cancel,
        )?;
        let passed = check.receipt["success"] == true;
        checks.push(json!({"argv":argv,"receipt":check.receipt,"output":check.observation}));
        if !passed {
            fs::write(
                evidence.join("runtime-probe.json"),
                serde_json::to_vec_pretty(
                    &json!({"discovery":discovered.receipt,"probes":probes,"checks":checks}),
                )?,
            )?;
            return Err("Archify check failed".into());
        }
    }
    fs::write(
        evidence.join("runtime-probe.json"),
        serde_json::to_vec_pretty(
            &json!({"kind":"MAINTENANCE_EXECUTION_NOT_MODEL_ACCEPTANCE","discovery":discovered.receipt,"probes":probes,"selected_program":program,"checks":checks}),
        )?,
    )?;
    println!(
        "Verified inherited-PATH discovery, compatible absolute Node and Archify doctor/delivery. Evidence: {}",
        evidence.display()
    );
    Ok(())
}
