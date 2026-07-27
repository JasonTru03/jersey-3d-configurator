use crate::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[shopify_function]
fn run(_input: schema::run::Input) -> Result<schema::CartTransformRunResult> {
    Ok(schema::CartTransformRunResult { operations: vec![] })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::run_function_with_input;

    #[test]
    fn returns_no_operations() -> Result<()> {
        let result = run_function_with_input(run, r#"{"cart":{"lines":[]}}"#)?;
        assert_eq!(result, schema::CartTransformRunResult { operations: vec![] });
        Ok(())
    }
}
