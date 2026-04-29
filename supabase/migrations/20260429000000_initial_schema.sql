-- stations
CREATE TABLE stations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  display_order int  NOT NULL DEFAULT 0
);

-- menu_items
CREATE TABLE menu_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- recipe_steps — template steps per dish, not tied to any order
CREATE TABLE recipe_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id       uuid NOT NULL REFERENCES menu_items(id),
  station_id         uuid NOT NULL REFERENCES stations(id),
  step_number        int  NOT NULL,
  name               text NOT NULL,
  estimated_duration int  NOT NULL, -- seconds
  UNIQUE (menu_item_id, step_number)
);

-- orders
CREATE TABLE orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number      int         NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','completed','cancelled')),
  target_serve_time timestamptz NOT NULL,
  delay_status      text        NOT NULL DEFAULT 'on_track'
                    CHECK (delay_status IN ('on_track','soft_delay','hard_delay')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- order_items — one row per dish per order
CREATE TABLE order_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid        NOT NULL REFERENCES orders(id),
  menu_item_id uuid        NOT NULL REFERENCES menu_items(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- order_steps — live instance of each recipe step, frozen at order time
CREATE TABLE order_steps (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id      uuid        NOT NULL REFERENCES order_items(id),
  recipe_step_id     uuid        NOT NULL REFERENCES recipe_steps(id),
  station_id         uuid        NOT NULL REFERENCES stations(id),   -- denormalized
  step_number        int         NOT NULL,                           -- denormalized
  name               text        NOT NULL,                           -- denormalized
  estimated_duration int         NOT NULL,                           -- seconds, frozen at order time
  status             text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','fired','in_progress','completed','delayed')),
  fire_at            timestamptz,
  ready_at           timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  flagged_at         timestamptz,
  actual_duration    int,         -- seconds, computed on completion
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- cook view: pending/fired steps for a station ordered by fire_at
CREATE INDEX idx_order_steps_station_status ON order_steps (station_id, status, fire_at);
-- scheduler: all steps for an order item in sequence
CREATE INDEX idx_order_steps_order_item    ON order_steps (order_item_id, step_number);
-- expeditor: active orders by serve time
CREATE INDEX idx_orders_status             ON orders (status, target_serve_time);

-- enable Supabase Realtime on the tables clients subscribe to
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE order_steps;
