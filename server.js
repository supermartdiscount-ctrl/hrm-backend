const express = require('express');
const cors = require('cors');
require('./db'); // connects to the database and logs the result
const accountRoutes = require('./components/Account');
const employeeRoutes = require('./components/Employee');
const cashAdvanceRoutes = require('./components/CashAdvance');
const payslipRoutes = require('./components/Payslip');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' })); // needed to read JSON bodies from POST requests

app.get('/', (req, res) => {
    return res.json("From Backend Side");
});

app.use(accountRoutes);
app.use(employeeRoutes);
app.use('/api/cash-advance', cashAdvanceRoutes);
app.use('/api/payslips', payslipRoutes);

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log("listening on port " + PORT);
});