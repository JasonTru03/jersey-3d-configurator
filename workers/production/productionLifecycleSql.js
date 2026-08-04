const MAX_INPUT_JSON_BYTES = 1024 * 1024;
const INTEGER_COLUMNS = new Set(['paid_at', 'updated_at']);

export function createPaidLifecycleStatementSpecs(delivery, designs, status) {
  return Object.freeze({
    update: createPaidUpdate(delivery, designs, status),
    receipt: createPaidReceipt(delivery, designs, status),
    selectReceipt: createReceiptSelect(delivery),
  });
}

export function createTerminalLifecycleStatementSpecs(delivery, designs, status) {
  return Object.freeze({
    update: createTerminalUpdate(delivery, designs, status),
    receipt: createTerminalReceipt(delivery, designs, status),
    selectReceipt: createReceiptSelect(delivery),
  });
}

function createPaidUpdate(delivery, designs, status) {
  const cte = createInputCte(designs, [
    'design_id', 'bundle_id', 'order_name', 'paid_at', 'updated_at', 'error_code',
  ], (design) => [
    design.designId, design.bundleId, design.orderName, design.paidAt,
    design.updatedAt, design.errorCode,
  ]);
  return statement(`
    ${cte.sql}
    UPDATE production_designs
    SET status = ?,
      shopify_order_gid = ?,
      shopify_order_name = (
        SELECT order_name FROM input_designs WHERE design_id = production_designs.design_id
      ),
      paid_at = (
        SELECT paid_at FROM input_designs WHERE design_id = production_designs.design_id
      ),
      error_code = (
        SELECT error_code FROM input_designs WHERE design_id = production_designs.design_id
      ),
      updated_at = (
        SELECT updated_at FROM input_designs WHERE design_id = production_designs.design_id
      )
    WHERE shop = ?
      AND design_id IN (SELECT design_id FROM input_designs)
      AND NOT EXISTS (
        SELECT 1 FROM shopify_webhook_deliveries
        WHERE webhook_id = ?
          OR (? IS NOT NULL AND shop = ? AND topic = ? AND event_id = ?)
      )
      AND (
        SELECT COUNT(*)
        FROM production_designs AS candidate
        INNER JOIN input_designs AS requested
          ON requested.design_id = candidate.design_id
        WHERE candidate.shop = ?
          AND candidate.bundle_id = requested.bundle_id
          AND candidate.status IN ('cart_draft', 'paid_pending_production', 'file_error')
          AND candidate.updated_at <= requested.updated_at
          AND (candidate.shopify_order_gid IS NULL OR candidate.shopify_order_gid = ?)
      ) = (SELECT COUNT(*) FROM input_designs)
  `, [
    ...cte.values,
    status,
    delivery.orderGid,
    delivery.shop,
    delivery.webhookId,
    delivery.eventId,
    delivery.shop,
    delivery.topic,
    delivery.eventId,
    delivery.shop,
    delivery.orderGid,
  ]);
}

function createTerminalUpdate(delivery, designs, status) {
  const allowedStatuses = status === 'cancelled'
    ? "'paid_pending_production', 'file_error', 'cancelled'"
    : "'paid_pending_production', 'file_error', 'cancelled', 'refunded'";
  const cte = createInputCte(
    designs,
    ['design_id', 'updated_at'],
    (design) => [design.designId, design.updatedAt],
  );
  return statement(`
    ${cte.sql}
    UPDATE production_designs
    SET status = ?,
      updated_at = (
        SELECT updated_at FROM input_designs WHERE design_id = production_designs.design_id
      )
    WHERE shop = ?
      AND design_id IN (SELECT design_id FROM input_designs)
      AND shopify_order_gid = ?
      AND NOT EXISTS (
        SELECT 1 FROM shopify_webhook_deliveries
        WHERE webhook_id = ?
          OR (? IS NOT NULL AND shop = ? AND topic = ? AND event_id = ?)
      )
      AND (
        SELECT COUNT(*)
        FROM production_designs AS candidate
        INNER JOIN input_designs AS requested
          ON requested.design_id = candidate.design_id
        WHERE candidate.shop = ?
          AND candidate.shopify_order_gid = ?
          AND candidate.status IN (${allowedStatuses})
          AND candidate.updated_at <= requested.updated_at
      ) = (SELECT COUNT(*) FROM input_designs)
  `, [
    ...cte.values,
    status,
    delivery.shop,
    delivery.orderGid,
    delivery.webhookId,
    delivery.eventId,
    delivery.shop,
    delivery.topic,
    delivery.eventId,
    delivery.shop,
    delivery.orderGid,
  ]);
}

function createPaidReceipt(delivery, designs, status) {
  const cte = createInputCte(designs, [
    'design_id', 'bundle_id', 'order_name', 'paid_at', 'updated_at', 'error_code',
  ], (design) => [
    design.designId, design.bundleId, design.orderName, design.paidAt,
    design.updatedAt, design.errorCode,
  ]);
  return statement(`
    ${cte.sql}
    INSERT OR IGNORE INTO shopify_webhook_deliveries (
      webhook_id, event_id, shop, topic, order_gid, received_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*)
      FROM production_designs AS stored
      INNER JOIN input_designs AS requested
        ON requested.design_id = stored.design_id
      WHERE stored.shop = ?
        AND stored.bundle_id = requested.bundle_id
        AND stored.status = ?
        AND stored.shopify_order_gid = ?
        AND stored.shopify_order_name = requested.order_name
        AND stored.paid_at = requested.paid_at
        AND stored.error_code IS requested.error_code
        AND stored.updated_at = requested.updated_at
    ) = (SELECT COUNT(*) FROM input_designs)
  `, [
    ...cte.values,
    delivery.webhookId,
    delivery.eventId,
    delivery.shop,
    delivery.topic,
    delivery.orderGid,
    delivery.receivedAt,
    delivery.shop,
    status,
    delivery.orderGid,
  ]);
}

function createTerminalReceipt(delivery, designs, status) {
  const cte = createInputCte(
    designs,
    ['design_id', 'updated_at'],
    (design) => [design.designId, design.updatedAt],
  );
  return statement(`
    ${cte.sql}
    INSERT OR IGNORE INTO shopify_webhook_deliveries (
      webhook_id, event_id, shop, topic, order_gid, received_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*)
      FROM production_designs AS stored
      INNER JOIN input_designs AS requested
        ON requested.design_id = stored.design_id
      WHERE stored.shop = ?
        AND stored.status = ?
        AND stored.shopify_order_gid = ?
        AND stored.updated_at = requested.updated_at
    ) = (SELECT COUNT(*) FROM input_designs)
  `, [
    ...cte.values,
    delivery.webhookId,
    delivery.eventId,
    delivery.shop,
    delivery.topic,
    delivery.orderGid,
    delivery.receivedAt,
    delivery.shop,
    status,
    delivery.orderGid,
  ]);
}

function createReceiptSelect(delivery) {
  return statement(`
    SELECT webhook_id, event_id, shop, topic, order_gid, received_at
    FROM shopify_webhook_deliveries
    WHERE (
      shop = ? AND topic = ? AND order_gid = ?
      AND webhook_id = ? AND event_id IS ?
    ) OR (
      ? IS NOT NULL AND shop = ? AND topic = ? AND order_gid = ? AND event_id = ?
    )
    ORDER BY CASE WHEN webhook_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `, [
    delivery.shop,
    delivery.topic,
    delivery.orderGid,
    delivery.webhookId,
    delivery.eventId,
    delivery.eventId,
    delivery.shop,
    delivery.topic,
    delivery.orderGid,
    delivery.eventId,
    delivery.webhookId,
  ]);
}

function createInputCte(designs, columns, getValues) {
  const payload = designs.map((design) => {
    const values = getValues(design);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).byteLength > MAX_INPUT_JSON_BYTES) {
    throw new RangeError('Production lifecycle input exceeds the D1 JSON limit.');
  }
  const selections = columns.map((column) => {
    const value = `json_extract(value, '$.${column}')`;
    return `${INTEGER_COLUMNS.has(column) ? `CAST(${value} AS INTEGER)` : value} AS ${column}`;
  }).join(',\n        ');
  return {
    sql: `WITH input_designs (${columns.join(', ')}) AS (
      SELECT
        ${selections}
      FROM json_each(?)
    )`,
    values: [json],
  };
}

function statement(sql, values) {
  return Object.freeze({ sql, values: Object.freeze(values) });
}
