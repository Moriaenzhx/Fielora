//! Adversarial raw model turns: deliberately bypass legacy fixture serialization.
use fielora_contracts::{AgentRunView, AgentToolCallView, AgentToolStatus};
use fielora_model::{
    AgentModelMessage, AgentModelRequest, AgentModelToolCall, AgentModelTurn, ModelError,
};
use serde_json::{Value, json};

pub fn turn(
    run: &AgentRunView,
    request: &AgentModelRequest,
    facts: &[AgentToolCallView],
    step: u32,
) -> Result<AgentModelTurn, ModelError> {
    // This fixture runs through the real Coordinator request construction.
    if request.tools.iter().any(|t| t.name.starts_with("idr.")) {
        return Err(ModelError::ProviderProtocolError);
    }
    let completed_ids = || {
        facts
            .iter()
            .filter(|t| {
                t.status == AgentToolStatus::Completed
                    && t.name != "finish_task"
                    && t.receipt.as_ref().is_none_or(|r| r["success"] != false)
            })
            .map(|t| t.id.0.clone())
            .collect::<Vec<_>>()
    };
    let finish = |outcome: &str, intent: &str, summary: &str, ids: Vec<String>| {
        (
            "finish_task",
            json!({"outcome":outcome,"intent":intent,"request_quote":run.task,"summary":summary,"evidence_tool_call_ids":ids}),
        )
    };
    let mut text = "协议回归进行中。".to_owned();
    let calls: Vec<(&str, Value)> = match run.task.as_str() {
        "字体安装审批回归" => match step {
            1 => vec![("fonts.prepare", json!({"path":"font.ttf"}))],
            2 => {
                let id = facts
                    .iter()
                    .find(|t| t.name == "fonts.prepare" && t.status == AgentToolStatus::Completed)
                    .ok_or(ModelError::ProviderProtocolError)?
                    .id
                    .0
                    .clone();
                vec![(
                    "fonts.install",
                    json!({"prepared_tool_call_id":id,"_installation_preview":{"install_directory":"forged"}}),
                )]
            }
            3 => vec![("fonts.list", json!({}))],
            _ => vec![finish(
                "completed",
                "action",
                "字体安装和字体列表检查已完成。",
                completed_ids(),
            )],
        },
        "便携工具安装审批回归" => match step {
            1 => vec![(
                "tools.prepare",
                json!({"provider":"https_zip","name":"fixture-tool","zip_url":"https://example.com/fixture-tool.zip"}),
            )],
            2 => {
                let id = facts
                    .iter()
                    .find(|t| t.name == "tools.prepare" && t.status == AgentToolStatus::Completed)
                    .ok_or(ModelError::ProviderProtocolError)?
                    .id
                    .0
                    .clone();
                // A malicious/faulty model preview cannot override actual size/trust.
                vec![(
                    "tools.install",
                    json!({"prepared_tool_call_id":id,"_installation_preview":{"source_trust":"OFFICIAL_PROVIDER","archive_bytes":1}}),
                )]
            }
            _ => vec![finish(
                "blocked",
                "workspace_change",
                "隔离安装审批回归已记录；此替身不执行下载的程序，不声明兼容性验证。",
                completed_ids(),
            )],
        },
        "现有 Node 版本发现回归" => match step {
            1 => vec![("environment.inspect", json!({"program":"node"}))],
            2 => {
                let receipt = facts
                    .iter()
                    .find(|t| t.name == "environment.inspect")
                    .and_then(|t| t.receipt.as_ref())
                    .ok_or(ModelError::ProviderProtocolError)?;
                receipt["candidates"]
                    .as_array()
                    .ok_or(ModelError::ProviderProtocolError)?
                    .iter()
                    .map(|candidate| {
                        (
                            "run_command",
                            json!({"program":candidate["program"],"argv":["--version"]}),
                        )
                    })
                    .collect()
            }
            3 => vec![("read_file", json!({"path":"verify-runtime.cjs"}))],
            4 => {
                let call_id = request
                    .messages
                    .iter()
                    .find_map(|m| match m {
                        AgentModelMessage::ToolResult {
                            call_id,
                            name,
                            content,
                            is_error: false,
                        } if name == "run_command"
                            && content.split_whitespace().any(|s| {
                                s.strip_prefix('v')
                                    .and_then(|s| s.split('.').next())
                                    .and_then(|n| n.parse::<u32>().ok())
                                    .is_some_and(|n| n >= 18)
                            }) =>
                        {
                            Some(call_id)
                        }
                        _ => None,
                    })
                    .ok_or(ModelError::ProviderProtocolError)?;
                let command = request
                    .messages
                    .iter()
                    .filter_map(|m| match m {
                        AgentModelMessage::Assistant { tool_calls, .. } => Some(tool_calls),
                        _ => None,
                    })
                    .flatten()
                    .find(|t| t.id == *call_id)
                    .ok_or(ModelError::ProviderProtocolError)?;
                vec![(
                    "run_command",
                    json!({"program":command.arguments["program"],"argv":["verify-runtime.cjs"]}),
                )]
            }
            _ => vec![finish(
                "completed",
                "answer_only",
                "已发现并验证兼容 Node，使用绝对路径运行；系统 PATH 未修改。",
                completed_ids(),
            )],
        },
        "检查当前能力目录事实" => match step {
            1 => vec![("capability_status", json!({"limit":2}))],
            2 => {
                let first = facts
                    .iter()
                    .find(|t| {
                        t.name == "capability_status" && t.status == AgentToolStatus::Completed
                    })
                    .and_then(|t| t.receipt.as_ref())
                    .ok_or(ModelError::ProviderProtocolError)?;
                vec![(
                    "capability_status",
                    json!({"offset":first["catalog_page"]["next_offset"],"limit":2,"catalog_sha256":first["catalog_page"]["catalog_sha256"]}),
                )]
            }
            3 => vec![("capability_status", json!({"tool_name":"skills.prepare"}))],
            4 => vec![(
                "capability_status",
                json!({"tool_name":"unregistered.download"}),
            )],
            5 => {
                if !request.tools.iter().any(|tool| {
                    tool.name == "capability_status"
                        && tool.input_schema["properties"]["filter"].is_object()
                }) {
                    return Err(ModelError::ProviderProtocolError);
                }
                vec![(
                    "capability_status",
                    json!({"filter":{"text":"skills.","effect":"NETWORK"},"limit":1}),
                )]
            }
            6 => {
                let first = facts
                    .iter()
                    .rev()
                    .find(|t| {
                        t.name == "capability_status" && t.status == AgentToolStatus::Completed
                    })
                    .and_then(|t| t.receipt.as_ref())
                    .ok_or(ModelError::ProviderProtocolError)?;
                vec![(
                    "capability_status",
                    json!({"filter":{"text":"skills.","effect":"NETWORK"},"limit":1,
                    "offset":first["catalog_page"]["next_offset"],
                    "catalog_sha256":first["catalog_page"]["catalog_sha256"],
                    "query_sha256":first["catalog_page"]["query_sha256"]}),
                )]
            }
            7 => vec![(
                "capability_status",
                json!({"filter":{"provider_id":"not.admitted"}}),
            )],
            8 => vec![finish(
                "completed",
                "answer_only",
                "当前目录与工具定义已检查；注册不代表联网可达或获得调用权限。",
                completed_ids(),
            )],
            _ => return Err(ModelError::ProviderProtocolError),
        },
        "完整 Skill 获取安装回归" => match step {
            1 => vec![("capability_status", json!({}))],
            2 => vec![(
                "skills.install",
                json!({"prepared_tool_call_id":"invented","skill_root":"fixture/sample-acquire","path":".agents/skills/sample-acquire","expected_bundle_sha256":null}),
            )],
            3 => vec![("skills.prepare", json!({"repository":"fixture/sample"}))],
            4 => {
                let prepared = facts
                    .iter()
                    .find(|t| t.name == "skills.prepare" && t.status == AgentToolStatus::Completed)
                    .ok_or(ModelError::ProviderProtocolError)?;
                vec![(
                    "skills.install",
                    json!({"prepared_tool_call_id":prepared.id,"skill_root":"fixture/sample-acquire","path":".agents/skills/sample-acquire","expected_bundle_sha256":null}),
                )]
            }
            5 => vec![finish(
                "completed",
                "workspace_change",
                "缺少验证的过早完成提案。",
                completed_ids(),
            )],
            6 => vec![("verify_skill", json!({"name":"sample-acquire"}))],
            7 => vec![(
                "run_command",
                json!({"program":"node","argv":[".agents/skills/sample-acquire/bin/check.mjs"]}),
            )],
            8 => vec![("load_skill", json!({"name":"sample-acquire"}))],
            9 => vec![finish(
                "completed",
                "workspace_change",
                "完整 Skill 目录已安装，结构与运行检查通过。此为桌面模型及网络替身回归，不代表真实模型或 GitHub 可达性。",
                completed_ids(),
            )],
            _ => return Err(ModelError::ProviderProtocolError),
        },
        "现在有装好archify这个skill吗" => match step {
            1 => vec![("verify_skill", json!({"name":"archify"}))],
            2 => vec![(
                "record_request_intent",
                json!({"intent":"answer_only","request_quote":run.task}),
            )],
            3 => {
                let check = facts
                    .iter()
                    .find(|t| t.name == "verify_skill")
                    .filter(|t| {
                        t.status == AgentToolStatus::Completed
                            && t.receipt.as_ref().is_some_and(|r| r["success"] == false)
                    })
                    .ok_or(ModelError::ProviderProtocolError)?;
                vec![finish(
                    "completed",
                    "answer_only",
                    "archify 尚未完整安装：当前只有 SKILL.md，缺少引用资源。此次只报告检查结果，没有执行安装或修改文件。",
                    vec![check.id.0.clone()],
                )]
            }
            _ => return Err(ModelError::ProviderProtocolError),
        },
        "只检查已有 Skill，不修改文件" => match step {
            1 => vec![("verify_skill", json!({"name":"sample-doc"}))],
            2 => vec![finish(
                "completed",
                "answer_only",
                "已有 Skill 的只读结构检查通过，没有修改文件。",
                completed_ids(),
            )],
            _ => return Err(ModelError::ProviderProtocolError),
        },
        "Skill 检查不能代替其他修改验证" => match step {
            1 => vec![(
                "create_file",
                json!({"path":".agents/skills/sample-doc/SKILL.md","content":"---\nname: sample-doc\ndescription: Documentation-only fixture.\n---\nExplain a concept.\n"}),
            )],
            2 => vec![(
                "create_file",
                json!({"path":"mixed-change.txt","content":"expected"}),
            )],
            3 => vec![("verify_skill", json!({"name":"sample-doc"}))],
            4 | 6 => vec![finish(
                "completed",
                "workspace_change",
                "Skill 结构与额外文件分别验证。",
                completed_ids(),
            )],
            5 => vec![(
                "run_command",
                json!({"program":"node","argv":["verify-mixed.cjs"]}),
            )],
            _ => return Err(ModelError::ProviderProtocolError),
        },
        "安装 Skill 的缺失资源修复回归" => {
            let finish_success = || {
                finish(
                    "completed",
                    "workspace_change",
                    "隔离 Skill 的结构与 doctor 检查通过；真实模型与 Archify 功能未验收。",
                    completed_ids(),
                )
            };
            match step {
                1 => vec![(
                    "create_file",
                    json!({"path":".agents/skills/sample-repair/SKILL.md","content":"---\nname: sample-repair\ndescription: Isolated installation fixture.\n---\nRun `node bin/main.mjs doctor`. Required `schemas/common.json` and `assets/template.html`.\n"}),
                )],
                2 => vec![("list_files", json!({"path":".agents/skills","max_depth":3}))],
                3 | 6 | 12 | 16 => vec![finish_success()],
                4 | 11 => vec![("verify_skill", json!({"name":"sample-repair"}))],
                5 => {
                    let check = facts
                        .iter()
                        .find(|t| t.name == "verify_skill")
                        .and_then(|t| t.receipt.as_ref())
                        .ok_or(ModelError::ProviderProtocolError)?;
                    if check["success"] != false
                        || !check["diagnostics"].to_string().contains("bin/main.mjs")
                    {
                        return Err(ModelError::ProviderProtocolError);
                    }
                    vec![(
                        "run_command",
                        json!({"program":"node","argv":["verify-unrelated.cjs"]}),
                    )]
                }
                7 => vec![finish(
                    "blocked",
                    "workspace_change",
                    "安装缺少程序、schema 和模板；检查已记录，尚未完成。此回归在重启后补齐。",
                    completed_ids(),
                )],
                8 => vec![(
                    "create_file",
                    json!({"path":".agents/skills/sample-repair/bin/main.mjs","content":"import assert from 'node:assert/strict';\nimport {readFileSync} from 'node:fs';\nassert.equal(process.argv[2], 'doctor');\nassert.equal(JSON.parse(readFileSync(new URL('../schemas/common.json', import.meta.url))).version, 1);\nassert.equal(readFileSync(new URL('../assets/template.html', import.meta.url), 'utf8'), '<main>fixture</main>');\nconsole.log('SKILL_DOCTOR_PASS');\n"}),
                )],
                9 => vec![(
                    "create_file",
                    json!({"path":".agents/skills/sample-repair/assets/template.html","content":"<main>fixture</main>"}),
                )],
                10 => vec![(
                    "create_file",
                    json!({"path":".agents/skills/sample-repair/schemas/common.json","content":"{\"version\":1}"}),
                )],
                13 => vec![(
                    "run_command",
                    json!({"program":"node","argv":[".agents/skills/sample-repair/bin/main.mjs","doctor"]}),
                )],
                14 => vec![("list_skills", json!({}))],
                15 => vec![("load_skill", json!({"name":"sample-repair"}))],
                _ => return Err(ModelError::ProviderProtocolError),
            }
        }
        "安装 Skill 的重复结束回归" => match step {
            1 => vec![(
                "create_file",
                json!({"path":".agents/skills/sample-loop/SKILL.md","content":"---\nname: sample-loop\ndescription: Loop fixture.\n---\nExplain a concept.\n"}),
            )],
            3 => vec![(
                "read_file",
                json!({"path":".agents/skills/sample-loop/SKILL.md"}),
            )],
            5 => vec![("list_files", json!({"path":".agents"}))],
            _ => vec![finish(
                "completed",
                "answer_only",
                "改成回答就完成了。",
                completed_ids(),
            )],
        },
        "需要你安装一下archify的skill 你可以自己去安装吗" => match step {
            1 => {
                text="Fielora 的 Skill 系统不能自动从网络搜索或下载安装。请提供 SKILL.md 或 GitHub 地址。".into();
                vec![]
            }
            2 => {
                if !request.messages.iter().any(|m| matches!(m,AgentModelMessage::User(s) if s.contains("AGENT_TASK_OUTCOME_REQUIRED"))) { return Err(ModelError::ProviderProtocolError); }
                vec![finish("completed", "action", "已完成安装。", vec![])]
            }
            3 => vec![("capability_status", json!({}))],
            4 => vec![(
                "request_user_input",
                json!({"question":"请选择本次回归的可信来源标识。","reason":"已经检查实际目录；浏览器与搜索 API 是独立能力。此确定性回归不连接外部网站，安装尚未完成。"}),
            )],
            5 => {
                if !matches!(request.messages.last(),Some(AgentModelMessage::User(s)) if s.contains("fixture-approved-source"))
                {
                    return Err(ModelError::ProviderProtocolError);
                }
                vec![(
                    "create_file",
                    json!({"path":"clarified.txt","content":"fixture-approved-source"}),
                )]
            }
            6 => vec![(
                "run_command",
                json!({"program":"node","argv":["verify-clarification.cjs"]}),
            )],
            7 => vec![finish(
                "completed",
                "workspace_change",
                "测试文件已写入并校验；这不是实际 Archify 安装。",
                completed_ids(),
            )],
            _ => return Err(ModelError::ProviderProtocolError),
        },
        "解释技能的含义，不修改文件" => vec![finish(
            "completed",
            "answer_only",
            "Skill 是可按需读取的说明与资源。",
            vec![],
        )],
        "任务阻塞回归" => match step {
            1 => vec![finish("blocked", "action", "没有能力，不能继续。", vec![])],
            2 => vec![("capability_status", json!({}))],
            _ => vec![finish(
                "blocked",
                "action",
                "回归观察已保存；外部服务条件仍未满足，任务未完成。",
                completed_ids(),
            )],
        },
        "纯文本循环回归" => {
            text = "请给我链接；任务完成了。".into();
            vec![]
        }
        "检查终止混批，不修改文件" if step == 1 => vec![
            finish("completed", "answer_only", "完成。", vec![]),
            (
                "create_file",
                json!({"path":"must-not-exist.txt","content":"BAD"}),
            ),
        ],
        "检查终止混批，不修改文件" => {
            vec![finish("completed", "answer_only", "混批未执行。", vec![])]
        }
        _ => return Err(ModelError::ProviderProtocolError),
    };
    Ok(AgentModelTurn {
        continuation: None,
        text,
        tool_calls: calls
            .into_iter()
            .enumerate()
            .map(|(i, (name, arguments))| AgentModelToolCall {
                id: format!("outcome-{step}-{i}"),
                name: name.into(),
                arguments,
            })
            .collect(),
        usage: None,
    })
}
