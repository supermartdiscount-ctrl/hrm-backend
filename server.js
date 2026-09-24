const express = require('express');
const cors = require('cors');
require('./db'); // connects to the database and logs the result
const accountRoutes = require('./components/Account');
const employeeRoutes = require('./components/Employee');

const app = express();
app.use(cors());
app.use(express.json()); // needed to read JSON bodies from POST requests

app.get('/', (req, res) => {
    return res.json("From Backend Side");
});

app.use(accountRoutes);
app.use(employeeRoutes);

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log("listening on port " + PORT);
});