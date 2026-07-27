use crate::contract::{parse_store_config, verify_contract, Component, Role};
use crate::schema;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::BTreeMap;

struct CandidateLine {
    id: String,
    quantity: i64,
    bundle_id: String,
    quote: String,
    component: String,
    design_id: String,
    schema_version: String,
    variant_gid: String,
    variant_id: String,
}

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::CartTransformRunResult> {
    let Some(config_metafield) = input.cart_transform().config() else {
        return Ok(empty_result());
    };
    let Some(config) = parse_store_config(config_metafield.json_value()) else {
        return Ok(empty_result());
    };
    let mut groups: BTreeMap<String, Vec<CandidateLine>> = BTreeMap::new();

    for line in input.cart().lines() {
        let Some(bundle_id) = line.bundle_id().and_then(|item| item.value()).cloned() else {
            continue;
        };
        let (variant_gid, variant_id) = match line.merchandise() {
            schema::run::input::cart::lines::Merchandise::ProductVariant(variant) => {
                let variant_id = variant
                    .id()
                    .strip_prefix("gid://shopify/ProductVariant/")
                    .unwrap_or_default()
                    .to_owned();
                (variant.id().to_owned(), variant_id)
            }
            _ => (String::new(), String::new()),
        };
        groups
            .entry(bundle_id.clone())
            .or_default()
            .push(CandidateLine {
                id: line.id().to_owned(),
                quantity: i64::from(*line.quantity()),
                bundle_id,
                quote: line
                    .quote()
                    .and_then(|item| item.value())
                    .cloned()
                    .unwrap_or_default(),
                component: line
                    .component()
                    .and_then(|item| item.value())
                    .cloned()
                    .unwrap_or_default(),
                design_id: line
                    .design_id()
                    .and_then(|item| item.value())
                    .cloned()
                    .unwrap_or_default(),
                schema_version: line
                    .schema_version()
                    .and_then(|item| item.value())
                    .cloned()
                    .unwrap_or_default(),
                variant_gid,
                variant_id,
            });
    }

    let mut operations = Vec::new();
    for lines in groups.values() {
        if let Some(operation) = verified_merge(lines, &config) {
            operations.push(schema::Operation::LinesMerge(operation));
        }
    }
    Ok(schema::CartTransformRunResult { operations })
}

fn empty_result() -> schema::CartTransformRunResult {
    schema::CartTransformRunResult { operations: vec![] }
}

fn verified_merge(
    lines: &[CandidateLine],
    config: &crate::contract::StoreConfig,
) -> Option<schema::LinesMergeOperation> {
    let first = lines.first()?;
    if first.quote.is_empty()
        || first.design_id.is_empty()
        || first.schema_version.is_empty()
        || lines.iter().any(|line| {
            line.bundle_id != first.bundle_id
                || line.quote != first.quote
                || line.design_id != first.design_id
                || line.schema_version != first.schema_version
        })
    {
        return None;
    }

    let components: Vec<Component> = lines
        .iter()
        .map(|line| {
            let role = match line.component.as_str() {
                "base" => Some(Role::Base),
                "surcharge" => Some(Role::Surcharge),
                _ => None,
            }?;
            Some(Component {
                role,
                variant_id: line.variant_id.clone(),
                quantity: line.quantity,
            })
        })
        .collect::<Option<_>>()?;
    let verified = verify_contract(
        &first.quote,
        &components,
        &first.bundle_id,
        &first.design_id,
        &first.schema_version,
        config,
    )?;
    let base = lines.iter().find(|line| line.component == "base")?;

    Some(schema::LinesMergeOperation {
        attributes: Some(vec![
            schema::AttributeOutput {
                key: "_jersey_bundle_id".into(),
                value: verified.bundle_id,
            },
            schema::AttributeOutput {
                key: "_jersey_quote".into(),
                value: first.quote.clone(),
            },
            schema::AttributeOutput {
                key: "_jersey_design_id".into(),
                value: verified.design_id,
            },
            schema::AttributeOutput {
                key: "_jersey_schema".into(),
                value: first.schema_version.clone(),
            },
        ]),
        cart_lines: lines
            .iter()
            .map(|line| schema::CartLineInput {
                cart_line_id: line.id.clone(),
                quantity: line.quantity as i32,
            })
            .collect(),
        image: None,
        parent_variant_id: base.variant_gid.clone(),
        price: None,
        title: Some("Custom 3D Football Jersey".into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::run_function_with_input;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static FUNCTION_RUNTIME: Mutex<()> = Mutex::new(());

    fn run_fixture(name: &str) -> Result<schema::CartTransformRunResult> {
        let _runtime = FUNCTION_RUNTIME.lock().expect("function test runtime lock");
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name);
        let input = fs::read_to_string(path)?;
        run_function_with_input(run, &input)
    }

    #[test]
    fn complete_signed_group_emits_one_merge() -> Result<()> {
        let output = run_fixture("valid-two-component.json")?;
        assert_eq!(output.operations.len(), 1);
        let schema::Operation::LinesMerge(merge) = &output.operations[0] else {
            panic!("expected linesMerge");
        };
        assert_eq!(merge.parent_variant_id, "gid://shopify/ProductVariant/111");
        assert_eq!(merge.cart_lines.len(), 2);
        assert_eq!(merge.attributes.as_ref().map(Vec::len), Some(4));
        Ok(())
    }

    #[test]
    fn same_day_short_lived_quote_still_merges_after_proxy_admission() -> Result<()> {
        assert_eq!(
            run_fixture("same-day-short-lived.json")?.operations.len(),
            1
        );
        Ok(())
    }

    #[test]
    fn removed_surcharge_emits_no_merge() -> Result<()> {
        assert!(run_fixture("missing-surcharge.json")?.operations.is_empty());
        Ok(())
    }

    #[test]
    fn cheaper_variant_substitution_emits_no_merge() -> Result<()> {
        assert!(run_fixture("cheaper-substitution.json")?
            .operations
            .is_empty());
        Ok(())
    }

    #[test]
    fn duplicate_component_emits_no_merge() -> Result<()> {
        assert!(run_fixture("duplicate-component.json")?
            .operations
            .is_empty());
        Ok(())
    }

    #[test]
    fn altered_quantity_emits_no_merge() -> Result<()> {
        assert!(run_fixture("wrong-quantity.json")?.operations.is_empty());
        Ok(())
    }

    #[test]
    fn bad_signature_emits_no_merge() -> Result<()> {
        assert!(run_fixture("bad-signature.json")?.operations.is_empty());
        Ok(())
    }

    #[test]
    fn header_identity_mismatches_emit_no_merge() -> Result<()> {
        for fixture in [
            "wrong-design.json",
            "wrong-bundle.json",
            "wrong-schema.json",
            "wrong-shop.json",
        ] {
            assert!(
                run_fixture(fixture)?.operations.is_empty(),
                "fixture {fixture} merged"
            );
        }
        Ok(())
    }

    #[test]
    fn ordinary_lines_are_ignored() -> Result<()> {
        assert!(run_fixture("ordinary-line.json")?.operations.is_empty());
        Ok(())
    }

    #[test]
    fn multiple_designs_are_isolated_into_separate_merges() -> Result<()> {
        assert_eq!(run_fixture("multiple-designs.json")?.operations.len(), 2);
        Ok(())
    }
}
