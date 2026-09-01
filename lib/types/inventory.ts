export interface InventoryItem {
  id: number;
  item: string;
  unit: string;
  reorder_at: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryStock {
  item_id: number;
  tenant_id: string;
  quantity: number;
}

export type InventoryMovementReason = 'received' | 'consumed' | 'adjusted' | 'wastage' | 'expired';

export interface InventoryMovement {
  id: string;
  tenant_id: string;
  item_id: number;
  item_name?: string;
  batch_id: string | null;
  delta: number;
  reason: InventoryMovementReason;
  notes: string;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export type BatchExpiryStatus = 'expired' | 'expiring_soon' | 'ok' | 'no_expiry';

export interface InventoryBatch {
  id: string;
  batch_number: string;
  quantity: number;
  expiry_date: string | null;
  expiryStatus: BatchExpiryStatus;
}

export interface InventoryOverviewRow {
  item: { id: number; item: string; unit: string; reorder_at: number };
  currentQty: number;
  dailyRate: number;
  daysUntilStockout: number | null;
  atRisk: boolean;
  suggestedReorderQty: number;
  batches: InventoryBatch[];
}

// Item 13's schedule-driven forecast — see lib/inventory.ts's computeProcedureDemandForecast.
export interface ProcedureDemandRow {
  itemId: number;
  item: string;
  unit: string;
  currentQty: number;
  projectedDemand: number;
  shortfall: number;
}

export interface InventoryForecastResponse {
  overview: InventoryOverviewRow[];
  procedureDemand: ProcedureDemandRow[];
}

export interface ProcedureItemUsage {
  id: string;
  tenant_id: string;
  appointment_type: string;
  item_id: number;
  item_name?: string;
  unit?: string;
  qty_per_procedure: number;
  created_at: string;
  updated_at: string;
}

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received' | 'cancelled';
export type PurchaseOrderSource = 'auto' | 'manual';

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  item_id: number;
  item_name?: string;
  unit?: string;
  quantity: number;
  expiry_date: string | null;
}

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  status: PurchaseOrderStatus;
  source: PurchaseOrderSource;
  notes: string;
  created_by: string | null;
  ordered_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
  items: PurchaseOrderItem[];
}
