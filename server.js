const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const app = express();

app.use(express.json());

const database = new DatabaseSync(path.join(__dirname, "autofix.db"));
const dbPromise = Promise.resolve({
  exec: (sql) => database.exec(sql),
  get: (sql, params = []) =>
    database.prepare(sql).get(...(Array.isArray(params) ? params : [params])),
  all: (sql, params = []) =>
    database.prepare(sql).all(...(Array.isArray(params) ? params : [params])),
  run: (sql, params = []) => {
    const result = database
      .prepare(sql)
      .run(...(Array.isArray(params) ? params : [params]));
    return { lastID: result.lastInsertRowid, changes: result.changes };
  },
});

async function createTables() {
  const db = await dbPromise;

  await db.exec("PRAGMA foreign_keys = ON");

  await db.exec(`
        CREATE TABLE IF NOT EXISTS mechanics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            specialty TEXT
        );

        CREATE TABLE IF NOT EXISTS bays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            vehicle TEXT NOT NULL,
            deleted INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mechanic_id INTEGER NOT NULL,
            bay_id INTEGER NOT NULL,
            job TEXT NOT NULL,
            start_time TEXT NOT NULL,
            FOREIGN KEY (mechanic_id) REFERENCES mechanics(id),
            FOREIGN KEY (bay_id) REFERENCES bays(id)
        );
    `);

  const bays = await db.get("SELECT COUNT(*) AS count FROM bays");

  if (bays.count === 0) {
    await db.run(`
            INSERT INTO mechanics (name, specialty)
            VALUES
            ('Ravi Kumar', 'Engine'),
            ('Anita Rao', 'Brakes'),
            ('Imran Khan', 'Electrical'),
            ('Sneha Reddy', 'AC & Cooling')
        `);

    await db.run(`
            INSERT INTO bays (name, vehicle)
            VALUES
            ('Bay 1', 'Maruti Swift'),
            ('Bay 2', 'Hyundai Creta'),
            ('Bay 3', 'Honda City'),
            ('Bay 4', 'Tata Nexon'),
            ('Bay 5', 'Toyota Innova'),
            ('Bay 6', 'Mahindra Thar')
        `);

    await db.run(`
            INSERT INTO assignments
            (mechanic_id, bay_id, job, start_time)
            VALUES
            (1, 1, 'Engine oil change', '2026-11-12 09:00'),
            (2, 2, 'Brake pad replacement', '2026-11-12 10:30'),
            (3, 6, 'Battery check', '2026-11-12 11:00')
        `);
  }
}

app.get("/", (req, res) => {
  res.send("AutoFix Garage API is running");
});

// VALIDATION MIDDLEWARE

function validateId(req, res, next) {
  const id = req.params.id;

  if (!/^\d+$/.test(id) || Number(id) < 1) {
    return res.status(400).json({
      error: "id must be a positive whole number",
    });
  }

  next();
}

function validateBay(req, res, next) {
  const { name, vehicle } = req.body;

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({
      error: "name is required and must be a non-empty text",
    });
  }

  if (name.trim().length > 50) {
    return res.status(400).json({
      error: "name must be 50 characters or less",
    });
  }

  if (typeof vehicle !== "string" || vehicle.trim() === "") {
    return res.status(400).json({
      error: "vehicle is required and must be a non-empty text",
    });
  }

  if (vehicle.trim().length > 100) {
    return res.status(400).json({
      error: "vehicle must be 100 characters or less",
    });
  }

  req.body.name = name.trim();
  req.body.vehicle = vehicle.trim();

  next();
}

// MECHANICS ROUTES

app.get("/mechanics", async (req, res) => {
  const db = await dbPromise;

  const mechanics = await db.all(`
        SELECT * FROM mechanics ORDER BY id
    `);

  res.status(200).json(mechanics);
});

app.get("/mechanics/:id", validateId, async (req, res) => {
  const db = await dbPromise;

  const mechanic = await db.get(
    `
        SELECT * FROM mechanics WHERE id = ?
    `,
    [req.params.id],
  );

  if (!mechanic) {
    return res.status(404).json({
      error: `Mechanic ${req.params.id} not found`,
    });
  }

  res.status(200).json(mechanic);
});

app.post("/mechanics", async (req, res) => {
  const db = await dbPromise;

  const { name, specialty } = req.body;

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({
      error: "name is required and must be a non-empty text",
    });
  }

  const result = await db.run(
    `
        INSERT INTO mechanics (name, specialty)
        VALUES (?, ?)
    `,
    [name.trim(), specialty || null],
  );

  res.status(201).json({
    id: result.lastID,
    name: name.trim(),
    specialty: specialty || null,
  });
});

// BAYS ROUTES

// Get all bays and search bays

app.get("/bays", async (req, res) => {
  const db = await dbPromise;

  const { name, vehicle } = req.query;

  let query = "SELECT id, name, vehicle FROM bays WHERE deleted = 0";

  if (name) {
    query += ` AND name LIKE '%${name}%'`;
  }

  if (vehicle) {
    query += ` AND vehicle LIKE '%${vehicle}%'`;
  }

  query += " ORDER BY id";

  const bays = await db.all(query);

  res.status(200).json(bays);
});

// Get bay by ID

app.get("/bays/:id", validateId, async (req, res) => {
  const db = await dbPromise;

  const bay = await db.get(
    `
        SELECT id, name, vehicle
        FROM bays
        WHERE id = ? AND deleted = 0
    `,
    [req.params.id],
  );

  if (!bay) {
    return res.status(404).json({
      error: `Bay ${req.params.id} not found`,
    });
  }

  res.status(200).json(bay);
});

// Add a new bay

app.post("/bays", validateBay, async (req, res) => {
  const db = await dbPromise;

  const { name, vehicle } = req.body;

  const result = await db.run(
    `
        INSERT INTO bays (name, vehicle)
        VALUES (?, ?)
    `,
    [name, vehicle],
  );

  res.status(201).json({
    id: result.lastID,
    name,
    vehicle,
  });
});

// Update bay

app.put("/bays/:id", validateId, validateBay, async (req, res) => {
  const db = await dbPromise;

  const { name, vehicle } = req.body;

  const result = await db.run(
    `
        UPDATE bays
        SET name = ?, vehicle = ?
        WHERE id = ? AND deleted = 0
    `,
    [name, vehicle, req.params.id],
  );

  if (result.changes === 0) {
    return res.status(404).json({
      error: `Bay ${req.params.id} not found`,
    });
  }

  res.status(200).json({
    id: Number(req.params.id),
    name,
    vehicle,
  });
});

// Delete bay (Soft delete)

app.delete("/bays/:id", validateId, async (req, res) => {
  const db = await dbPromise;

  const result = await db.run(
    `
        UPDATE bays
        SET deleted = 1
        WHERE id = ? AND deleted = 0
    `,
    [req.params.id],
  );

  if (result.changes === 0) {
    return res.status(404).json({
      error: `Bay ${req.params.id} not found`,
    });
  }

  res.status(200).json({
    message: `Bay ${req.params.id} deleted (hidden)`,
  });
});

// Restore deleted bay

app.post("/bays/:id/restore", validateId, async (req, res) => {
  const db = await dbPromise;

  const bay = await db.get(
    `
        SELECT deleted FROM bays WHERE id = ?
    `,
    [req.params.id],
  );

  if (!bay) {
    return res.status(404).json({
      error: `Bay ${req.params.id} not found`,
    });
  }

  if (bay.deleted === 0) {
    return res.status(400).json({
      error: `Bay ${req.params.id} is not deleted`,
    });
  }

  await db.run(
    `
        UPDATE bays SET deleted = 0 WHERE id = ?
    `,
    [req.params.id],
  );

  const restoredBay = await db.get(
    `
        SELECT id, name, vehicle FROM bays WHERE id = ?
    `,
    [req.params.id],
  );

  res.status(200).json({
    message: `Bay ${req.params.id} restored`,
    bay: restoredBay,
  });
});

// ASSIGNMENTS ROUTES

// Get assignments with mechanic and bay details

app.get("/assignments", async (req, res) => {
  const db = await dbPromise;

  const assignments = await db.all(`
        SELECT
            assignments.id,
            assignments.job,
            assignments.start_time,
            mechanics.name AS mechanic_name,
            bays.name AS bay_name
        FROM assignments
        JOIN mechanics
        ON mechanics.id = assignments.mechanic_id
        JOIN bays
        ON bays.id = assignments.bay_id
        WHERE bays.deleted = 0
        ORDER BY assignments.start_time
    `);

  res.status(200).json(assignments);
});

// Add assignment

app.post("/assignments", async (req, res) => {
  const db = await dbPromise;

  const { mechanic_id, bay_id, job, start_time } = req.body;

  if (!Number.isInteger(mechanic_id)) {
    return res.status(400).json({
      error: "mechanic_id is required and must be a whole number",
    });
  }

  if (!Number.isInteger(bay_id)) {
    return res.status(400).json({
      error: "bay_id is required and must be a whole number",
    });
  }

  if (typeof job !== "string" || job.trim() === "") {
    return res.status(400).json({
      error: "job is required",
    });
  }

  if (typeof start_time !== "string" || start_time.trim() === "") {
    return res.status(400).json({
      error: "start_time is required (e.g. 2026-11-16 09:00)",
    });
  }

  const mechanic = await db.get(
    `
        SELECT * FROM mechanics WHERE id = ?
    `,
    [mechanic_id],
  );

  if (!mechanic) {
    return res.status(404).json({
      error: `Mechanic ${mechanic_id} not found`,
    });
  }

  const bay = await db.get(
    `
        SELECT * FROM bays
        WHERE id = ? AND deleted = 0
    `,
    [bay_id],
  );

  if (!bay) {
    return res.status(404).json({
      error: `Bay ${bay_id} not found`,
    });
  }

  const existingAssignment = await db.get(
    `
        SELECT * FROM assignments
        WHERE bay_id = ? AND start_time = ?
    `,
    [bay_id, start_time.trim()],
  );

  if (existingAssignment) {
    return res.status(409).json({
      error: `Bay ${bay_id} is already booked at ${start_time}`,
    });
  }

  const result = await db.run(
    `
        INSERT INTO assignments
        (mechanic_id, bay_id, job, start_time)
        VALUES (?, ?, ?, ?)
    `,
    [mechanic_id, bay_id, job.trim(), start_time.trim()],
  );

  res.status(201).json({
    id: result.lastID,
    mechanic_id,
    bay_id,
    job: job.trim(),
    start_time: start_time.trim(),
  });
});

// ERROR HANDLING

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid JSON in request body",
    });
  }

  res.status(500).json({
    error: "Something went wrong",
  });
});

// Invalid route

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

const serverReady = createTables();

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  serverReady
    .then(() => {
      app.listen(port, () => {
        console.log(`AutoFix Garage API is running at http://localhost:${port}`);
      });
    })
    .catch((error) => {
      console.error("Failed to initialize the database:", error);
      process.exitCode = 1;
    });
}
