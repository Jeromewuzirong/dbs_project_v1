CREATE TABLE chefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  station_id uuid NOT NULL REFERENCES stations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nullable: a step may be unassigned, or its chef may be removed.
ALTER TABLE order_steps
  ADD COLUMN assigned_chef_id uuid REFERENCES chefs(id) ON DELETE SET NULL;
