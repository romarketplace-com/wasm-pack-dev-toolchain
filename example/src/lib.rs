use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn greet(name: &str) -> JsValue {
    JsValue::from(format!("Hello, {}!", name))
}

#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> JsValue {
    JsValue::from(a + b)
}

// These functions are just examples to demonstrate the functionality of the wasm-pack-dev-toolchain.