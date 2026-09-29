//! Read-only maintenance reproduction, not real-model acceptance.
use fielora_agent::{CommandCancellation, ToolExecutor, ToolRuntime};
use serde_json::json;
use std::{env, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let project = PathBuf::from(env::args().nth(1).ok_or("project required")?);
    let node = env::args().nth(2).ok_or("absolute node required")?;
    let evidence = project.join("artifacts/convergence-compact-20260926");
    fs::create_dir_all(&evidence)?;
    let runtime = ToolRuntime::new(&project, &evidence)?;
    let result = runtime.execute("run_command", &json!({"program":node,
        "argv":[".agents/skills/archify/bin/archify.mjs","validate","architecture","fielora-architecture.json","--quality","showcase","--json"]}),true,&CommandCancellation::default())?;
    assert_eq!(result.receipt["success"], false);
    assert!(
        result.receipt["diagnostic_summary"]["count"]
            .as_u64()
            .unwrap()
            > 12
    );
    assert!(result.observation.len() < 12000);
    assert!(result.observation.contains("edge-through-node"));
    assert!(result.observation.contains("omitted"));
    fs::write(
        evidence.join("actual-tool-diagnostics.json"),
        serde_json::to_vec_pretty(&json!({
        "kind":"MAINTENANCE_NOT_MODEL_ACCEPTANCE","receipt":result.receipt,
        "model_observation_bytes":result.observation.len(),"observation":result.observation}))?,
    )?;
    println!("PASS real Archify failure is bounded and retains actionable diagnostics");
    Ok(())
}
