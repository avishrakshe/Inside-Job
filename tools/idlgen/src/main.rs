fn main() {
    let program = std::env::args().nth(1).expect("usage: idlgen <program-dir> [out.json]");
    let out = std::env::args().nth(2);
    let idl = anchor_lang_idl::build::build_idl(&program, true, false, false).expect("idl build failed");
    let json = serde_json::to_string_pretty(&idl).unwrap();
    match out {
        Some(p) => std::fs::write(p, json).unwrap(),
        None => println!("{json}"),
    }
}
