-- Many-to-many junction table for chef → station assignments.
CREATE TABLE chef_stations (
  chef_id    uuid NOT NULL REFERENCES chefs(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  PRIMARY KEY (chef_id, station_id)
);

-- Migrate any existing single-station assignments.
INSERT INTO chef_stations (chef_id, station_id)
SELECT id, station_id FROM chefs WHERE station_id IS NOT NULL;

-- Remove the now-redundant column (FK constraint drops with it).
ALTER TABLE chefs DROP COLUMN station_id;
