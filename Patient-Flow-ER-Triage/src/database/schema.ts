import type { SQLiteDatabase } from "expo-sqlite";

export type Connection = Pick<SQLiteDatabase, "execAsync" | "runAsync" | "getFirstAsync" | "getAllAsync">;

export async function transaction<T>(db: Connection, work: () => Promise<T>): Promise<T> {
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    const result = await work();
    await db.execAsync("COMMIT");
    return result;
  } catch (error) {
    await db.execAsync("ROLLBACK");
    throw error;
  }
}

const migrations = [
  `
  CREATE TABLE Patients (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    age INTEGER NOT NULL CHECK(age >= 0),
    sex TEXT NOT NULL,
    complaint TEXT NOT NULL,
    vitals TEXT NOT NULL,
    pain INTEGER NOT NULL CHECK(pain BETWEEN 0 AND 10),
    suggestedEsi INTEGER NOT NULL CHECK(suggestedEsi BETWEEN 1 AND 5),
    status TEXT NOT NULL CHECK(status IN ('triage','waiting','treatment','discharged','admitted')),
    arrivalTs INTEGER NOT NULL CHECK(arrivalTs >= 0),
    treatmentProgress REAL NOT NULL CHECK(treatmentProgress BETWEEN 0 AND 100),
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX patients_status ON Patients(status);
  CREATE TABLE TreatmentBays (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','occupied','unavailable')),
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE Staff (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Doctor','Nurse','Triage')),
    status TEXT NOT NULL DEFAULT 'Idle' CHECK(status IN ('Idle','Busy','Unavailable')),
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE TriageAssessments (
    id INTEGER PRIMARY KEY,
    patientId TEXT NOT NULL REFERENCES Patients(id),
    esi INTEGER NOT NULL CHECK(typeof(esi) = 'integer' AND esi BETWEEN 1 AND 5),
    notes TEXT,
    assessedBy TEXT REFERENCES Staff(id),
    assessedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX assessments_patient ON TriageAssessments(patientId, id DESC);
  CREATE TABLE PatientQueues (
    id INTEGER PRIMARY KEY,
    patientId TEXT NOT NULL REFERENCES Patients(id),
    status TEXT NOT NULL CHECK(status IN ('triage','waiting','completed')),
    priority INTEGER CHECK(priority BETWEEN 1 AND 5),
    enteredTick INTEGER NOT NULL CHECK(enteredTick >= 0),
    enteredAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    exitedAt TEXT,
    CHECK((status = 'completed') = (exitedAt IS NOT NULL))
  );
  CREATE UNIQUE INDEX active_queue_patient ON PatientQueues(patientId) WHERE exitedAt IS NULL;
  CREATE INDEX queue_priority ON PatientQueues(status, priority, enteredTick);
  CREATE TABLE PatientAssignments (
    id INTEGER PRIMARY KEY,
    patientId TEXT NOT NULL REFERENCES Patients(id),
    bayId INTEGER REFERENCES TreatmentBays(id),
    staffId TEXT REFERENCES Staff(id),
    assignedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    releasedAt TEXT,
    CHECK((bayId IS NULL) != (staffId IS NULL))
  );
  CREATE UNIQUE INDEX active_bay ON PatientAssignments(bayId) WHERE releasedAt IS NULL AND bayId IS NOT NULL;
  CREATE UNIQUE INDEX active_patient_bay ON PatientAssignments(patientId) WHERE releasedAt IS NULL AND bayId IS NOT NULL;
  CREATE UNIQUE INDEX active_staff ON PatientAssignments(staffId) WHERE releasedAt IS NULL AND staffId IS NOT NULL;
  CREATE INDEX assignments_patient ON PatientAssignments(patientId, releasedAt);
  CREATE TABLE EventLogs (
    id TEXT PRIMARY KEY NOT NULL,
    patientId TEXT REFERENCES Patients(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('info','success','warn','critical')),
    ts INTEGER NOT NULL CHECK(ts >= 0),
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX events_recent ON EventLogs(ts DESC);
  CREATE INDEX events_patient ON EventLogs(patientId, ts DESC);
  CREATE TABLE Notifications (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    isRead INTEGER NOT NULL DEFAULT 0 CHECK(isRead IN (0,1)),
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE SimulationState (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    tick INTEGER NOT NULL DEFAULT 0 CHECK(tick >= 0),
    seeded INTEGER NOT NULL DEFAULT 0 CHECK(seeded IN (0,1))
  );
  INSERT INTO SimulationState(id) VALUES (1);
  INSERT INTO TreatmentBays(id, name) VALUES
    (1,'Bay 1'),(2,'Bay 2'),(3,'Bay 3'),(4,'Bay 4'),
    (5,'Bay 5'),(6,'Bay 6'),(7,'Bay 7'),(8,'Bay 8');
  INSERT INTO Staff(id, name, role) VALUES
    ('s1','Dr. Chen','Doctor'),('s2','Dr. Alvarez','Doctor'),
    ('s3','R. Patel RN','Nurse'),('s4','J. Kim RN','Nurse'),
    ('s5','M. Okafor RN','Nurse'),('s6','S. Rivera RN','Triage');
  `,
];

export async function initializeDatabase(db: Connection) {
  await db.execAsync("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if ((await db.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys"))?.foreign_keys !== 1) {
    throw new Error("SQLite foreign key enforcement is unavailable");
  }
  await transaction(db, async () => {
    const version = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
    if (version > migrations.length) throw new Error("This database requires a newer TriFlow version");
    for (let index = version; index < migrations.length; index++) {
      await db.execAsync(migrations[index]);
      await db.execAsync(`PRAGMA user_version = ${index + 1}`);
    }
  });
}
