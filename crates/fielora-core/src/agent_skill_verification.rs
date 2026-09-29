//! Installation obligations derived from actual writes, not task keywords.
use fielora_agent::skill_verification;
use fielora_contracts::{AgentToolCallView, AgentToolEffect, AgentToolStatus};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;

fn paths(value: &Value, output: &mut Vec<String>) {
    if let Some(object) = value.as_object() {
        for (key, value) in object {
            if matches!(key.as_str(), "path" | "new_path" | "old_path") {
                if let Some(path) = value.as_str() {
                    output.push(path.replace('\\', "/"));
                }
            } else if key == "paths" {
                if let Some(values) = value.as_array() {
                    output.extend(
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .map(|p| p.replace('\\', "/")),
                    );
                }
            } else if matches!(key.as_str(), "patches" | "files" | "file_artifacts")
                && let Some(values) = value.as_array()
            {
                for value in values {
                    paths(value, output);
                }
            }
        }
    }
}

pub fn skill_name(path: &str) -> Option<&str> {
    let path = path.strip_prefix("./").unwrap_or(path);
    let name = path.strip_prefix(".agents/skills/")?.split('/').next()?;
    skill_verification::valid_name(name).then_some(name)
}

pub fn changed_skills(tools: &[AgentToolCallView]) -> (BTreeSet<String>, bool) {
    let mut names = BTreeSet::new();
    let mut other = false;
    for tool in tools
        .iter()
        .filter(|t| t.effect == AgentToolEffect::WorkspaceWrite && !t.name.starts_with("git_"))
    {
        let mut written = Vec::new();
        paths(&tool.arguments, &mut written);
        if let Some(receipt) = &tool.receipt {
            paths(receipt, &mut written);
        }
        if written.is_empty() {
            other = true;
        }
        for path in written {
            if let Some(name) = skill_name(&path) {
                names.insert(name.to_owned());
            } else {
                other = true;
            }
        }
    }
    (names, other)
}

pub fn revision_facts(tools: &[AgentToolCallView], root: &Path) -> Option<Value> {
    let (mut names, _) = changed_skills(tools);
    names.extend(
        tools
            .iter()
            .filter(|t| t.name == "verify_skill")
            .filter_map(|t| t.arguments["name"].as_str())
            .filter(|n| skill_verification::valid_name(n))
            .map(str::to_owned),
    );
    let mut digests = serde_json::Map::new();
    for name in names {
        let exists = root.join(".agents/skills").join(&name).exists();
        // A missing tree is a revision fact, never a successful installation.
        digests.insert(
            name.clone(),
            if exists {
                json!(skill_verification::bundle_digest(root, &name).ok()?)
            } else {
                Value::Null
            },
        );
    }
    Some(Value::Object(digests))
}

pub struct Assessment {
    pub required: bool,
    pub only_skill_writes: bool,
    pub passed: bool,
    pub pending: Vec<Value>,
}

pub fn assess(tools: &[AgentToolCallView], revision: &str) -> Assessment {
    let (names, other) = changed_skills(tools);
    let mut pending = Vec::new();
    for name in &names {
        let check = tools
            .iter()
            .rev()
            .find(|t| t.name == "verify_skill" && t.arguments["name"] == *name);
        let Some(check) = check else {
            pending.push(json!({"name":name,"reason":"NOT_CHECKED","next_tool":"verify_skill","arguments":{"name":name}}));
            continue;
        };
        let receipt = check.receipt.as_ref().unwrap_or(&Value::Null);
        if check.status != AgentToolStatus::Completed
            || receipt["kind"] != "SKILL_INSTALLATION_CHECK_V1"
            || receipt["success"] != true
            || receipt["workspace_revision"] != revision
        {
            pending.push(json!({"name":name,"reason":if receipt["success"] == false {"CHECK_FAILED"} else {"CHECK_STALE_OR_INCOMPLETE"},"diagnostics":receipt["diagnostics"],"next_action":receipt["next_action"],"next_tool":"verify_skill"}));
            continue;
        }
        if receipt["runtime_check_required"] == true {
            let relevant = tools
                .iter()
                .filter(|t| t.name == "run_command" && command_targets(&t.arguments, name))
                .collect::<Vec<_>>();
            // Only a fresh, eligible, successful command can establish this
            // additional bounded smoke check; generic project checks cannot.
            let latest = relevant.last();
            let passed = latest.is_some_and(|t| {
                t.status == AgentToolStatus::Completed
                    && t.receipt.as_ref().is_some_and(|r| {
                        r["verification_eligible"] == true
                            && r["success"] == true
                            && r["workspace_revision"] == revision
                    })
            });
            if !passed {
                pending.push(json!({"name":name,"reason":"TARGETED_RUNTIME_CHECK_REQUIRED","next_tool":"run_command","guidance":"Inspect the Skill's setup contract and run a targeted doctor/test/check for this bundle under existing command policy. Do not use unrelated project checks or fabricate a passing script."}));
            }
        }
    }
    Assessment {
        required: !names.is_empty(),
        only_skill_writes: !other,
        passed: !names.is_empty() && pending.is_empty(),
        pending,
    }
}

pub fn command_targets(arguments: &Value, name: &str) -> bool {
    let Some(first) = arguments["argv"]
        .as_array()
        .and_then(|args| args.first())
        .and_then(Value::as_str)
    else {
        return false;
    };
    let first = first.replace('\\', "/");
    let cwd = arguments["cwd"].as_str().unwrap_or(".").replace('\\', "/");
    let safe = |p: &str| !p.starts_with('/') && !p.contains(':') && p.split('/').all(|c| c != "..");
    if !safe(&first) || !safe(&cwd) || first.starts_with('-') {
        return false;
    }
    let scope = format!(".agents/skills/{name}");
    let cwd = cwd.strip_prefix("./").unwrap_or(&cwd);
    let first = first.strip_prefix("./").unwrap_or(&first);
    cwd == scope
        || cwd.starts_with(&format!("{scope}/"))
        || (cwd == "." && first.starts_with(&format!("{scope}/")))
}

pub fn is_node_doctor(arguments: &Value) -> bool {
    let Some(args) = arguments["argv"].as_array() else {
        return false;
    };
    let Some(script) = args.first().and_then(Value::as_str) else {
        return false;
    };
    if ![".js", ".mjs", ".cjs"]
        .iter()
        .any(|ext| script.ends_with(ext))
        || args.get(1).and_then(Value::as_str) != Some("doctor")
    {
        return false;
    }
    let path = script.replace('\\', "/");
    let cwd = arguments["cwd"].as_str().unwrap_or("").replace('\\', "/");
    skill_name(&path)
        .or_else(|| skill_name(&cwd))
        .is_some_and(|name| command_targets(arguments, name))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tool(
        id: &str,
        name: &str,
        effect: &str,
        arguments: Value,
        receipt: Value,
    ) -> AgentToolCallView {
        serde_json::from_value(json!({"id":id,"run_id":"run","name":name,"effect":effect,"status":"COMPLETED","policy_decision":"ALLOW","arguments":arguments,"receipt":receipt,"created_at":0,"updated_at":0})).unwrap()
    }
    #[test]
    fn doctor_target_is_the_executed_bundle_not_an_arbitrary_argument() {
        assert!(is_node_doctor(
            &json!({"argv":["./.agents/skills/demo/bin/main.mjs","doctor"]})
        ));
        assert!(is_node_doctor(
            &json!({"cwd":".agents/skills/demo","argv":["bin/main.mjs","doctor"]})
        ));
        assert!(!command_targets(
            &json!({"argv":["verify-app.js",".agents/skills/demo/bin/main.mjs"]}),
            "demo"
        ));
        assert!(!command_targets(
            &json!({"argv":[".agents/skills/demo/../../../verify-app.js","doctor"]}),
            "demo"
        ));
        assert!(!is_node_doctor(
            &json!({"argv":["other/main.mjs","doctor"]})
        ));
    }

    #[test]
    fn skill_checks_are_revision_scoped_and_do_not_cover_other_edits() {
        let mut tools = vec![tool(
            "w",
            "create_file",
            "WORKSPACE_WRITE",
            json!({"path":".agents/skills/demo/SKILL.md"}),
            json!({}),
        )];
        assert_eq!(assess(&tools, "r1").pending[0]["reason"], "NOT_CHECKED");
        tools.push(tool("v","verify_skill","OBSERVE",json!({"name":"demo"}),json!({"kind":"SKILL_INSTALLATION_CHECK_V1","success":true,"workspace_revision":"r1","runtime_check_required":true})));
        tools.push(tool(
            "unrelated",
            "run_command",
            "PROCESS",
            json!({"program":"node","argv":["verify-app.js"]}),
            json!({"success":true,"verification_eligible":true,"workspace_revision":"r1"}),
        ));
        assert!(!assess(&tools, "r1").passed);
        tools.push(tool(
            "smoke",
            "run_command",
            "PROCESS",
            json!({"program":"node","argv":[".agents/skills/demo/bin/main.mjs","doctor"]}),
            json!({"success":true,"verification_eligible":true,"workspace_revision":"r1"}),
        ));
        assert!(assess(&tools, "r1").passed);
        assert!(!assess(&tools, "r2").passed);
        tools.push(tool(
            "other",
            "write_file",
            "WORKSPACE_WRITE",
            json!({"path":"app.js"}),
            json!({}),
        ));
        assert!(!assess(&tools, "r1").only_skill_writes);
        tools[1].receipt.as_mut().unwrap()["success"] = json!(false);
        assert!(!assess(&tools, "r1").passed);
    }
}
