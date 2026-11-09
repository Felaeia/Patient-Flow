CREATE TABLE patient_records (
  id INTEGER PRIMARY KEY,
  patient_code text NOT NULL UNIQUE,
  first_name text,
  middle_name text,
  last_name text,
  date_of_birth TEXT,
  sex text NOT NULL,
  contact_number text,
  emergency_contact text,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_unidentified INTEGER GENERATED ALWAYS AS (first_name IS NULL AND last_name IS NULL) STORED,
  legacy_unidentified INTEGER CHECK (legacy_unidentified IN (0, 1))
) STRICT;

CREATE TABLE encounters (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patient_records(id),
  chief_complaint text NOT NULL,
  arrival_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status text NOT NULL DEFAULT 'triage'
    CHECK (status IN ('triage','waiting','treatment','discharged','admitted','cancelled')),
  encounter_code TEXT UNIQUE,
  discharged_at TEXT,
  vitals TEXT CHECK (vitals IS NULL OR json_valid(vitals)),
  pain INTEGER CHECK (pain BETWEEN 0 AND 10),
  suggested_esi INTEGER CHECK (suggested_esi BETWEEN 1 AND 5),
  treatment_priority INTEGER CHECK (treatment_priority BETWEEN 1 AND 5),
  legacy_operational_id TEXT UNIQUE,
  archived_at TEXT
) STRICT;
CREATE INDEX encounters_patient_history ON encounters(patient_id, arrival_at DESC);
CREATE INDEX encounters_status ON encounters(status);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  employee_code text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  clinical_role text NOT NULL,
  department text NOT NULL,
  shift text NOT NULL,
  employment_status text NOT NULL CHECK (employment_status IN ('Active','Inactive')),
  availability text NOT NULL CHECK (availability IN ('Available','Busy','On Break','Off Duty')),
  legacy_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE triage_assessments (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  esi integer NOT NULL CHECK (esi BETWEEN 1 AND 5),
  assessed_by text NOT NULL,
  notes text,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX assessments_encounter ON triage_assessments(encounter_id, id DESC);

CREATE TABLE patient_queues (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  status text NOT NULL CHECK (status IN ('triage','waiting','completed')),
  priority integer CHECK (priority BETWEEN 1 AND 5),
  entered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  exited_at TEXT,
  CHECK ((status = 'completed') = (exited_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_active_queue ON patient_queues(encounter_id) WHERE exited_at IS NULL;
CREATE INDEX queue_priority ON patient_queues(status, priority, entered_at) WHERE exited_at IS NULL;

CREATE TABLE treatment_bays (
  id INTEGER PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  location text NOT NULL,
  operational_status text NOT NULL CHECK (operational_status IN ('Active','Maintenance','Out of Service')),
  readiness text NOT NULL CHECK (readiness IN ('Available','Reserved','Cleaning')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE patient_assignments (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  bay_id INTEGER REFERENCES treatment_bays(id),
  staff_id INTEGER REFERENCES staff(id),
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  released_at TEXT,
  CHECK ((bay_id IS NULL) <> (staff_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX one_active_bay_assignment ON patient_assignments(bay_id)
  WHERE released_at IS NULL AND bay_id IS NOT NULL;
CREATE UNIQUE INDEX one_active_staff_assignment ON patient_assignments(staff_id)
  WHERE released_at IS NULL AND staff_id IS NOT NULL;
CREATE UNIQUE INDEX one_bay_per_encounter ON patient_assignments(encounter_id)
  WHERE released_at IS NULL AND bay_id IS NOT NULL;
CREATE INDEX assignments_encounter ON patient_assignments(encounter_id, released_at);

CREATE TABLE resources (
  id INTEGER PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('Consumable','Reusable')),
  quantity_total integer NOT NULL CHECK (quantity_total >= 0),
  quantity_available integer NOT NULL CHECK (quantity_available BETWEEN 0 AND quantity_total),
  unit text NOT NULL,
  location text NOT NULL,
  status text NOT NULL CHECK (status IN ('Available','In Use','Maintenance','Unavailable')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
) STRICT;

CREATE TABLE resource_transactions (
  id INTEGER PRIMARY KEY,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  quantity_delta integer NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE event_logs (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER REFERENCES encounters(id),
  category text NOT NULL,
  message text NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  legacy_id TEXT UNIQUE,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','success','warn','critical'))
) STRICT;
CREATE INDEX event_logs_recent ON event_logs(created_at DESC, id DESC);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  recipient_id text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  type TEXT NOT NULL DEFAULT 'info'
) STRICT;
CREATE INDEX notifications_recipient ON notifications(recipient_id, id DESC);

CREATE INDEX resource_transactions_history ON resource_transactions(resource_id, id DESC);
CREATE INDEX audit_logs_recent ON audit_logs(id DESC);

CREATE TRIGGER retain_resource_transactions_update BEFORE UPDATE ON resource_transactions
BEGIN
  SELECT RAISE(ABORT, 'History is append-only');
END;

CREATE TRIGGER retain_resource_transactions_delete BEFORE DELETE ON resource_transactions
BEGIN
  SELECT RAISE(ABORT, 'History is append-only');
END;

CREATE TRIGGER retain_audit_logs_update BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'History is append-only');
END;

CREATE TRIGGER retain_audit_logs_delete BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'History is append-only');
END;

CREATE TRIGGER retain_assessments_update BEFORE UPDATE ON triage_assessments
BEGIN
  SELECT RAISE(ABORT, 'History is append-only');
END;

CREATE TRIGGER retain_assessments_delete BEFORE DELETE ON triage_assessments
BEGIN
  SELECT RAISE(ABORT, 'History is append-only');
END;
