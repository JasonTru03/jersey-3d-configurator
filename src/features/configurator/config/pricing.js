import { selectedOptions } from './selectors.js';
import { CUSTOM_TEXT_PRICE, getBillableCustomTextItems, getCustomTextItems } from './customTextItems.js';

export function calculateQuote(product, state) {
  const selected = selectedOptions(product, state);
  const optionAdjustments = [];
  const layoutAdjustment = selected.layout?.priceDelta ?? 0;

  appendAdjustment(optionAdjustments, selected.layout);
  appendAdjustment(optionAdjustments, selected.material);
  appendAdjustment(optionAdjustments, selected.lighting);
  selected.extras.forEach((extra) => appendAdjustment(optionAdjustments, extra));
  appendCustomTextAdjustment(optionAdjustments, state.overrides);

  const total = optionAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount,
    product.basePrice,
  );
  const merchandisePrice = product.basePrice + layoutAdjustment;

  return {
    basePrice: product.basePrice,
    merchandisePrice,
    customizationTotal: total - merchandisePrice,
    optionAdjustments,
    total,
    currency: product.currency,
  };
}

function appendCustomTextAdjustment(adjustments, overrides) {
  const billableItems = getBillableCustomTextItems(getCustomTextItems(overrides));
  if (!billableItems.length) return;
  adjustments.push({
    label: `Custom text × ${billableItems.length}`,
    amount: billableItems.length * CUSTOM_TEXT_PRICE,
  });
}

function appendAdjustment(adjustments, option) {
  if (!option || !option.priceDelta) return;
  adjustments.push({
    label: option.label,
    amount: option.priceDelta,
  });
}
