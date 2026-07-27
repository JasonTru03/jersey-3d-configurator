use crate::contract::{parse_store_config, verify_contract, Component, Role};
use crate::schema;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::BTreeMap;

const MAX_CART_LINES: usize = 200;
const MAX_BUNDLE_GROUPS: usize = 32;
const MAX_COMPONENTS_PER_GROUP: usize = 16;
const MAX_OPERATIONS: usize = 32;
const MAX_SUMMARY_VALUE_CODEPOINTS: usize = 255;
const MAX_SUMMARY_VALUE_BYTES: usize = 1024;

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
    total_minor: i64,
    currency: String,
    summary: Vec<(&'static str, Option<String>)>,
}

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::CartTransformRunResult> {
    let Some(config_metafield) = input.cart_transform().config() else {
        return Ok(empty_result());
    };
    let Some(config) = parse_store_config(config_metafield.json_value()) else {
        return Ok(empty_result());
    };
    let cart_lines = input.cart().lines();
    if cart_lines.len() > MAX_CART_LINES {
        return Ok(empty_result());
    }
    let mut groups: BTreeMap<String, Vec<CandidateLine>> = BTreeMap::new();

    for line in cart_lines {
        let Some(bundle_id) = line.bundle_id().and_then(|item| item.value()).cloned() else {
            continue;
        };
        if !groups.contains_key(&bundle_id) && groups.len() >= MAX_BUNDLE_GROUPS {
            return Ok(empty_result());
        }
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
                total_minor: match decimal_to_minor(line.cost().total_amount().amount().0) {
                    Some(value) => value,
                    None => return Ok(empty_result()),
                },
                currency: line.cost().total_amount().currency_code().to_string(),
                summary: vec![
                    (
                        "Size",
                        line.size_summary().and_then(|item| item.value()).cloned(),
                    ),
                    (
                        "Template",
                        line.template_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                    (
                        "Colors",
                        line.colors_summary().and_then(|item| item.value()).cloned(),
                    ),
                    (
                        "Print",
                        line.print_summary().and_then(|item| item.value()).cloned(),
                    ),
                    (
                        "Custom Text",
                        line.custom_text_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                    (
                        "Extras",
                        line.extras_summary().and_then(|item| item.value()).cloned(),
                    ),
                    (
                        "Artwork",
                        line.artwork_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                    (
                        "Production Files",
                        line.production_files_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                    (
                        "Bundle File",
                        line.bundle_file_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                    (
                        "Design File",
                        line.design_file_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                    (
                        "Atlas File",
                        line.atlas_file_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                    (
                        "UV Atlas SHA-256",
                        line.atlas_sha_256_summary()
                            .and_then(|item| item.value())
                            .cloned(),
                    ),
                ],
            });
    }

    let mut operations = Vec::new();
    for lines in groups.values() {
        if let Some(operation) = verified_merge(lines, &config) {
            if operations.len() >= MAX_OPERATIONS {
                return Ok(empty_result());
            }
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
    if lines.is_empty() || lines.len() > MAX_COMPONENTS_PER_GROUP {
        return None;
    }
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
    let total_minor = lines
        .iter()
        .try_fold(0_i64, |total, line| total.checked_add(line.total_minor))?;
    let currency = lines.first()?.currency.as_str();
    if lines.iter().any(|line| line.currency != currency) {
        return None;
    }
    let verified = verify_contract(
        &first.quote,
        &components,
        &first.bundle_id,
        &first.design_id,
        &first.schema_version,
        config,
        total_minor,
        currency,
    )?;
    let base = lines.iter().find(|line| line.component == "base")?;
    let summary = parent_summary(base)?;

    let mut attributes = vec![
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
        schema::AttributeOutput {
            key: "_jersey_components".into(),
            value: verified.components_json,
        },
    ];
    attributes.extend(summary);

    Some(schema::LinesMergeOperation {
        attributes: Some(attributes),
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

fn parent_summary(base: &CandidateLine) -> Option<Vec<schema::AttributeOutput>> {
    if base.summary.len() != 12 {
        return None;
    }
    if base.summary[..7].iter().any(|(_, value)| value.is_none()) {
        return None;
    }
    let production_count = base.summary[7..]
        .iter()
        .filter(|(_, value)| value.is_some())
        .count();
    if production_count != 0 && production_count != 5 {
        return None;
    }
    base.summary
        .iter()
        .filter_map(|(key, value)| value.as_ref().map(|value| (*key, value)))
        .map(|(key, value)| {
            if value.chars().count() > MAX_SUMMARY_VALUE_CODEPOINTS
                || value.as_bytes().len() > MAX_SUMMARY_VALUE_BYTES
            {
                return None;
            }
            Some(schema::AttributeOutput {
                key: key.into(),
                value: value.clone(),
            })
        })
        .collect()
}

fn decimal_to_minor(value: f64) -> Option<i64> {
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    let normalized = format!("{value:.2}");
    if normalized.parse::<f64>().ok()? != value {
        return None;
    }
    let (whole, fraction) = normalized.split_once('.')?;
    let whole = whole.parse::<i64>().ok()?;
    let fraction = fraction.parse::<i64>().ok()?;
    whole.checked_mul(100)?.checked_add(fraction)
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
        assert_eq!(merge.attributes.as_ref().map(Vec::len), Some(12));
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
    fn shared_full_store_config_is_accepted() -> Result<()> {
        assert_eq!(run_fixture("shared-store-config.json")?.operations.len(), 1);
        Ok(())
    }

    #[test]
    fn malformed_or_extended_store_config_fails_closed() -> Result<()> {
        for fixture in [
            "invalid-config-extra-field.json",
            "invalid-config-variant-map.json",
        ] {
            assert!(run_fixture(fixture)?.operations.is_empty());
        }
        Ok(())
    }

    #[test]
    fn parent_contains_signed_components_and_only_base_summary() -> Result<()> {
        let output = run_fixture("summary-copy.json")?;
        let schema::Operation::LinesMerge(merge) = &output.operations[0] else {
            panic!("expected linesMerge");
        };
        let attributes = merge.attributes.as_ref().expect("parent attributes");
        let value = |key: &str| {
            attributes
                .iter()
                .find(|attribute| attribute.key == key)
                .map(|attribute| attribute.value.as_str())
        };
        assert_eq!(
            value("_jersey_components"),
            Some(r#"[["b","111",1],["s","222",1]]"#)
        );
        assert_eq!(value("Size"), Some("s"));
        assert_eq!(value("Template"), Some("blank"));
        assert_eq!(value("Colors"), Some("{}"));
        assert_eq!(value("Print"), Some(""));
        assert_eq!(value("Custom Text"), Some(""));
        assert_eq!(value("Extras"), Some(""));
        assert_eq!(value("Artwork"), Some(""));
        assert_eq!(value("Production Files"), Some("Local ZIP download"));
        assert_eq!(value("Bundle File"), Some("fn8788-jersey-production.zip"));
        assert_eq!(value("Design File"), Some("fn8788-jersey-design.json"));
        assert_eq!(value("Atlas File"), Some("fn8788-jersey-uv-atlas.png"));
        assert_eq!(
            value("UV Atlas SHA-256"),
            Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
        Ok(())
    }

    #[test]
    fn mismatched_shopify_total_or_currency_emits_no_merge() -> Result<()> {
        for fixture in ["wrong-total.json", "wrong-currency.json"] {
            assert!(run_fixture(fixture)?.operations.is_empty());
        }
        Ok(())
    }

    #[test]
    fn resource_limits_fail_closed() -> Result<()> {
        for fixture in [
            "too-many-cart-lines.json",
            "too-many-components.json",
            "too-many-groups.json",
            "components-property-too-long.json",
        ] {
            assert!(
                run_fixture(fixture)?.operations.is_empty(),
                "fixture {fixture} exceeded a limit but merged"
            );
        }
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

    #[test]
    fn decimal_amounts_convert_to_checked_minor_units() {
        assert_eq!(decimal_to_minor(99.0), Some(9900));
        assert_eq!(decimal_to_minor(0.8), Some(80));
        assert_eq!(decimal_to_minor(10.123), None);
        assert_eq!(decimal_to_minor(-1.0), None);
        assert_eq!(decimal_to_minor(f64::INFINITY), None);
    }
}
