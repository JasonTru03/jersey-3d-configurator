import { selectedOptions } from './selectors.js';

export function calculateQuote(product, state) {
  const selected = selectedOptions(product, state);
  const optionAdjustments = [];

  appendAdjustment(optionAdjustments, selected.layout);
  appendAdjustment(optionAdjustments, selected.material);
  appendAdjustment(optionAdjustments, selected.lighting);
  selected.extras.forEach((extra) => appendAdjustment(optionAdjustments, extra));

  const total = optionAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount,
    product.basePrice,
  );

  return {
    basePrice: product.basePrice,
    optionAdjustments,
    total,
    currency: product.currency,
  };
}

function appendAdjustment(adjustments, option) {
  if (!option || !option.priceDelta) return;
  adjustments.push({
    label: option.label,
    amount: option.priceDelta,
  });
}
