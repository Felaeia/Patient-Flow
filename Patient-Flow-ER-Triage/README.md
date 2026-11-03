# Starter Template with React Navigation

This is a minimal starter template for React Native apps using Expo and React Navigation.

It includes the following:

- Example [Native Stack](https://reactnavigation.org/docs/native-stack-navigator) with a nested [Bottom Tab](https://reactnavigation.org/docs/bottom-tab-navigator)
- Web support with [React Native for Web](https://necolas.github.io/react-native-web/)
- TypeScript support and configured for React Navigation
- Automatic [deep link](https://reactnavigation.org/docs/deep-linking) and [URL handling configuration](https://reactnavigation.org/docs/configuring-links)
- Theme support [based on system appearance](https://reactnavigation.org/docs/themes/#using-the-operating-system-preferences)
- Expo [Development Build](https://docs.expo.dev/develop/development-builds/introduction/) with [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)

## Getting Started

1. Create a new project using this template:

   ```sh
   npx create-expo-app@latest --template react-navigation/template
   ```

2. Edit the `app.json` file to configure the `name`, `slug`, `scheme` and bundle identifiers (`ios.bundleIdentifier` and `android.bundleIdentifier`) for your app.

3. Edit the `src/App.tsx` file to start working on your app.

## Running the app

- Install the dependencies:

  ```sh
  npm install
  ```

- Start the development server:

  ```sh
  npm start
  ```

- Build and run iOS and Android development builds:

  ```sh
  npm run ios
  # or
  npm run android
  ```

- In the terminal running the development server, press `i` to open the iOS simulator, `a` to open the Android device or emulator, or `w` to open the web browser.

## Notes

This project uses a [development build](https://docs.expo.dev/develop/development-builds/introduction/) and cannot be run with [Expo Go](https://expo.dev/go). To run the app with Expo Go, edit the `package.json` file, remove the `expo-dev-client` package and `--dev-client` flag from the `start` script.

We highly recommend using the development builds for normal development and testing.

The `ios` and `android` folder are gitignored in the project by default as they are automatically generated during the build process ([Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)). This means that you should not edit these folders directly and use [config plugins](https://docs.expo.dev/config-plugins/) instead. However, if you need to edit these folders, you can remove them from the `.gitignore` file so that they are tracked by git.

## Resources

- [React Navigation documentation](https://reactnavigation.org/)
- [Expo documentation](https://docs.expo.dev/)

---

Demo assets are from [lucide.dev](https://lucide.dev/)

## TriFlow local database

TriFlow opens `triflow.db` through [Expo SQLite](https://docs.expo.dev/versions/v56.0.0/sdk/sqlite/) on startup. On Android and iOS it lives in Expo SQLite's default directory in the app sandbox. The web build uses SQLite WASM and the browser's origin-private file system. Browser data is scoped to the browser profile and origin, including the port. Use localhost or HTTPS. For deployed web builds, configure the host to send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. Web support in Expo SQLite is alpha. Use one TriFlow tab per origin. Rebuild an existing native development client after installing the SQLite module.

- `src/database/schema.ts` enables and verifies foreign keys on open, then applies migrations in order under a transaction. `PRAGMA user_version` records the last completed migration. Add a new migration when changing the schema.
- `Patients` holds demographics, symptoms, vitals, and current status. `TriageAssessments` stores ESI history, and `PatientQueues` tracks triage and waiting. `TreatmentBays` and `Staff` track availability. `PatientAssignments` stores one active bay per patient and separate rows for each staff member. Partial unique indexes prevent two active allocations of the same bay or staff member.
- `EventLogs` stores patient-linked or general activity. `Notifications` stores messages and read status through the repository. `SimulationState` stores the simulated clock and the one-time seed marker.
- `src/database/repositories.ts` provides typed, bound queries. `src/simulation/patientFlow.ts` composes registration, triage, assignment, and disposition in serialized SQLite transactions. The provider publishes snapshots after commit. Dashboard totals include all registered patients, including discharged and admitted patients. Average wait is the mean elapsed simulated seconds for patients currently waiting. The event log shows the latest 50 entries in descending simulation order.
- Database audit dates use SQLite `CURRENT_TIMESTAMP`, formatted as UTC `YYYY-MM-DD HH:MM:SS`. Simulation tick fields are elapsed seconds and resume from the last commit after restart.

### Demo data and verification

A fresh database initializes the simulator's eight bays and six fictional staff records. Patient arrivals continue through the simulation. To prepopulate 20 synthetic patients, ESI assessments, queues, events, and a demo notification, set `EXPO_PUBLIC_TRIFLOW_SEED=1` before starting a development build or `npm run web`. The seed runs once per database and preserves existing records. For a clean local development database, clear that browser origin's site data or clear the development app's storage. This removes all local records for that instance.

Run `npm run test:database` with Node.js 24 or later. The suite uses a temporary SQLite file and exercises the production schema, repositories, and workflows. It covers migrations, foreign keys, invalid ESI, patient CRUD, duplicate bay allocation, assignment rollback, notifications, idempotent seeding, and close/reopen persistence. Browser smoke checks covered startup, all five routes, triage, dashboard updates, and persistence after refresh and a full browser restart.

## Admin management

The sidebar exposes Patient, Treatment Bay, Staff, and Resource Management to authorized roles. The local development identity defaults to `admin`. Set `EXPO_PUBLIC_TRIFLOW_ROLE` to `registration`, `clinical`, or `viewer` to exercise the route and service authorization rules. This environment-based identity is a development adapter and must be replaced by authenticated server-issued identity before production use.

Migration 2 preserves existing simulator records, creates permanent `PatientRecords` and visit-specific `EREncounters`, and adds `Resources`, `ResourceTransactions`, and `AuditLogs`. Administrative writes are parameterized and execute through permission-checked services. Patient registration creates the identity, ER encounter, intake queue entry, operational event, and audit entry in one transaction. It deliberately creates no ESI assessment.

The SQLite design is suitable for a single device or a single local operator. Browser SQLite is stored separately in each browser profile and cannot provide a shared hospital database. A multi-workstation deployment should move these repositories behind an authenticated server API backed by PostgreSQL or another managed relational database. The admin UI and permission model can remain, while direct local database access should be removed from the browser build.
