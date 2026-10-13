//! One derived assessment of durable checks. No new authority or persistent state.
use fielora_contracts::{AgentToolCallView, AgentToolStatus};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Default)]
pub(crate) struct Assessment {
    pub checks: Vec<Value>,
    pub blockers: Vec<Value>,
    pub supported: bool,
    pub revision: Option<String>,
}

impl Assessment {
    pub fn passed(&self) -> bool {
        self.supported && self.blockers.is_empty()
    }

    pub fn block(&mut self, reason: &str, details: Value) {
        self.blockers
            .push(json!({"reason":reason,"details":details}));
    }

    pub fn projection(&self) -> Value {
        // Keep all blocker identities in the assessment; bound model/UI output.
        json!({"passed":self.passed(),"workspace_revision":self.revision,
            "blocker_count":self.blockers.len(),"blockers":self.blockers.iter().take(16).collect::<Vec<_>>(),
            "check_count":self.checks.len(),"checks":self.checks.iter().rev().take(24).collect::<Vec<_>>()})
    }

    pub fn recovery(&self) -> String {
        format!(
            "Current Run verification assessment: {}. Resolve the listed reason and target; repeating a different passing check cannot repair a failed target. NOT_EXECUTED is an execution rejection, not a failed assertion or verification. For run_command use a direct supported assertion runner (Python: interpreter -m unittest/pytest); print scripts and read_file observations do not verify results. Put temporary source copies under the Project (for example TemporaryDirectory(dir='.')), use a separate test database, and retain original data. For mutation/negative experiments, an outer unittest/pytest case must call the real decision entry point (mock I/O dependencies, not the decision or a copied version of it). Include a valid positive case and invalid controls: exact target identity, target runtime error, and exit/result contradiction. Verify actual source injection and the intended assertion failure; run the child inside that test and clean up its copy. A nonzero child exit alone is not proof. Do not rerun unchanged successful checks just to obtain new receipt IDs. Report checked scope and remaining requirements; these receipts never prove complete requirement coverage.",
            self.projection()
        )
    }

    #[cfg(test)]
    pub fn fixture(passed: bool) -> Self {
        let mut value = Self {
            supported: passed,
            ..Self::default()
        };
        if !passed {
            value.block("CURRENT_CHECK_REQUIRED", Value::Null);
        }
        value
    }
}

fn cwd(tool: &AgentToolCallView, root: &Path) -> PathBuf {
    let value = tool
        .receipt
        .as_ref()
        .and_then(|r| r["cwd"].as_str())
        .or_else(|| tool.arguments["cwd"].as_str())
        .unwrap_or(".");
    let path = root.join(value);
    path.canonicalize().unwrap_or(path)
}

fn not_executed(tool: &AgentToolCallView) -> bool {
    tool.status == AgentToolStatus::Denied
        || (tool.status == AgentToolStatus::Failed
            && matches!(
                tool.error_code.as_deref(),
                Some(
                    "AGENT_WORKSPACE_ESCAPE"
                        | "AGENT_PROGRAM_NOT_FOUND"
                        | "AGENT_TOOL_ARGUMENTS_INVALID"
                        | "AGENT_COMMAND_DENIED"
                        | "AGENT_SENSITIVE_PATH_DENIED"
                        | "AGENT_TOOL_IS_NOT_PROGRAM"
                )
            ))
}

/// Output timing, fresh IDs and temporary diagnostic paths are not new check evidence.
pub(crate) fn progress_key(tool: &AgentToolCallView) -> Value {
    let r = tool.receipt.as_ref().unwrap_or(&Value::Null);
    json!([
        tool.name,
        tool.status,
        tool.arguments["program"],
        tool.arguments["argv"],
        r.get("cwd").unwrap_or(&tool.arguments["cwd"]),
        r["workspace_revision"],
        r["success"],
        r["exit_code"],
        r["verification_state_changed"],
        tool.error_code
    ])
}

pub(crate) fn commands(
    tools: &[AgentToolCallView],
    revision: Option<&str>,
    root: &Path,
) -> Assessment {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_owned());
    let mut value = Assessment {
        revision: revision.map(str::to_owned),
        ..Assessment::default()
    };
    let mut attempts = BTreeMap::new();
    for tool in tools.iter().filter(|t| {
        t.name == "run_command" && crate::agent_runtime::verification_command(&t.arguments)
    }) {
        let target = cwd(tool, &root);
        let key = json!([tool.arguments["program"], target, tool.arguments["argv"]]).to_string();
        // Retain the latest execution and latest pre-execution rejection
        // separately for each target: a rejected retry cannot erase its failure.
        attempts.insert((key, not_executed(tool)), (tool, target));
    }
    for (tool, target) in attempts.values() {
        let r = tool.receipt.as_ref().unwrap_or(&Value::Null);
        let unexecuted = not_executed(tool);
        let executed = tool.effect == fielora_contracts::AgentToolEffect::Process
            && tool.status == AgentToolStatus::Completed
            && r["verification_eligible"] == true
            && r["success"].is_boolean();
        // A removed project-local scratch directory is no longer an active
        // check subject. It contributes neither a pass nor a current failure.
        // Never retire the project root or an inaccessible/external directory.
        let retired = target != &root
            && target.starts_with(&root)
            && std::fs::metadata(target).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound);
        let current = revision.is_some() && r["workspace_revision"].as_str() == revision;
        let state = if tool.status == AgentToolStatus::Unknown {
            "OUTCOME_UNKNOWN"
        } else if unexecuted {
            "NOT_EXECUTED"
        } else if retired {
            "RETIRED_TARGET"
        } else if !executed {
            "NO_CHECK_RESULT"
        } else if r["verification_state_changed"] == true {
            "INPUT_CHANGED_DURING_CHECK"
        } else if current && r["success"] == true {
            "PASSED"
        } else if current {
            "FAILED"
        } else if r["success"] == false {
            "STALE_FAILED"
        } else {
            "STALE"
        };
        let display_directory = target.strip_prefix(&root).ok().map(|relative| {
            if relative.as_os_str().is_empty() {
                ".".to_owned()
            } else {
                relative.to_string_lossy().replace('\\', "/")
            }
        });
        let check = json!({"tool_call_id":tool.id,"program":tool.arguments["program"],
            "argv":tool.arguments["argv"],"cwd":target,"display_directory":display_directory,"state":state,
            "workspace_revision":r["workspace_revision"],"exit_code":r["exit_code"],"error_code":tool.error_code});
        if state == "PASSED" {
            value.supported = true;
        }
        if matches!(
            state,
            "FAILED"
                | "STALE_FAILED"
                | "INPUT_CHANGED_DURING_CHECK"
                | "OUTCOME_UNKNOWN"
                | "NO_CHECK_RESULT"
        ) {
            value.block(state, check.clone());
        }
        value.checks.push(check);
    }
    value
}

// Admitted only by FIELORA_E2E and the exact fixture model in agent_runtime.
// Uses production tools and receipts; no real Provider or application data.
pub(crate) fn fixture(
    request: &fielora_model::AgentModelRequest,
    tools: &[AgentToolCallView],
    resumed: bool,
) -> Result<fielora_model::AgentModelTurn, fielora_model::ModelError> {
    use fielora_model::{AgentModelMessage, AgentModelToolCall, AgentModelTurn, ModelError};
    let call = |name: &str, arguments: Value| {
        Ok(AgentModelTurn {
            text: String::new(),
            continuation: None,
            usage: None,
            tool_calls: vec![AgentModelToolCall {
                id: format!("assessment-{}", tools.len()),
                name: name.into(),
                arguments,
            }],
        })
    };
    let context = request
        .messages
        .iter()
        .filter_map(|m| match m {
            AgentModelMessage::User(s) => Some(s.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let finish = |evidence: usize| {
        json!({"outcome":"completed","remaining_work":[],"required_evidence":[],"intent":"workspace_change",
        "request_quote":"执行隔离验证，保留原始输入。","summary":"隔离检查已执行；结果仅覆盖记录的断言，不表示业务要求全部获得独立验收。",
        "evidence_tool_call_ids":[tools[evidence].id]})
    };
    let command = |module: &str, dir: &str| json!({"program":"/usr/bin/python3","argv":["-B","-m","unittest",module,"-v"],"cwd":dir,"timeout_ms":10000});
    let plan = |result: Value| {
        json!({"write_paths":["marker.txt"],"preserve":["input.csv"],
        "criteria":[{"id":"restart","expected":"用新进程检查测试数据库持久化","result":result}],
        "next_step":{"kind":"verify","action":"Verify the isolated new-process case"}})
    };
    match tools.len() {
        0 => call("read_file", json!({"path":"test_baseline.py"})),
        1 => call(
            "create_file",
            json!({"path":"marker.txt","content":"ready\n"}),
        ),
        2 => call("run_command", command("test_baseline", "../outside")),
        3 => call("finish_task", finish(1)),
        4 => {
            let r = tools[3].receipt.as_ref().unwrap();
            if tools[3].error_code.as_deref() != Some("AGENT_VERIFICATION_REQUIRED")
                || !r.to_string().contains("NOT_EXECUTED")
                || !r.to_string().contains(&tools[2].id.0)
            {
                return Err(ModelError::ProviderProtocolError);
            }
            call("run_command", command("test_baseline", "."))
        }
        5 => call(
            "run_command",
            json!({"program":"/usr/bin/python3","argv":["-B","-c","import pathlib,shutil; p=pathlib.Path('_scratch'); p.mkdir(); [shutil.copyfile(f,p/f) for f in ['test_baseline.py','value.py','marker.txt']]; (p/'value.py').write_text('def valid_name(value): return True' + chr(10))"],"timeout_ms":5000}),
        ),
        6 => call("run_command", command("test_baseline", "_scratch")),
        7 => call("run_command", command("test_baseline", ".")),
        8 if !resumed => Err(ModelError::ProviderUnavailable),
        8 => {
            if !context.contains("\"state\":\"FAILED\"") || !context.contains(&tools[6].id.0) {
                return Err(ModelError::ProviderProtocolError);
            }
            call("finish_task", finish(7))
        }
        9 => {
            if tools[8].error_code.as_deref() != Some("AGENT_VERIFICATION_REQUIRED")
                || !tools[8]
                    .receipt
                    .as_ref()
                    .unwrap()
                    .to_string()
                    .contains(&tools[6].id.0)
            {
                return Err(ModelError::ProviderProtocolError);
            }
            call(
                "run_command",
                json!({"program":"/usr/bin/python3","argv":["-B","-c","import shutil; shutil.rmtree('_scratch')"],"timeout_ms":5000}),
            )
        }
        10 => call("run_command", command("test_outer.Mutations", ".")),
        11 => call(
            "work_plan",
            plan(
                json!({"outcome":"pending","actual":"New-process persistence is still unverified"}),
            ),
        ),
        12 => call("finish_task", finish(10)),
        13 => {
            if tools[12].error_code.as_deref() != Some("AGENT_ACCEPTANCE_SCOPE_REQUIRED") {
                return Err(ModelError::ProviderProtocolError);
            }
            call("run_command", command("test_outer.Persistence", "."))
        }
        14 => call(
            "work_plan",
            plan(
                json!({"outcome":"passed","actual":"A child process reopened the isolated database and checked its contents","tool_call_id":tools[13].id,"input_paths":["test_outer.py"]}),
            ),
        ),
        _ => call("finish_task", finish(13)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tool(id: &str, dir: &str, success: bool, revision: &str) -> AgentToolCallView {
        serde_json::from_value(json!({"id":id,"run_id":"run","name":"run_command","effect":"PROCESS",
            "status":"COMPLETED","policy_decision":"ALLOW","arguments":{"program":"python3","argv":["-m","unittest","tests"],"cwd":dir},
            "receipt":{"success":success,"exit_code":if success{0}else{1},"verification_eligible":true,"workspace_revision":revision},
            "error_code":null,"created_at":0,"updated_at":0})).unwrap()
    }
    #[test]
    fn unexecuted_rejection_is_visible_but_cannot_poison_or_establish_verification() {
        let mut rejected = tool("rejected", "/outside", false, "v1");
        rejected.status = AgentToolStatus::Failed;
        rejected.error_code = Some("AGENT_WORKSPACE_ESCAPE".into());
        rejected.receipt = Some(json!({"kind":"TOOL_EXECUTION_FAILED"}));
        let root = std::env::temp_dir();
        let checks = vec![rejected.clone(), tool("green", ".", true, "v1")];
        let assessment = commands(&checks, Some("v1"), &root);
        assert!(assessment.passed());
        assert!(assessment.recovery().contains("rejected"));
        assert!(assessment.recovery().contains("NOT_EXECUTED"));
        assert!(!commands(&[rejected], Some("v1"), &root).passed());
    }
    #[test]
    fn unexecuted_retry_cannot_erase_a_real_failure() {
        let root = std::env::temp_dir();
        let failed = tool("failed", ".", false, "v1");
        let mut rejected = tool("rejected", ".", false, "v1");
        rejected.status = AgentToolStatus::Denied;
        rejected.receipt = None;
        let mut other = tool("other", ".", true, "v1");
        other.arguments["argv"] = json!(["-m", "unittest", "other"]);
        let mut checks = vec![failed, rejected, other];
        let assessment = commands(&checks, Some("v1"), &root);
        assert!(!assessment.passed());
        assert_eq!(assessment.blockers[0]["details"]["tool_call_id"], "failed");
        assert!(
            assessment
                .checks
                .iter()
                .any(|c| c["state"] == "NOT_EXECUTED")
        );
        checks.push(tool("repaired", ".", true, "v1"));
        assert!(commands(&checks, Some("v1"), &root).passed());
    }
    #[test]
    fn current_and_stale_failures_on_existing_targets_require_actual_recovery() {
        let root = std::env::temp_dir();
        let failed = tool("failed", ".", false, "v1");
        let mut other = tool("other", ".", true, "v2");
        other.arguments["argv"] = json!(["-m", "unittest", "other"]);
        let mut checks = vec![failed, other];
        let assessment = commands(&checks, Some("v2"), &root);
        assert!(!assessment.passed());
        assert_eq!(assessment.blockers[0]["reason"], "STALE_FAILED");
        assert!(assessment.recovery().contains("failed"));
        checks.push(tool("repaired", ".", true, "v2"));
        assert!(commands(&checks, Some("v2"), &root).passed());
        checks.push(tool("regression", ".", false, "v2"));
        assert!(!commands(&checks, Some("v2"), &root).passed());
        assert!(!commands(&checks, None, &root).passed());
    }
    #[test]
    fn separate_directories_never_mask_failure_and_removed_scratch_is_history() {
        let root =
            std::env::temp_dir().join(format!("fielora-assessment-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(root.join("mutant")).unwrap();
        let checks = vec![
            tool("negative", "mutant", false, "v1"),
            tool("baseline", ".", true, "v1"),
        ];
        assert!(!commands(&checks, Some("v1"), &root).passed());
        std::fs::remove_dir(root.join("mutant")).unwrap();
        assert!(commands(&checks, Some("v1"), &root).passed());
        assert!(!commands(&checks[..1], Some("v1"), &root).passed());
        // Cold recovery from the same durable receipts yields exactly the same assessment.
        let restored: Vec<AgentToolCallView> =
            serde_json::from_value(serde_json::to_value(&checks).unwrap()).unwrap();
        assert_eq!(
            commands(&checks, Some("v1"), &root).projection(),
            commands(&restored, Some("v1"), &root).projection()
        );
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn changed_inputs_are_not_a_success_and_log_noise_is_not_progress() {
        let root = std::env::temp_dir();
        let mut t = tool("one", ".", true, "v1");
        t.receipt.as_mut().unwrap()["verification_state_changed"] = json!(true);
        assert!(!commands(&[t.clone()], Some("v1"), &root).passed());
        let key = progress_key(&t);
        t.receipt.as_mut().unwrap()["stdout_sha256"] = json!("new-clock-output");
        t.id = fielora_contracts::ToolCallId::new("two");
        assert_eq!(key, progress_key(&t));
        t.receipt.as_mut().unwrap()["workspace_revision"] = json!("v2");
        assert_ne!(key, progress_key(&t));
    }

    #[test]
    fn timeout_or_unknown_execution_is_not_a_pre_execution_rejection() {
        let root = std::env::temp_dir();
        let mut timeout = tool("timeout", ".", false, "v1");
        timeout.status = AgentToolStatus::Failed;
        timeout.error_code = Some("AGENT_COMMAND_TIMEOUT".into());
        timeout.receipt = Some(json!({"kind":"TOOL_EXECUTION_FAILED"}));
        let mut other = tool("other", ".", true, "v1");
        other.arguments["argv"] = json!(["-m", "unittest", "other"]);
        let assessment = commands(&[timeout.clone(), other], Some("v1"), &root);
        assert!(!assessment.passed());
        assert_eq!(assessment.blockers[0]["reason"], "NO_CHECK_RESULT");
        timeout.status = AgentToolStatus::Unknown;
        assert_eq!(
            commands(&[timeout], Some("v1"), &root).blockers[0]["reason"],
            "OUTCOME_UNKNOWN"
        );
    }
}
