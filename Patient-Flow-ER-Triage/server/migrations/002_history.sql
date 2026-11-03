ALTER TABLE encounters ADD COLUMN encounter_code text UNIQUE;
ALTER TABLE encounters ALTER COLUMN encounter_code SET DEFAULT ('ER-' || gen_random_uuid());
ALTER TABLE encounters ADD COLUMN discharged_at timestamptz;
ALTER TABLE encounters ADD COLUMN vitals jsonb;
ALTER TABLE encounters ADD COLUMN pain integer CHECK (pain BETWEEN 0 AND 10);
ALTER TABLE encounters ADD COLUMN suggested_esi integer CHECK (suggested_esi BETWEEN 1 AND 5);
ALTER TABLE patient_records ADD COLUMN is_unidentified boolean GENERATED ALWAYS AS (first_name IS NULL AND last_name IS NULL) STORED;
CREATE INDEX resource_transactions_history ON resource_transactions(resource_id,id DESC);
CREATE INDEX audit_logs_recent ON audit_logs(id DESC);

CREATE FUNCTION reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER retain_resource_transactions BEFORE UPDATE OR DELETE ON resource_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER retain_audit_logs BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER retain_assessments BEFORE UPDATE OR DELETE ON triage_assessments
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
