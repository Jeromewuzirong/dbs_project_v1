// DB row shapes — mirrors the Postgres schema exactly.
// Timestamps are ISO strings as returned by Supabase.

export type StepStatus = 'pending' | 'fired' | 'in_progress' | 'completed' | 'delayed';
export type OrderStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type DelayStatus = 'on_track' | 'soft_delay' | 'hard_delay';

export interface Station {
  id: string;
  name: string;
  display_order: number;
}

export interface MenuItem {
  id: string;
  name: string;
  created_at: string;
}

export interface RecipeStep {
  id: string;
  menu_item_id: string;
  station_id: string;
  step_number: number;
  name: string;
  estimated_duration: number; // seconds
}

export interface Order {
  id: string;
  table_number: number;
  status: OrderStatus;
  target_serve_time: string;
  delay_status: DelayStatus;
  notes: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  created_at: string;
}

export interface OrderStep {
  id: string;
  order_item_id: string;
  recipe_step_id: string;
  station_id: string;
  step_number: number;
  name: string;
  estimated_duration: number; // seconds
  status: StepStatus;
  fire_at: string | null;
  ready_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  flagged_at: string | null;
  actual_duration: number | null; // seconds
  assigned_chef_id: string | null;
  created_at: string;
}
