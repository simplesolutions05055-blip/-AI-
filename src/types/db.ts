export type ConversationStatus = 'active' | 'waiting_for_user' | 'closed';

export type RequestStatus =
  | 'received'
  | 'collecting_details'
  | 'queued'
  | 'processing'
  | 'quality_check'
  | 'waiting_for_approval'
  | 'approved'
  | 'rejected'
  | 'regenerating'
  | 'sending'
  | 'sent'
  | 'needs_attention'
  | 'failed'
  | 'closed';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
export type MessageDirection = 'inbound' | 'outbound';
export type OutputType = 'text' | 'image' | 'pdf' | 'presentation';
export type ApprovalModeValue = 'manual' | 'automatic' | 'by_output_type';
export type LogSeverity = 'debug' | 'info' | 'warning' | 'error';
export type BusinessSourceKind = 'content_only' | 'visual_only' | 'brand_rules';

export interface StructuredBrief {
  output_type?: OutputType;
  goal?: string;
  audience?: string;
  language?: string;
  must_include?: string[];
  style?: string;
  source_materials?: string;
  dimensions?: string;
  customer_email?: string;
  ready?: boolean;
  missing?: string[];
}

export interface ApprovalSetting {
  mode: ApprovalModeValue;
  by_type: Record<'text' | 'image' | 'pdf', 'manual' | 'automatic'>;
}

export interface RateLimitSetting {
  messages_per_24h: number;
  generations_per_24h: number;
  daily_budget_usd: number | null;
}

export interface WhatsappTemplates {
  received: string;
  ask_email: string;
  sent: string;
  needs_attention: string;
  rejected_media: string;
  blocked: string;
}

export interface EmailSettings {
  from_name: string;
  subject_rule: string;
  signature: string;
}

export interface QaResult {
  passed: boolean;
  issues: string[];
  notes?: string;
}

export type BrandColorRole = 'primary' | 'secondary' | 'accent' | 'background' | 'text';

export interface BrandColor {
  hex: string;
  role: BrandColorRole;
}

export interface Brand {
  id: string;
  name: string;
  aliases: string[];
  logo_path: string | null;
  color_palette: BrandColor[];
  style_notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandAsset {
  id: string;
  brand_id: string;
  storage_path: string;
  mime_type: string | null;
  caption: string | null;
  source_kind: BusinessSourceKind;
  created_at: string;
}

export interface BusinessTextSource {
  id: string;
  brand_id: string;
  title: string;
  content: string;
  source_kind: BusinessSourceKind;
  created_at: string;
  updated_at: string;
}

export type SkillCategory = 'skill' | 'agent' | 'rule';

export interface Skill {
  key: string;
  display_name: string;
  description: string | null;
  category: SkillCategory;
  order_index: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkillVersion {
  id: string;
  skill_key: string;
  version_number: number;
  content: string;
  config_json: Record<string, unknown>;
  note: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}
