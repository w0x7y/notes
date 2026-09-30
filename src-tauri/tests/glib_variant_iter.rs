//! Run with --release: RUSTSEC-2024-0429 can disappear in unoptimized builds.
use glib::prelude::*;

#[test]
fn variant_string_iterator_reads_all_advisory_affected_methods() {
    let values = ["first", "", "שלום", "last"];
    let variant = values.to_variant();
    assert_eq!(
        variant.array_iter_str().unwrap().collect::<Vec<_>>(),
        values
    );
    assert_eq!(variant.array_iter_str().unwrap().next(), Some("first"));
    assert_eq!(variant.array_iter_str().unwrap().next_back(), Some("last"));
    assert_eq!(variant.array_iter_str().unwrap().nth(2), Some("שלום"));
    assert_eq!(variant.array_iter_str().unwrap().nth_back(2), Some(""));
    assert_eq!(variant.array_iter_str().unwrap().last(), Some("last"));

    let mut mixed = variant.array_iter_str().unwrap();
    assert_eq!(mixed.next(), Some("first"));
    assert_eq!(mixed.next_back(), Some("last"));
    assert_eq!(mixed.next(), Some(""));
    assert_eq!(mixed.next_back(), Some("שלום"));
    assert_eq!(mixed.next(), None);
    assert_eq!(mixed.next_back(), None);

    let empty = Vec::<String>::new().to_variant();
    assert_eq!(empty.array_iter_str().unwrap().next(), None);
    assert_eq!(empty.array_iter_str().unwrap().next_back(), None);
    assert_eq!(empty.array_iter_str().unwrap().last(), None);
}
