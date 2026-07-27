use crate::contract::{parse_store_config, verify_contract, Component, Role, StoreConfig};
use crate::schema;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::{BTreeMap, BTreeSet};

const MAX_CART_LINES: usize = 200;
const MAX_BUNDLE_GROUPS: usize = 32;
const MAX_COMPONENTS_PER_GROUP: usize = 16;
const MAX_COMPONENTS_JSON_BYTES: usize = 255;
const ERROR_MESSAGE: &str = "Your customized jersey could not be verified. Remove it and add it again from the 3D configurator.";

#[derive(Clone)]
struct SecureLine {
    quantity: i64,
    bundle_id: Option<String>,
    quote: Option<String>,
    component: Option<String>,
    design_id: Option<String>,
    schema_version: Option<String>,
    components_json: Option<String>,
    variant_id: String,
    total_minor: Option<i64>,
    currency: String,
}

impl SecureLine {
    fn has_marker(&self) -> bool {
        self.bundle_id.is_some()
            || self.quote.is_some()
            || self.component.is_some()
            || self.design_id.is_some()
            || self.schema_version.is_some()
            || self.components_json.is_some()
    }
}

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::CartValidationsGenerateRunResult> {
    let lines: Vec<SecureLine> = input.cart().lines().iter().map(snapshot_line).collect();
    let config = input
        .validation()
        .config()
        .and_then(|metafield| parse_store_config(metafield.json_value()));

    if lines.len() > MAX_CART_LINES {
        let has_secure_line = lines.iter().any(|line| {
            line.has_marker()
                || config
                    .as_ref()
                    .is_some_and(|store| store.surcharge_variant_ids.contains(&line.variant_id))
        });
        return Ok(if has_secure_line {
            blocked_result()
        } else {
            allowed_result()
        });
    }

    let Some(config) = config else {
        return Ok(if lines.iter().any(SecureLine::has_marker) {
            blocked_result()
        } else {
            allowed_result()
        });
    };

    if validate_lines(&lines, &config).is_none() {
        return Ok(blocked_result());
    }
    Ok(allowed_result())
}

fn validate_lines(lines: &[SecureLine], config: &StoreConfig) -> Option<()> {
    let mut raw_groups: BTreeMap<String, Vec<&SecureLine>> = BTreeMap::new();
    let mut merged_bundles = BTreeSet::new();

    for line in lines {
        if line.components_json.is_some() {
            let bundle_id = line.bundle_id.as_deref()?;
            if raw_groups.contains_key(bundle_id) || !merged_bundles.insert(bundle_id.to_owned()) {
                return None;
            }
            validate_merged_parent(line, config)?;
        } else if line.has_marker() {
            let bundle_id = line.bundle_id.as_ref()?;
            if merged_bundles.contains(bundle_id) {
                return None;
            }
            if !raw_groups.contains_key(bundle_id) && raw_groups.len() >= MAX_BUNDLE_GROUPS {
                return None;
            }
            let group = raw_groups.entry(bundle_id.clone()).or_default();
            if group.len() >= MAX_COMPONENTS_PER_GROUP {
                return None;
            }
            group.push(line);
        } else if config.surcharge_variant_ids.contains(&line.variant_id) {
            return None;
        }
    }

    if raw_groups.len().checked_add(merged_bundles.len())? > MAX_BUNDLE_GROUPS {
        return None;
    }
    for group in raw_groups.values() {
        validate_raw_group(group, config)?;
    }
    Some(())
}

fn validate_merged_parent(line: &SecureLine, config: &StoreConfig) -> Option<()> {
    if line.quantity != 1 || line.component.is_some() {
        return None;
    }
    let bundle_id = line.bundle_id.as_deref()?;
    let quote = line.quote.as_deref()?;
    let design_id = line.design_id.as_deref()?;
    let schema_version = line.schema_version.as_deref()?;
    let components_json = line.components_json.as_deref()?;
    if components_json.as_bytes().len() > MAX_COMPONENTS_JSON_BYTES {
        return None;
    }
    let components = parse_compact_components(components_json)?;
    let base = components
        .iter()
        .find(|component| component.role == Role::Base)?;
    if line.variant_id != base.variant_id {
        return None;
    }
    let verified = verify_contract(
        quote,
        &components,
        bundle_id,
        design_id,
        schema_version,
        config,
        line.total_minor?,
        &line.currency,
    )?;
    if verified.components_json != components_json {
        return None;
    }
    Some(())
}

fn validate_raw_group(lines: &[&SecureLine], config: &StoreConfig) -> Option<()> {
    if lines.is_empty() || lines.len() > MAX_COMPONENTS_PER_GROUP {
        return None;
    }
    let first = lines.first()?;
    if first.components_json.is_some()
        || first.quote.is_none()
        || first.design_id.is_none()
        || first.schema_version.is_none()
        || lines.iter().any(|line| {
            line.bundle_id != first.bundle_id
                || line.quote != first.quote
                || line.design_id != first.design_id
                || line.schema_version != first.schema_version
                || line.components_json.is_some()
        })
    {
        return None;
    }

    let components: Vec<Component> = lines
        .iter()
        .map(|line| {
            let role = match line.component.as_deref() {
                Some("base") => Role::Base,
                Some("surcharge") => Role::Surcharge,
                _ => return None,
            };
            Some(Component {
                role,
                variant_id: line.variant_id.clone(),
                quantity: line.quantity,
            })
        })
        .collect::<Option<_>>()?;
    let total_minor = lines
        .iter()
        .try_fold(0_i64, |total, line| total.checked_add(line.total_minor?))?;
    let currency = first.currency.as_str();
    if lines.iter().any(|line| line.currency != currency) {
        return None;
    }
    verify_contract(
        first.quote.as_deref()?,
        &components,
        first.bundle_id.as_deref()?,
        first.design_id.as_deref()?,
        first.schema_version.as_deref()?,
        config,
        total_minor,
        currency,
    )?;
    Some(())
}

fn parse_compact_components(value: &str) -> Option<Vec<Component>> {
    let compact: Vec<(String, String, i64)> = serde_json::from_str(value).ok()?;
    compact
        .into_iter()
        .map(|(role, variant_id, quantity)| {
            Some(Component {
                role: match role.as_str() {
                    "b" => Role::Base,
                    "s" => Role::Surcharge,
                    _ => return None,
                },
                variant_id,
                quantity,
            })
        })
        .collect()
}

fn snapshot_line(line: &schema::run::input::cart::Lines) -> SecureLine {
    let variant_id = match line.merchandise() {
        schema::run::input::cart::lines::Merchandise::ProductVariant(variant) => variant
            .id()
            .strip_prefix("gid://shopify/ProductVariant/")
            .unwrap_or_default()
            .to_owned(),
        _ => String::new(),
    };
    SecureLine {
        quantity: i64::from(*line.quantity()),
        bundle_id: line.bundle_id().and_then(|item| item.value()).cloned(),
        quote: line.quote().and_then(|item| item.value()).cloned(),
        component: line.component().and_then(|item| item.value()).cloned(),
        design_id: line.design_id().and_then(|item| item.value()).cloned(),
        schema_version: line.schema_version().and_then(|item| item.value()).cloned(),
        components_json: line.components().and_then(|item| item.value()).cloned(),
        variant_id,
        total_minor: decimal_to_minor(line.cost().total_amount().amount().0),
        currency: line.cost().total_amount().currency_code().to_string(),
    }
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
    whole
        .parse::<i64>()
        .ok()?
        .checked_mul(100)?
        .checked_add(fraction.parse::<i64>().ok()?)
}

fn allowed_result() -> schema::CartValidationsGenerateRunResult {
    schema::CartValidationsGenerateRunResult { operations: vec![] }
}

fn blocked_result() -> schema::CartValidationsGenerateRunResult {
    schema::CartValidationsGenerateRunResult {
        operations: vec![schema::Operation::ValidationAdd(
            schema::ValidationAddOperation {
                errors: vec![schema::ValidationError {
                    message: ERROR_MESSAGE.to_owned(),
                    target: "$.cart".to_owned(),
                }],
            },
        )],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::run_function_with_input;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static FUNCTION_RUNTIME: Mutex<()> = Mutex::new(());

    fn run_fixture(name: &str) -> Result<schema::CartValidationsGenerateRunResult> {
        let _runtime = FUNCTION_RUNTIME.lock().expect("function test runtime lock");
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name);
        run_function_with_input(run, &fs::read_to_string(path)?)
    }

    fn error_count(output: &schema::CartValidationsGenerateRunResult) -> usize {
        output
            .operations
            .iter()
            .map(|operation| match operation {
                schema::Operation::ValidationAdd(add) => add.errors.len(),
            })
            .sum()
    }

    fn assert_allowed(name: &str) -> Result<()> {
        assert_eq!(
            error_count(&run_fixture(name)?),
            0,
            "fixture {name} blocked"
        );
        Ok(())
    }

    fn assert_blocked(name: &str) -> Result<()> {
        let output = run_fixture(name)?;
        assert!(error_count(&output) > 0, "fixture {name} was allowed");
        for operation in output.operations {
            let schema::Operation::ValidationAdd(add) = operation;
            for error in add.errors {
                assert_eq!(error.target, "$.cart");
                assert!(error.message.contains("customized jersey"));
            }
        }
        Ok(())
    }

    #[test]
    fn valid_merged_parent_is_allowed() -> Result<()> {
        assert_allowed("valid-merged.json")?;
        assert_allowed("expired-but-admitted.json")?;
        assert_allowed("two-merged-designs.json")?;
        Ok(())
    }

    #[test]
    fn complete_raw_component_group_is_allowed() -> Result<()> {
        assert_allowed("valid-raw.json")?;
        assert_allowed("two-designs.json")?;
        Ok(())
    }

    #[test]
    fn ordinary_unmarked_jersey_is_allowed() -> Result<()> {
        assert_allowed("ordinary-blank-jersey.json")?;
        assert_allowed("ordinary-line.json")?;
        Ok(())
    }

    #[test]
    fn hostile_raw_groups_are_blocked() -> Result<()> {
        for fixture in [
            "missing-surcharge.json",
            "cheaper-substitution.json",
            "wrong-quantity.json",
            "duplicate-component.json",
            "wrong-total.json",
            "wrong-currency.json",
            "bad-signature.json",
            "wrong-schema.json",
            "wrong-shop.json",
            "wrong-design.json",
            "wrong-bundle.json",
            "partial-markers.json",
            "orphan-surcharge.json",
        ] {
            assert_blocked(fixture)?;
        }
        Ok(())
    }

    #[test]
    fn hostile_merged_parents_are_blocked() -> Result<()> {
        for fixture in [
            "merged-bad-components.json",
            "merged-bad-signature.json",
            "merged-partial-markers.json",
            "merged-wrong-currency.json",
            "merged-wrong-merchandise.json",
            "merged-wrong-quantity.json",
            "merged-wrong-total.json",
        ] {
            assert_blocked(fixture)?;
        }
        Ok(())
    }

    #[test]
    fn invalid_configuration_and_resource_overflow_fail_closed() -> Result<()> {
        assert_blocked("invalid-config.json")?;
        assert_blocked("too-many-lines.json")?;
        assert_blocked("too-many-lines-orphan-surcharge.json")?;
        Ok(())
    }

    #[test]
    fn output_stays_below_shopify_twenty_kilobyte_limit() -> Result<()> {
        let output = run_fixture("too-many-lines.json")?;
        let mut context =
            shopify_function::wasm_api::Context::new_with_input(serde_json::json!({}));
        shopify_function::wasm_api::Serialize::serialize(&output, &mut context)?;
        let bytes = serde_json::to_vec(&context.finalize_output_and_return()?)?;
        assert!(bytes.len() < 20_000);
        Ok(())
    }

    #[test]
    fn decimal_amounts_convert_to_checked_minor_units() {
        assert_eq!(decimal_to_minor(107.0), Some(10_700));
        assert_eq!(decimal_to_minor(0.8), Some(80));
        assert_eq!(decimal_to_minor(10.123), None);
        assert_eq!(decimal_to_minor(-1.0), None);
    }
}
