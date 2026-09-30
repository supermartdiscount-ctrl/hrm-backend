-- Run this against the `defaulthrm` database on DigitalOcean.
-- Every table has a PRIMARY KEY (required by DigitalOcean Managed MySQL).

CREATE TABLE IF NOT EXISTS accounts (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    password    VARCHAR(255) NOT NULL,          -- bcrypt hash (60 chars), never plain text
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_accounts_email (email)
);

CREATE TABLE IF NOT EXISTS employees (
    id            VARCHAR(50) PRIMARY KEY,      -- e.g. EMP-001
    name          VARCHAR(255) NOT NULL,
    dept          VARCHAR(100) NULL,
    `position`    VARCHAR(100) NULL,
    hired         DATE NULL,
    status        VARCHAR(50) NULL,
    rate          DECIMAL(12,2) NOT NULL DEFAULT 0,
    salaryType    VARCHAR(20) NOT NULL DEFAULT 'cutoff',
    payday        VARCHAR(10) NOT NULL DEFAULT '2',
    birth         DATE NULL,
    civil         VARCHAR(50) NULL,
    contact       VARCHAR(50) NULL,
    address       VARCHAR(500) NULL,
    sss           VARCHAR(50) NULL,
    philhealth    VARCHAR(50) NULL,
    pagibig       VARCHAR(50) NULL,
    tin           VARCHAR(50) NULL,
    password_hash VARCHAR(255) NULL,            -- bcrypt hash for the employee app login
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_advance_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  employee_name VARCHAR(150) NOT NULL,
  department VARCHAR(100) NULL,
  amount DECIMAL(10,2) NOT NULL,
  reason VARCHAR(500) NULL,
  repayment_months TINYINT NOT NULL DEFAULT 1,
  status ENUM('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  admin_remarks VARCHAR(500) NULL,
  date_requested TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  INDEX idx_employee (employee_id),
  INDEX idx_status (status)
);

-- NEW: claimed payslips (one per employee per pay period)
CREATE TABLE IF NOT EXISTS payslips (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  employee_id      VARCHAR(50)  NOT NULL,
  employee_name    VARCHAR(255) NOT NULL,
  department       VARCHAR(100) NULL,
  period_id        VARCHAR(30)  NOT NULL,
  period_label     VARCHAR(100) NOT NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  salary_type      VARCHAR(20)  NOT NULL,
  days_present     DECIMAL(6,2)  NOT NULL DEFAULT 0,
  basic_pay        DECIMAL(12,2) NOT NULL DEFAULT 0,
  premium_pay      DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime_pay     DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowance        DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross_pay        DECIMAL(12,2) NOT NULL DEFAULT 0,
  sss              DECIMAL(12,2) NOT NULL DEFAULT 0,
  philhealth       DECIMAL(12,2) NOT NULL DEFAULT 0,
  pagibig          DECIMAL(12,2) NOT NULL DEFAULT 0,
  withholding_tax  DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_advance     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_pay          DECIMAL(12,2) NOT NULL DEFAULT 0,
  details          JSON NULL,
  claimed_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_period (employee_id, period_id),
  INDEX idx_period (period_id)
);


CREATE TABLE IF NOT EXISTS cash_advance_payments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  advance_id  INT NOT NULL,
  period_id   VARCHAR(30) NOT NULL,
  payslip_id  INT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_advance_period (advance_id, period_id),
  INDEX idx_payslip (payslip_id),
  CONSTRAINT fk_cap_advance FOREIGN KEY (advance_id)
    REFERENCES cash_advance_requests(id) ON DELETE RESTRICT
);