use shopify_function::prelude::*;
use std::process;

pub mod run;

#[typegen("schema.graphql")]
pub mod schema {
    #[query("src/run.graphql")]
    pub mod run {}
}

fn main() {
    process::abort();
}
