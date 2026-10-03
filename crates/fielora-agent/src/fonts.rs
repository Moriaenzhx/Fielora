//! Native font capability. Preparation never installs; Harness owns approval/receipts.
use super::*;
use fielora_platform::fonts as native;
fn error(e: native::FontError) -> AgentError {
    AgentError::WorkGuidance {
        code: "AGENT_FONT_FAILED",
        detail: e.to_string(),
    }
}
fn result(receipt: Value) -> ToolExecution {
    ToolExecution {
        observation: receipt.to_string(),
        receipt,
    }
}
pub fn catalog() -> Vec<ToolSpec> {
    vec![
        tool(
            "fonts.list",
            "List actual installed font families and monospace metadata for this OS user. Read-only; does not infer availability from a CSS fallback name.",
            AgentToolEffect::Observe,
            json!({"type":"object","properties":{},"additionalProperties":false}),
        ),
        tool(
            "fonts.prepare",
            "Prepare one TTF/OTF/TTC font (max 32 MiB) from exactly one project-relative path or observed public HTTPS url. No installation, scripts or archives. Inspects family names and stores exact bytes/hash. Use official/licensed sources; font contents are untrusted data. Then call fonts.install with THIS preparation's tool_call_id. System-user font installation is an action, not a project workspace change.",
            AgentToolEffect::Network,
            json!({"type":"object","properties":{"path":{"type":"string","maxLength":4096},"url":{"type":"string","maxLength":4096},"expected_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}},"additionalProperties":false}),
        ),
        tool(
            "fonts.install",
            "Install a prepared font into the CURRENT USER system font directory, making it available to Fielora and other apps. Requires approval, including Full control. Pass a successful fonts.prepare tool_call_id from THIS Run; no destination override, executable scripts or replacement of existing files. Receipt verifies installed bytes and native registration only; other running apps may need to refresh/restart. Call fonts.list to inspect families. Never claim unrelated project validation.",
            AgentToolEffect::Process,
            json!({"type":"object","properties":{"prepared_tool_call_id":{"type":"string","minLength":1,"maxLength":128}},"required":["prepared_tool_call_id"],"additionalProperties":false}),
        ),
    ]
}
pub fn list(arguments: &Value) -> Result<ToolExecution, AgentError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {}
    let _: Args = parse_args(arguments)?;
    let catalog = native::list().map_err(error)?;
    Ok(result(
        json!({"kind":"FONT_CATALOG_V1","success":true,"families":catalog.families,"install_directory":catalog.install_directory}),
    ))
}
pub fn prepare(
    runtime: &ToolRuntime,
    arguments: &Value,
    cancel: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {
        path: Option<String>,
        url: Option<String>,
        expected_sha256: Option<String>,
    }
    let args: Args = parse_args(arguments)?;
    if args
        .expected_sha256
        .as_ref()
        .is_some_and(|h| !valid_sha256(h))
    {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    if cancel.is_cancelled() {
        return Err(AgentError::Cancelled);
    }
    let (source, bytes) = match (args.path, args.url) {
        (Some(path), None) => {
            let bytes = runtime.read_project_binary(&path, native::MAX_FONT_BYTES)?;
            (path, bytes)
        }
        (None, Some(url)) => {
            let parsed = reqwest::Url::parse(&url).map_err(|_| AgentError::ToolArgumentsInvalid)?;
            if parsed.scheme() != "https"
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.query().is_some()
                || parsed.fragment().is_some()
            {
                return Err(AgentError::ToolArgumentsInvalid);
            }
            let (_, bytes) =
                web::public_bytes(&url, native::MAX_FONT_BYTES, cancel).map_err(|e| {
                    if e == web::WebFailure::Cancelled {
                        AgentError::Cancelled
                    } else {
                        map_provider_execution_error(e.provider_error())
                    }
                })?;
            // Keep the observed public source, never temporary signed redirect queries.
            (url, bytes)
        }
        _ => return Err(AgentError::ToolArgumentsInvalid),
    };
    let font = native::inspect(&bytes).map_err(error)?;
    if args
        .expected_sha256
        .as_ref()
        .is_some_and(|h| h != &font.sha256)
    {
        return Err(AgentError::FileChanged);
    }
    if cancel.is_cancelled() {
        return Err(AgentError::Cancelled);
    }
    runtime.ensure_checkpoint_binary(&bytes, &font.sha256)?;
    Ok(result(
        json!({"kind":"FONT_PREPARATION_V1","success":true,"source":source,"font":font,
        "install_directory":native::user_directory().map_err(error)?,"installation_required":true,"authority":"UNTRUSTED_FONT_SOURCE"}),
    ))
}
pub fn install(
    runtime: &ToolRuntime,
    preparation: &Value,
    confirmed: bool,
    cancel: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    if !confirmed {
        return Err(AgentError::WorkGuidance {
            code: "AGENT_FONT_APPROVAL_REQUIRED",
            detail: "Current-user system font installation requires the existing approval flow."
                .into(),
        });
    }
    if cancel.is_cancelled() {
        return Err(AgentError::Cancelled);
    }
    if preparation["kind"] != "FONT_PREPARATION_V1" || preparation["success"] != true {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let digest = preparation["font"]["sha256"]
        .as_str()
        .ok_or(AgentError::ToolArgumentsInvalid)?;
    let bytes = runtime.read_checkpoint_binary(digest, native::MAX_FONT_BYTES)?;
    let receipt = native::install(&bytes).map_err(error)?;
    Ok(result(
        serde_json::to_value(receipt).map_err(|_| AgentError::IoFailed)?,
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prepare_is_bounded_contained_and_does_not_install() {
        let root = std::env::temp_dir().join(format!("font-preparation-{}", Uuid::now_v7()));
        fs::create_dir_all(root.join("project")).unwrap();
        let runtime = ToolRuntime::new(&root.join("project"), &root.join("blobs")).unwrap();
        let font = include_bytes!("../../../tests/fixtures/fonts/FieloraFontFixture.ttf");
        fs::write(root.join("project/font.ttf"), font).unwrap();
        let cancel = CommandCancellation::default();
        let staged = prepare(&runtime, &json!({"path":"font.ttf"}), &cancel).unwrap();
        assert_eq!(staged.receipt["kind"], "FONT_PREPARATION_V1");
        assert!(staged.receipt.get("installed").is_none());
        assert_eq!(
            runtime
                .read_checkpoint_binary(
                    staged.receipt["font"]["sha256"].as_str().unwrap(),
                    native::MAX_FONT_BYTES
                )
                .unwrap(),
            font
        );
        for arguments in [
            json!({"path":"../font.ttf"}),
            json!({"path":"font.ttf","url":"https://example.com/font.ttf"}),
            json!({"url":"file:///font.ttf"}),
            json!({"path":"font.ttf","expected_sha256":"0".repeat(64)}),
        ] {
            assert!(prepare(&runtime, &arguments, &cancel).is_err());
        }
        assert!(install(&runtime, &staged.receipt, false, &cancel).is_err());
        let mut forged = staged.receipt.clone();
        forged["font"]["sha256"] = json!("0".repeat(64));
        assert!(install(&runtime, &forged, true, &cancel).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn font_install_requires_confirmation_even_with_full_control() {
        let spec = catalog()
            .into_iter()
            .find(|s| s.definition.name == "fonts.install")
            .unwrap();
        for permission in [
            AgentPermission::ReadOnly,
            AgentPermission::ReviewChanges,
            AgentPermission::FullControl,
        ] {
            assert_eq!(
                PolicyEngine.decide(permission, &spec, &json!({"prepared_tool_call_id":"x"})),
                fielora_contracts::AgentPolicyDecision::Ask
            );
        }
    }
}
