require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        ca: fs.readFileSync(path.join(__dirname, 'certificate', 'ca-certificate.crt'))
    },
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true, // return DATE columns as 'YYYY-MM-DD' strings (avoids timezone shifts)
});

// Test the connection on startup
pool.getConnection((err, connection) => {
    if (err) {
        console.error("Error connecting to MySQL:", err.code, err.message);
        return;
    }
    console.log("Connected to MySQL (DigitalOcean) as id " + connection.threadId);
    connection.release();
});

// Create tables on startup if they don't exist yet
async function initSchema() {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
        await pool.promise().query(stmt);
    }
    console.log("Database tables are ready.");
}

initSchema().catch(err => console.error("Schema init failed:", err.code, err.message));

module.exports = pool;