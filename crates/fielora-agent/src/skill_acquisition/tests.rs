use super::*;
use zip::write::SimpleFileOptions;

fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zip.start_file(*name, SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}
fn fixture() -> (PathBuf, ToolRuntime) {
    let root = std::env::temp_dir().join(format!("fielora-acquire-{}", Uuid::now_v7()));
    fs::create_dir_all(&root).unwrap();
    let runtime = ToolRuntime::new(&root, &root.join("artifacts")).unwrap();
    (root, runtime)
}
const SKILL: &[u8] =
    b"---\nname: sample\ndescription: Acquisition fixture.\n---\nRead `assets/data.bin`.\n";

#[test]
fn observed_distribution_candidates_are_bounded_and_use_immutable_raw_api_urls() {
    let tree = json!({"tree":[
        {"path":"sample.zip","type":"blob","mode":"100644","size":42,"sha":"a".repeat(40)},
        {"path":"huge.zip","type":"blob","mode":"100644","size":MAX_ARCHIVE+1,"sha":"b".repeat(40)},
        {"path":"link.zip","type":"blob","mode":"120000","size":42,"sha":"b".repeat(40)},
        {"path":"../escape.zip","type":"blob","mode":"100644","size":42,"sha":"b".repeat(40)}
    ]});
    let found = distribution_archives(&tree, "owner/repo", "commit");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0]["content_inspected"], false);
    assert!(github_blob_url(found[0]["zip_url"].as_str().unwrap()));
    assert!(!github_blob_url(
        "https://api.github.com.evil/repos/o/r/git/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ));
    assert!(!github_blob_url(
        "https://api.github.com/repos/o/r/git/blobs/main"
    ));
}

#[test]
#[ignore = "explicit public distribution download and guarded project install; no script execution"]
fn live_observed_archify_distribution() {
    let (root, runtime) = if let Some(path) = std::env::var_os("FIELORA_LIVE_SKILL_PROJECT") {
        let root = PathBuf::from(path);
        let runtime = ToolRuntime::new(
            &root,
            &root.join("artifacts/skill-recovery-20260925/runtime"),
        )
        .unwrap();
        (root, runtime)
    } else {
        fixture()
    };
    let cancel = CommandCancellation::default();
    let prepared = prepare(&runtime, &json!({
        "zip_url":"https://api.github.com/repos/tt-a1i/archify/git/blobs/ede3ba354013e16b1c1e5aa2fac9c9f3186d76c1",
        "expected_sha256":"d2296515b0091fb8f00580ea9e0b665d91ca5839fde651abe3ecd57a3ca178ec"
    }), &cancel).unwrap();
    let existing = root
        .join(".agents/skills/archify")
        .exists()
        .then(|| skill_verification::bundle_digest(&root, "archify").unwrap());
    let installed = install(&runtime, &json!({"prepared_tool_call_id":"explicit-maintenance-probe","skill_root":"archify","path":".agents/skills/archify","expected_bundle_sha256":existing}), &prepared.receipt, &cancel).unwrap();
    let verified = skill_verification::execute(&root, &json!({"name":"archify"})).unwrap();
    assert_eq!(verified.receipt["success"], true);
    println!(
        "{}",
        json!({"project":root,"prepare":prepared.receipt,"install":installed.receipt,"verify":verified.receipt})
    );
}
#[test]
fn source_tree_must_be_complete_and_contains_only_bounded_regular_files() {
    let mut tree = json!({"truncated":false,"tree":[{"path":"skill/SKILL.md","type":"blob","mode":"100644","size":32,"sha":"0000000000000000000000000000000000000000"},{"path":"unrelated/movie.mp4","type":"blob","mode":"100644","size":999999999}]});
    assert_eq!(source_files(&tree, "skill").unwrap().len(), 1);
    tree["truncated"] = json!(true);
    assert!(source_files(&tree, "skill").is_err());
    tree["truncated"] = json!(false);
    for mode in ["120000", "160000"] {
        tree["tree"][0]["mode"] = json!(mode);
        assert!(source_files(&tree, "skill").is_err());
    }
    tree["tree"][0]["mode"] = json!("100644");
    tree["tree"][0]["size"] = json!(MAX_FILE + 1);
    assert!(source_files(&tree, "skill").is_err());
}

#[test]
fn partial_download_cache_is_source_bound_and_corruption_is_not_reused() {
    let (_, runtime) = fixture();
    let file = SourceFile {
        path: "a".into(),
        size: 3,
        git_blob: "a".repeat(40),
    };
    let key = source_cache_key("owner/repo", "commit-a", &file);
    cache_source(&runtime, &key, b"abc").unwrap();
    assert_eq!(cached_source(&runtime, &key, 3), Some(b"abc".to_vec()));
    assert_eq!(
        cached_source(
            &runtime,
            &source_cache_key("owner/repo", "commit-b", &file),
            3
        ),
        None
    );
    assert_eq!(cached_source(&runtime, &key, 4), None);
    fs::write(runtime.checkpoint_root.join(sha256(b"abc")), b"bad").unwrap();
    assert_eq!(cached_source(&runtime, &key, 3), None);
}

#[test]
fn network_and_publication_have_independent_existing_policy_decisions() {
    let specs = catalog();
    let policy = PolicyEngine;
    for spec in &specs {
        assert_eq!(
            policy.decide(AgentPermission::ReadOnly, spec, &json!({})),
            AgentPolicyDecision::Ask
        );
        assert_eq!(
            policy.decide(AgentPermission::FullControl, spec, &json!({})),
            AgentPolicyDecision::Allow
        );
        assert_eq!(
            policy.decide(AgentPermission::ReviewChanges, spec, &json!({})),
            if spec.effect == AgentToolEffect::Network {
                AgentPolicyDecision::Ask
            } else {
                AgentPolicyDecision::Allow
            }
        );
    }
}

fn args() -> Value {
    json!({"prepared_tool_call_id":"actual-durable-id","skill_root":"repo/sample","path":".agents/skills/sample","expected_bundle_sha256":null})
}

#[test]
fn cancelled_source_stays_cancelled_and_provenance_omits_temporary_signatures() {
    let (_, runtime) = fixture();
    let cancel = CommandCancellation::default();
    cancel.cancel();
    assert_eq!(
        prepare_repository(
            &runtime,
            "owner/repo",
            &"a".repeat(40),
            Some("skill"),
            &cancel
        )
        .unwrap_err(),
        AgentError::Cancelled
    );
    assert_eq!(
        provenance_url("https://public.example/archive.zip?sig=sentinel&jwt=sentinel#part"),
        "https://public.example/archive.zip"
    );
}

#[test]
fn failed_publication_restores_previous_bytes_and_retains_candidate() {
    let (root, _) = fixture();
    let target = root.join("current");
    let stage = root.join("new");
    let backup = root.join("previous");
    fs::create_dir(&target).unwrap();
    fs::create_dir(&stage).unwrap();
    fs::write(target.join("data"), b"original").unwrap();
    fs::write(stage.join("data"), b"candidate").unwrap();
    let mut calls = 0;
    assert!(
        publish(&stage, &target, &backup, true, |from, to| {
            calls += 1;
            if calls == 2 {
                Err(std::io::Error::other("injected publication failure"))
            } else {
                fs::rename(from, to)
            }
        })
        .is_err()
    );
    assert_eq!(fs::read(target.join("data")).unwrap(), b"original");
    assert_eq!(fs::read(stage.join("data")).unwrap(), b"candidate");
    assert!(!backup.exists());
}

#[test]
fn complete_bytes_guarded_replacement_and_backup() {
    let (root, runtime) = fixture();
    let cancel = CommandCancellation::default();
    let bytes = archive(&[
        ("repo/sample/SKILL.md", SKILL),
        ("repo/sample/assets/data.bin", &[0, 255, 128]),
        ("repo/sample/extra/unreferenced.txt", "完整资源".as_bytes()),
    ]);
    let prepared = stage(&runtime, &bytes, json!({"commit":"fixture"}), &cancel).unwrap();
    assert!(!root.join(".agents/skills").exists());
    let installed = install(&runtime, &args(), &prepared.receipt, &cancel).unwrap();
    assert_eq!(installed.receipt["file_count"], 3);
    assert_eq!(
        fs::read(root.join(".agents/skills/sample/assets/data.bin")).unwrap(),
        [0, 255, 128]
    );
    assert!(
        root.join(".agents/skills/sample/extra/unreferenced.txt")
            .exists()
    );
    assert_eq!(installed.receipt["scripts_executed"], false);
    assert_eq!(installed.receipt["verification_eligible"], false);
    assert!(
        !root
            .join(".agents/.skill-transactions/sample.lock")
            .exists()
    );
    assert!(install(&runtime, &args(), &prepared.receipt, &cancel).is_err());
    let mut replacement = args();
    replacement["expected_bundle_sha256"] = installed.receipt["bundle_sha256"].clone();
    let updated = install(&runtime, &replacement, &prepared.receipt, &cancel).unwrap();
    assert!(
        root.join(updated.receipt["backup_path"].as_str().unwrap())
            .join("SKILL.md")
            .exists()
    );
    assert!(
        runtime
            .fingerprint_paths(&[".agents/skills/sample".into()])
            .is_ok()
    );
}

#[test]
fn unsafe_archives_and_roots_never_publish() {
    let (root, runtime) = fixture();
    let cancel = CommandCancellation::default();
    for bad in [
        "../outside",
        "repo/../../outside",
        "/absolute",
        "C:/drive",
        "repo/x:stream",
        "repo/CON.txt",
        "repo/LPT1",
        "repo/trailing.",
        "repo/back\\slash",
    ] {
        let bytes = archive(&[("repo/sample/SKILL.md", SKILL), (bad, b"bad")]);
        assert!(
            stage(&runtime, &bytes, json!({}), &cancel).is_err(),
            "{bad}"
        );
    }
    for entries in [
        vec![("repo/a", &b"x"[..]), ("repo/A", &b"y"[..])],
        vec![("repo/a", &b"x"[..]), ("repo/a/child", &b"y"[..])],
    ] {
        assert!(stage(&runtime, &archive(&entries), json!({}), &cancel).is_err());
    }
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.add_symlink("repo/link", "../../outside", SimpleFileOptions::default())
        .unwrap();
    assert!(
        stage(
            &runtime,
            &zip.finish().unwrap().into_inner(),
            json!({}),
            &cancel
        )
        .is_err()
    );
    assert!(!root.join(".agents/skills").exists());
}

#[test]
fn incomplete_corrupt_oversized_and_cancelled_bundles_preserve_existing() {
    let (root, runtime) = fixture();
    let cancel = CommandCancellation::default();
    let good = stage(
        &runtime,
        &archive(&[
            ("repo/sample/SKILL.md", SKILL),
            ("repo/sample/assets/data.bin", b"original"),
        ]),
        json!({}),
        &cancel,
    )
    .unwrap();
    let installed = install(&runtime, &args(), &good.receipt, &cancel).unwrap();
    let mut replace = args();
    replace["expected_bundle_sha256"] = installed.receipt["bundle_sha256"].clone();
    for extra in [
        Vec::new(),
        vec![0u8; MAX_FILE + 1],
        b"version https://git-lfs.github.com/spec/v1\n".to_vec(),
    ] {
        let mut entries = vec![("repo/sample/SKILL.md", SKILL)];
        if !extra.is_empty() {
            entries.push(("repo/sample/assets/data.bin", &extra));
        }
        let prepared = stage(&runtime, &archive(&entries), json!({}), &cancel).unwrap();
        assert!(install(&runtime, &replace, &prepared.receipt, &cancel).is_err());
        assert_eq!(
            fs::read(root.join(".agents/skills/sample/assets/data.bin")).unwrap(),
            b"original"
        );
    }
    assert!(stage(&runtime, b"not zip", json!({}), &cancel).is_err());
    let stopped = CommandCancellation::default();
    stopped.cancel();
    assert!(install(&runtime, &replace, &good.receipt, &stopped).is_err());
    let mut spoof = good.receipt.clone();
    spoof["archive_sha256"] = json!("0".repeat(64));
    assert!(install(&runtime, &replace, &spoof, &cancel).is_err());
    assert_eq!(
        skill_verification::bundle_digest(&root, "sample").unwrap(),
        installed.receipt["bundle_sha256"]
    );
}

#[test]
fn locked_or_interrupted_installation_is_never_blindly_replayed() {
    let (root, runtime) = fixture();
    let cancel = CommandCancellation::default();
    let prepared = stage(
        &runtime,
        &archive(&[
            ("repo/sample/SKILL.md", SKILL),
            ("repo/sample/assets/data.bin", b"x"),
        ]),
        json!({}),
        &cancel,
    )
    .unwrap();
    fs::create_dir_all(root.join(".agents/.skill-transactions")).unwrap();
    fs::write(
        root.join(".agents/.skill-transactions/sample.lock"),
        b"interrupted",
    )
    .unwrap();
    assert!(install(&runtime, &args(), &prepared.receipt, &cancel).is_err());
    assert!(!root.join(".agents/skills/sample").exists());
    assert_eq!(
        runtime
            .reconcile_unknown("skills.install", AgentToolEffect::WorkspaceWrite, &args())
            .unwrap()
            .status,
        ToolReconciliationStatus::ManualReview
    );
}

/// Explicit network acceptance only; ordinary tests never contact a provider.
#[test]
#[ignore = "explicit public source acceptance; no third-party code execution"]
fn live_public_small_skill() {
    let (root, runtime) = fixture();
    let cancel = CommandCancellation::default();
    let prepared = prepare(
        &runtime,
        &json!({"repository":"openai/skills","skill_path":"skills/.curated/gh-fix-ci"}),
        &cancel,
    )
    .unwrap();
    let installed = install(&runtime,&json!({"prepared_tool_call_id":"isolated-test","skill_root":"skills/.curated/gh-fix-ci","path":".agents/skills/gh-fix-ci","expected_bundle_sha256":null}),&prepared.receipt,&cancel).unwrap();
    let checked = skill_verification::execute(&root, &json!({"name":"gh-fix-ci"})).unwrap();
    assert_eq!(checked.receipt["success"], true);
    println!(
        "{}",
        json!({"project":root,"prepare":prepared.receipt,"install":installed.receipt,"verify":checked.receipt})
    );
}

#[test]
#[ignore = "explicit official release archive acceptance; no external script execution"]
fn live_archify_release_zip() {
    let (root, runtime) = fixture();
    let cancel = CommandCancellation::default();
    let prepared=prepare(&runtime,&json!({"zip_url":"https://github.com/tt-a1i/archify/releases/download/v2.16.0/archify.zip","expected_sha256":"4c59fa6557a2385beaaef8c7219cc414573acc9f0c30a932d5053b0b20689a46"}),&cancel).unwrap();
    let roots = prepared.receipt["skill_roots"].as_array().unwrap();
    assert_eq!(roots.len(), 1);
    let installed=install(&runtime,&json!({"prepared_tool_call_id":"isolated-release","skill_root":roots[0],"path":".agents/skills/archify","expected_bundle_sha256":null}),&prepared.receipt,&cancel).unwrap();
    let verified = skill_verification::execute(&root, &json!({"name":"archify"})).unwrap();
    assert_eq!(verified.receipt["success"], true);
    println!(
        "{}",
        json!({"project":root,"prepare":prepared.receipt,"install":installed.receipt,"verify":verified.receipt})
    );
}

#[test]
#[ignore = "real public GitHub download; run explicitly with --ignored --nocapture"]
fn live_public_archify_acquisition() {
    let (root, runtime) = if let Some(path) = std::env::var_os("FIELORA_LIVE_SKILL_PROJECT") {
        let root = PathBuf::from(path);
        fs::create_dir_all(&root).unwrap();
        let runtime = ToolRuntime::new(&root, &root.join("artifacts")).unwrap();
        (root, runtime)
    } else {
        fixture()
    };
    let cancel = CommandCancellation::default();
    let found = search(&json!({"query":"archify in:name user:tt-a1i"}), &cancel).unwrap();
    assert!(
        found.receipt["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["repository"] == "tt-a1i/archify")
    );
    let prepared = prepare(
        &runtime,
        &json!({"repository":"tt-a1i/archify","skill_path":"archify"}),
        &cancel,
    )
    .unwrap();
    let roots = prepared.receipt["skill_roots"].as_array().unwrap();
    let skill_root = roots
        .iter()
        .filter_map(Value::as_str)
        .find(|v| *v == "archify" || v.ends_with("/archify"))
        .unwrap();
    let installed = install(&runtime, &json!({"prepared_tool_call_id":"isolated-test","skill_root":skill_root,"path":".agents/skills/archify","expected_bundle_sha256":null}), &prepared.receipt, &cancel).unwrap();
    let checked = skill_verification::execute(&root, &json!({"name":"archify"})).unwrap();
    assert_eq!(checked.receipt["success"], true);
    println!(
        "{}",
        json!({"project":root,"search":found.receipt,"prepare":prepared.receipt,"install":installed.receipt,"verify":checked.receipt})
    );
}
