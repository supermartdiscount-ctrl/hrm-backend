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
});

// Test the connection on startup
pool.getConnection((err, connection) => {
    if (err) {
        console.error("Error connecting to MySQL:", err.message);
        return;
    }
    console.log("Connected to MySQL (DigitalOcean) as id " + connection.threadId);
    connection.release();
});

module.exports = pool;