//! Runs against a real SFTP server only when KESTREL_SFTP_TEST is set, as `host:port:user:password[:root]`.
//! CI does not set it; run it by hand against a throwaway account.

use kestrel_sftp::{get, list, put, remove, test, Auth, SftpError, Target};

fn target() -> Option<Target> {
    let spec = std::env::var("KESTREL_SFTP_TEST").ok()?;
    let parts: Vec<&str> = spec.splitn(5, ':').collect();
    Some(Target {
        host: parts[0].into(), port: parts[1].parse().unwrap(), user: parts[2].into(),
        auth: Auth::Password(parts[3].into()), root: parts.get(4).unwrap_or(&"").to_string(), pinned: None,
    })
}

#[tokio::test]
async fn round_trip_against_a_real_server() {
    let Some(mut target) = target() else { eprintln!("KESTREL_SFTP_TEST not set; skipped"); return };
    let fingerprint = test(&target).await.expect("test");
    assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");
    target.pinned = Some(fingerprint.clone());
    assert_eq!(test(&target).await.unwrap(), fingerprint);

    let path = "kestrel/v1/project-backups/abc/one.kestrel.json";
    put(&target, path, b"{\"hello\":1}").await.expect("put");
    put(&target, path, b"{\"hello\":2}").await.expect("overwrite");
    assert_eq!(get(&target, path).await.unwrap().unwrap(), b"{\"hello\":2}");
    assert_eq!(list(&target, "kestrel/v1/project-backups/abc").await.unwrap(), vec![path.to_string()]);
    assert_eq!(list(&target, "kestrel/v1").await.unwrap(), vec![path.to_string()]);
    put(&target, "export/shoot/a.jpg", b"jpeg").await.expect("export");
    assert!(put(&target, "export/shoot/a.jpg", b"other").await.is_err(), "an export is never replaced");
    assert!(get(&target, "export/shoot/a.jpg").await.is_err(), "exports are never read back");
    assert_eq!(list(&target, "kestrel/v1/nothing-here").await.unwrap(), Vec::<String>::new());
    remove(&target, path).await.unwrap();
    assert_eq!(get(&target, path).await.unwrap(), None);

    let mut wrong = target.clone();
    wrong.pinned = Some("SHA256:not-this-server".into());
    match list(&wrong, "kestrel/v1").await {
        Err(SftpError::HostKeyChanged(seen)) => assert_eq!(seen, fingerprint),
        other => panic!("expected a changed key, got {other:?}"),
    }
    let mut bad = target.clone();
    bad.auth = Auth::Password("wrong".into());
    assert!(matches!(list(&bad, "kestrel/v1").await, Err(SftpError::Plain(_))));
}

/// With KESTREL_SFTP_KEY_TEST as `host:port:user:keyfile:passphrase`, signs in with an OpenSSH key instead.
#[tokio::test]
async fn key_sign_in_against_a_real_server() {
    let Ok(spec) = std::env::var("KESTREL_SFTP_KEY_TEST") else { eprintln!("KESTREL_SFTP_KEY_TEST not set; skipped"); return };
    let parts: Vec<&str> = spec.splitn(5, ':').collect();
    let pem = std::fs::read_to_string(parts[3]).unwrap();
    let target = Target {
        host: parts[0].into(), port: parts[1].parse().unwrap(), user: parts[2].into(),
        auth: Auth::Key { pem: pem.clone(), passphrase: Some(parts[4].into()) }, root: "InFlight".into(), pinned: None,
    };
    assert!(test(&target).await.expect("key sign-in").starts_with("SHA256:"));
    let wrong = Target { auth: Auth::Key { pem, passphrase: Some("nope".into()) }, ..target };
    assert!(matches!(test(&wrong).await, Err(SftpError::Plain(_))));
}
