//! Run with: cargo run --manifest-path src-tauri/Cargo.toml --release --example scan_benchmark
//! Fixtures live in temporary directories and are removed when the process exits.
use notes_lib::service::Service;
use std::{fs, hint::black_box, time::Instant};

fn main() {
    println!("notes,body_bytes,iterations,median_ms,p95_ms");
    for count in [500, 5000] {
        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let body = "Some mixed English עברית text with #topic and [[another-note]].\n".repeat(32);
        for index in 0..count {
            fs::write(
                root.path().join(format!("note-{index:05}.md")),
                format!("# Note {index}\n{body}"),
            )
            .unwrap();
        }
        let service = Service::new(config.path().to_path_buf()).unwrap();
        let snapshot = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap();
        for _ in 0..3 {
            black_box(service.scan_workspace(&snapshot.workspace.id).unwrap());
        }
        let mut times = Vec::new();
        for _ in 0..30 {
            let start = Instant::now();
            let result = service.scan_workspace(&snapshot.workspace.id).unwrap();
            assert_eq!(result.entries.len(), count);
            black_box(result);
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        println!(
            "{count},{},30,{:.3},{:.3}",
            body.len(),
            times[15],
            times[28]
        );
    }
}
