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
