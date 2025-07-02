//! Test suite for the Web and headless browsers.

#![cfg(target_arch = "wasm32")]

extern crate wasm_bindgen_test;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
async fn test_greet() {
    let result = wasm_example::greet("World");
    assert_eq!(result.as_string().unwrap(), "Hello, World!");
}

#[wasm_bindgen_test]
async fn test_add() {
    let result = wasm_example::add(2, 3);
    assert_eq!(result.as_f64().unwrap(), 5.0);
}
