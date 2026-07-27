use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use shopify_function::scalars::JsonValue;
use std::collections::{BTreeSet, HashSet};

pub const QUOTE_SCHEMA_VERSION: i64 = 1;
const MAX_TOKEN_LENGTH: usize = 255;
const MAX_COMPONENTS_JSON_BYTES: usize = 255;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    Base,
    Surcharge,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Component {
    pub role: Role,
    pub variant_id: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedContract {
    pub bundle_id: String,
    pub design_id: String,
    pub components_json: String,
}

pub struct StoreConfig {
    pub schema: i64,
    pub shop_fingerprint: String,
    pub signing_secret: String,
    pub product_id: String,
    pub currency: String,
    pub jersey_variant_ids: BTreeSet<String>,
    pub surcharge_variant_ids: BTreeSet<String>,
}

pub fn parse_store_config(value: &JsonValue) -> Option<StoreConfig> {
    let JsonValue::Object(object) = value else {
        return None;
    };
    if object.len() != 7 {
        return None;
    }
    let schema = match object.get("schema")? {
        JsonValue::Number(value) if value.is_finite() && *value == 1.0 => 1,
        _ => return None,
    };
    let shop_fingerprint = match object.get("shopFingerprint")? {
        JsonValue::String(value) => value.clone(),
        _ => return None,
    };
    let signing_secret = match object.get("signingSecret")? {
        JsonValue::String(value) => value.clone(),
        _ => return None,
    };
    let product_id = json_string(object.get("productId")?)?;
    let currency = json_string(object.get("currency")?)?;
    let jersey_variant_ids = variant_map_values(object.get("jerseyVariants")?, false)?;
    let surcharge_variant_ids = variant_map_values(object.get("surchargeVariants")?, true)?;
    if jersey_variant_ids
        .iter()
        .any(|variant_id| surcharge_variant_ids.contains(variant_id))
    {
        return None;
    }
    let config = StoreConfig {
        schema,
        shop_fingerprint,
        signing_secret,
        product_id,
        currency,
        jersey_variant_ids,
        surcharge_variant_ids,
    };
    if config.schema != QUOTE_SCHEMA_VERSION
        || !is_shop_fingerprint(&config.shop_fingerprint)
        || config.signing_secret.as_bytes().len() < 32
        || config.signing_secret.as_bytes().len() > 256
        || config.product_id.is_empty()
        || config.product_id.len() > 128
        || !config
            .product_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        || config.currency != "USD"
    {
        return None;
    }
    Some(config)
}

pub fn verify_contract(
    token: &str,
    components: &[Component],
    bundle_id: &str,
    design_id: &str,
    schema: &str,
    config: &StoreConfig,
    shopify_total_minor: i64,
    shopify_currency: &str,
) -> Option<VerifiedContract> {
    if token.len() > MAX_TOKEN_LENGTH || schema != "1" {
        return None;
    }
    let mut segments = token.split('.');
    let encoded_header = segments.next()?;
    let encoded_signature = segments.next()?;
    if segments.next().is_some() || encoded_header.is_empty() || encoded_signature.is_empty() {
        return None;
    }
    let header_bytes = decode_canonical_base64url(encoded_header)?;
    let signature = decode_canonical_base64url(encoded_signature)?;
    if signature.len() != 32 {
        return None;
    }
    let header_value: serde_json::Value = serde_json::from_slice(&header_bytes).ok()?;
    let fields = header_value.as_array()?;
    if fields.len() != 8 {
        return None;
    }
    if serde_json::to_vec(&header_value).ok()? != header_bytes {
        return None;
    }

    let version = fields[0].as_i64()?;
    let shop_fingerprint = fields[1].as_str()?;
    let signed_bundle_id = fields[2].as_str()?;
    let signed_design_id = fields[3].as_str()?;
    let total_minor = fields[4].as_i64()?;
    let currency = fields[5].as_str()?;
    let issued_at = fields[6].as_i64()?;
    let expires_at = fields[7].as_i64()?;
    if version != QUOTE_SCHEMA_VERSION
        || shop_fingerprint != config.shop_fingerprint
        || signed_bundle_id != bundle_id
        || signed_design_id != design_id
        || !is_bundle_id(bundle_id)
        || !is_design_id(design_id)
        || total_minor < 0
        || currency.len() != 3
        || !currency.bytes().all(|byte| byte.is_ascii_uppercase())
        || currency != config.currency
        || shopify_currency != config.currency
        || total_minor != shopify_total_minor
        || issued_at < 0
        || issued_at >= expires_at
    {
        return None;
    }

    let canonical_components = canonical_components(components)?;
    for component in &canonical_components {
        match component.role {
            Role::Base if !config.jersey_variant_ids.contains(&component.variant_id) => {
                return None;
            }
            Role::Surcharge if !config.surcharge_variant_ids.contains(&component.variant_id) => {
                return None;
            }
            _ => {}
        }
    }
    let compact: Vec<(char, &str, i64)> = canonical_components
        .iter()
        .map(|component| {
            (
                if component.role == Role::Base {
                    'b'
                } else {
                    's'
                },
                component.variant_id.as_str(),
                component.quantity,
            )
        })
        .collect();
    let compact_json = serde_json::to_string(&compact).ok()?;
    if compact_json.as_bytes().len() > MAX_COMPONENTS_JSON_BYTES {
        return None;
    }
    let message = format!("q1\n{encoded_header}\n{compact_json}");
    let mut mac = HmacSha256::new_from_slice(config.signing_secret.as_bytes()).ok()?;
    mac.update(message.as_bytes());
    if mac.verify_slice(&signature).is_err() {
        return None;
    }

    Some(VerifiedContract {
        bundle_id: bundle_id.to_owned(),
        design_id: design_id.to_owned(),
        components_json: compact_json,
    })
}

fn json_string(value: &JsonValue) -> Option<String> {
    match value {
        JsonValue::String(value) => Some(value.clone()),
        _ => None,
    }
}

fn variant_map_values(value: &JsonValue, numeric_keys: bool) -> Option<BTreeSet<String>> {
    let JsonValue::Object(map) = value else {
        return None;
    };
    if map.is_empty() || map.len() > 64 {
        return None;
    }
    let mut values = BTreeSet::new();
    for (key, value) in map {
        if key.is_empty()
            || key.len() > 64
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            || (numeric_keys
                && (key.starts_with('0')
                    || !key.bytes().all(|byte| byte.is_ascii_digit())
                    || key
                        .parse::<u64>()
                        .ok()
                        .filter(|amount| *amount > 0)
                        .is_none()))
        {
            return None;
        }
        let variant_id = json_string(value)?;
        if !is_canonical_u64(&variant_id) || !values.insert(variant_id) {
            return None;
        }
    }
    Some(values)
}

fn canonical_components(components: &[Component]) -> Option<Vec<Component>> {
    if components.is_empty() {
        return None;
    }
    let mut normalized = components.to_vec();
    let mut ids = HashSet::new();
    let mut base_count = 0;
    for component in &normalized {
        if !is_canonical_u64(&component.variant_id)
            || component.quantity <= 0
            || !ids.insert(component.variant_id.as_str())
        {
            return None;
        }
        if component.role == Role::Base {
            base_count += 1;
        }
    }
    if base_count != 1 {
        return None;
    }
    normalized.sort_by(|left, right| {
        let left_role = if left.role == Role::Base { 0 } else { 1 };
        let right_role = if right.role == Role::Base { 0 } else { 1 };
        left_role
            .cmp(&right_role)
            .then(left.variant_id.len().cmp(&right.variant_id.len()))
            .then(left.variant_id.cmp(&right.variant_id))
    });
    Some(normalized)
}

fn decode_canonical_base64url(value: &str) -> Option<Vec<u8>> {
    if value.is_empty()
        || value.len() % 4 == 1
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(value).ok()?;
    if URL_SAFE_NO_PAD.encode(&decoded) != value {
        return None;
    }
    Some(decoded)
}

fn is_canonical_u64(value: &str) -> bool {
    if value.is_empty()
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    value
        .parse::<u64>()
        .map(|number| number > 0)
        .unwrap_or(false)
}

fn is_shop_fingerprint(value: &str) -> bool {
    value.len() == 17 && value.starts_with("shop_") && is_url_safe(&value[5..])
}

fn is_bundle_id(value: &str) -> bool {
    let suffix = value.strip_prefix("bun_");
    suffix
        .map(|part| (16..=64).contains(&part.len()) && is_url_safe(part))
        .unwrap_or(false)
}

fn is_design_id(value: &str) -> bool {
    let suffix = value.strip_prefix("dsg_");
    suffix
        .map(|part| (16..=64).contains(&part.len()) && is_url_safe(part))
        .unwrap_or(false)
}

fn is_url_safe(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}
