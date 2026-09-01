export interface LeadCaptureSource {
  id: string;
  tenant_id: string;
  label: string;
  token_prefix: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  lead_count: number;
}

// Only the shape of the POST /api/lead-sources response, right after creation — the one
// and only time the raw token is ever sent back to the client.
export interface LeadCaptureSourceWithToken extends LeadCaptureSource {
  token: string;
}
