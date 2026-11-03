BEGIN;

CREATE TABLE patient_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_code text NOT NULL UNIQUE,
  first_name text,
  middle_name text,
  last_name text,
  date_of_birth date,
  sex text NOT NULL,
  contact_number text,
  emergency_contact text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE encounters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id bigint NOT NULL REFERENCES patient_records(id),
  chief_complaint text NOT NULL,
  arrival_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'triage'
    CHECK (status IN ('triage','waiting','treatment','discharged','admitted','cancelled'))
);
CREATE INDEX encounters_patient_history ON encounters(patient_id, arrival_at DESC);
CREATE INDEX encounters_status ON encounters(status);

CREATE TABLE staff (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  clinical_role text NOT NULL,
  department text NOT NULL,
  shift text NOT NULL,
  employment_status text NOT NULL CHECK (employment_status IN ('Active','Inactive')),
  availability text NOT NULL CHECK (availability IN ('Available','Busy','On Break','Off Duty'))
);

CREATE TABLE triage_assessments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  encounter_id bigint NOT NULL REFERENCES encounters(id),
  esi integer NOT NULL CHECK (esi BETWEEN 1 AND 5),
  assessed_by text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assessments_encounter ON triage_assessments(encounter_id, id DESC);

CREATE TABLE patient_queues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  encounter_id bigint NOT NULL REFERENCES encounters(id),
  status text NOT NULL CHECK (status IN ('triage','waiting','completed')),
  priority integer CHECK (priority BETWEEN 1 AND 5),
  entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  CHECK ((status = 'completed') = (exited_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_queue ON patient_queues(encounter_id) WHERE exited_at IS NULL;
CREATE INDEX queue_priority ON patient_queues(status, priority, entered_at) WHERE exited_at IS NULL;

CREATE TABLE treatment_bays (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  location text NOT NULL,
  operational_status text NOT NULL CHECK (operational_status IN ('Active','Maintenance','Out of Service')),
  readiness text NOT NULL CHECK (readiness IN ('Available','Reserved','Cleaning'))
);

CREATE TABLE patient_assignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  encounter_id bigint NOT NULL REFERENCES encounters(id),
  bay_id bigint REFERENCES treatment_bays(id),
  staff_id bigint REFERENCES staff(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK ((bay_id IS NULL) <> (staff_id IS NULL))
);
CREATE UNIQUE INDEX one_active_bay_assignment ON patient_assignments(bay_id)
  WHERE released_at IS NULL AND bay_id IS NOT NULL;
CREATE UNIQUE INDEX one_active_staff_assignment ON patient_assignments(staff_id)
  WHERE released_at IS NULL AND staff_id IS NOT NULL;
CREATE UNIQUE INDEX one_bay_per_encounter ON patient_assignments(encounter_id)
  WHERE released_at IS NULL AND bay_id IS NOT NULL;
CREATE INDEX assignments_encounter ON patient_assignments(encounter_id, released_at);

CREATE TABLE resources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('Consumable','Reusable')),
  quantity_total integer NOT NULL CHECK (quantity_total >= 0),
  quantity_available integer NOT NULL CHECK (quantity_available BETWEEN 0 AND quantity_total),
  unit text NOT NULL,
  location text NOT NULL,
  status text NOT NULL CHECK (status IN ('Available','In Use','Maintenance','Unavailable'))
);

CREATE TABLE resource_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id bigint NOT NULL REFERENCES resources(id),
  quantity_delta integer NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  encounter_id bigint REFERENCES encounters(id),
  category text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_logs_recent ON event_logs(created_at DESC, id DESC);

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);

CREATE TABLE notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient ON notifications(recipient_id, id DESC);

COMMIT;
