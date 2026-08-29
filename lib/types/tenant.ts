export interface Tenant {
  id: string;
  name: string;
  city: string;
  operatories: number;
  status: string;
  uptime: string | null;
  created_at: string;
  patients?: number;
}
