export interface DbUser {
  id: string;
  tenant_id: string | null;
  tenant_name?: string | null;
  email: string;
  name: string;
  role: string;
  clinic: string;
  active: boolean;
  created_at: string;
}
