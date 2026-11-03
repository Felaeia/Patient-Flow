ALTER TABLE encounters ADD COLUMN treatment_priority integer CHECK (treatment_priority BETWEEN 1 AND 5);
