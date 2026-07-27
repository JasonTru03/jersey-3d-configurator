use crate::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::CartValidationsGenerateRunResult> {
    let errors = input
        .cart()
        .lines()
        .iter()
        .filter(|line| *line.quantity() > 1)
        .map(|_| schema::ValidationError {
            message: "Not possible to order more than one of each".to_string(),
            target: "$.cart".to_string(),
        })
        .collect();

    Ok(schema::CartValidationsGenerateRunResult {
        operations: vec![schema::Operation::ValidationAdd(
            schema::ValidationAddOperation { errors },
        )],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::run_function_with_input;

    #[test]
    fn adds_validation_when_quantity_exceeds_one() -> Result<()> {
        let result = run_function_with_input(
            run,
            r#"{"cart":{"lines":[{"quantity":3}]}}"#,
        )?;
        assert_eq!(
            result,
            schema::CartValidationsGenerateRunResult {
                operations: vec![schema::Operation::ValidationAdd(
                    schema::ValidationAddOperation {
                        errors: vec![schema::ValidationError {
                            message: "Not possible to order more than one of each".to_string(),
                            target: "$.cart".to_string(),
                        }],
                    },
                )],
            },
        );
        Ok(())
    }

    #[test]
    fn adds_empty_validation_when_quantities_are_valid() -> Result<()> {
        let result = run_function_with_input(
            run,
            r#"{"cart":{"lines":[{"quantity":1}]}}"#,
        )?;
        assert_eq!(
            result,
            schema::CartValidationsGenerateRunResult {
                operations: vec![schema::Operation::ValidationAdd(
                    schema::ValidationAddOperation { errors: vec![] },
                )],
            },
        );
        Ok(())
    }
}
