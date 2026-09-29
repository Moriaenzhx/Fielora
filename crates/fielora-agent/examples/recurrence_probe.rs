//! Local tools only; no model calls and no edits to the user's specification.
use fielora_agent::{CommandCancellation, ToolExecutor, ToolRuntime};
use serde_json::json;
use std::{env, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let project = PathBuf::from(env::args().nth(1).ok_or("project required")?);
    let modern = env::args()
        .nth(2)
        .ok_or("modern absolute executable required")?;
    let evidence = project.join("artifacts/recurrence-repair-20260929");
    fs::create_dir_all(&evidence)?;
    let runtime = ToolRuntime::new(&project, &evidence)?;
    let cancel = CommandCancellation::default();
    let loaded = runtime.execute("load_skill", &json!({"name":"archify"}), false, &cancel)?;
    assert!(
        loaded.receipt["runtime_candidates"]
            .as_array()
            .is_some_and(|a| !a.is_empty())
    );
    assert!(loaded.observation.contains("project root"));
    let mut probes = Vec::new();
    for c in loaded.receipt["runtime_candidates"][0]["candidates"]
        .as_array()
        .ok_or("candidates missing")?
    {
        let probe = runtime.execute(
            "run_command",
            &json!({"program":c["program"],"argv":["--version"]}),
            true,
            &cancel,
        )?;
        probes.push(probe.receipt);
    }
    assert!(probes.iter().any(|p| {
        p["runtime_version"]
            .as_str()
            .is_some_and(|v| v.starts_with("v24."))
    }));
    let page = runtime.execute(
        "list_files",
        &json!({"path":".","max_depth":2}),
        false,
        &cancel,
    )?;
    assert!(page.receipt["count"].as_u64().unwrap() <= 100);
    assert!(page.observation.len() <= 16 * 1024);
    assert!(page.receipt["next_offset"].is_number());
    let mut failures = Vec::new();
    for (node, cwd, input, layer) in [
        (
            "D:/Program Files/nodejs/node.exe",
            ".agents/skills/archify",
            "fielora-architecture.json",
            "INTERNAL",
        ),
        (
            modern.as_str(),
            ".agents/skills/archify",
            "fielora-architecture.json",
            "INPUT_ACCESS",
        ),
        (
            modern.as_str(),
            ".",
            "fielora-architecture.json",
            "VALIDATION",
        ),
    ] {
        let script = if cwd == "." {
            ".agents/skills/archify/bin/archify.mjs"
        } else {
            "bin/archify.mjs"
        };
        let result = runtime.execute("run_command", &json!({"program":node,"cwd":cwd,"argv":[script,"validate","architecture",input,"--quality","showcase","--json"]}), true, &cancel)?;
        assert_eq!(result.receipt["success"], false);
        assert_eq!(
            result.receipt["diagnostic_summary"]["reported_layer"],
            layer
        );
        failures.push(json!({"receipt":result.receipt,"observation":result.observation}));
    }
    fs::write(
        evidence.join("actual-tool-probe.json"),
        serde_json::to_vec_pretty(
            &json!({"kind":"LOCAL_TOOLS_NOT_MODEL_ACCEPTANCE","skill_receipt":loaded.receipt,"runtime_probes":probes,"page_count":page.receipt["count"],"page_bytes":page.observation.len(),"failures":failures}),
        )?,
    )?;
    println!("PASS fresh Skill runtime discovery, bounded listing and three real failure layers");
    Ok(())
}
