-- =====================================================================
-- FULL SCHEMA for the `defaulthrm` database
-- Includes all cash advance / credit / payslip changes.
--
-- Safe for a NEW database AND for your EXISTING database.
-- CREATE TABLE IF NOT EXISTS skips tables that already exist, so the
-- section at the very bottom adds any missing columns / keys to old
-- tables. Each of those steps checks first, so running this many times
-- is fine.
--
-- Every table has a PRIMARY KEY (required by DigitalOcean Managed MySQL).
-- No semicolons inside comments (the runner splits statements on them).
-- =====================================================================

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

-- Cash advance requests. repayment_months is no longer used (HR types the
-- deduction on each payroll), the column stays with default 1.
CREATE TABLE IF NOT EXISTS cash_advance_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  employee_id      VARCHAR(50)  NOT NULL,
  employee_name    VARCHAR(150) NOT NULL,
  department       VARCHAR(100) NULL,
  amount           DECIMAL(10,2) NOT NULL,
  reason           VARCHAR(500) NULL,
  repayment_months TINYINT NOT NULL DEFAULT 1,
  status           ENUM('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  admin_remarks    VARCHAR(500) NULL,
  date_requested   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at      TIMESTAMP NULL,
  INDEX idx_employee (employee_id),
  INDEX idx_status (status)
);

-- Claimed payslips (one per employee per pay period)
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
  credit           DECIMAL(12,2) NOT NULL DEFAULT 0,   -- credit deduction
  total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_pay          DECIMAL(12,2) NOT NULL DEFAULT 0,
  details          JSON NULL,
  claimed_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_period (employee_id, period_id),
  INDEX idx_period (period_id)
);

-- One row per cash advance deduction taken in a claimed payslip.
-- Balance = request amount - SUM(amount) of these rows.
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

-- Leave and undertime requests (one table, request_type tells them apart)
-- Leave uses leave_type / start_date / end_date / days.
-- Undertime uses start_date (the day) / time_from / time_to / hours.
CREATE TABLE IF NOT EXISTS leave_undertime_requests (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id     VARCHAR(50)  NOT NULL,
  employee_name   VARCHAR(255) NOT NULL,
  department      VARCHAR(100) NULL,
  request_type    ENUM('Leave','Undertime') NOT NULL,
  leave_type      VARCHAR(50)  NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NULL,
  days            DECIMAL(5,1) NULL,
  time_from       TIME NULL,
  time_to         TIME NULL,
  hours           DECIMAL(5,2) NULL,
  reason          VARCHAR(500) NULL,
  status          ENUM('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  admin_remarks   VARCHAR(500) NULL,
  date_requested  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at     TIMESTAMP NULL,
  INDEX idx_lu_employee (employee_id),
  INDEX idx_lu_status (status),
  INDEX idx_lu_type_start (request_type, start_date)
);

-- Employee store credit (category is Grocery, Produce or Meat).
-- repayment_months is no longer used, the column stays with default 1.
CREATE TABLE IF NOT EXISTS credit_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  employee_id      VARCHAR(50)  NOT NULL,
  employee_name    VARCHAR(255) NOT NULL,
  department       VARCHAR(100) NULL,
  category         ENUM('Grocery','Produce','Meat') NOT NULL,
  description      VARCHAR(255) NULL,
  amount           DECIMAL(10,2) NOT NULL,
  repayment_months TINYINT NOT NULL DEFAULT 1,
  status           ENUM('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  admin_remarks    VARCHAR(500) NULL,
  date_requested   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at      TIMESTAMP NULL,
  INDEX idx_cr_employee (employee_id),
  INDEX idx_cr_status (status),
  INDEX idx_cr_category (category)
);

-- Credit payments: from payroll (period_id + payslip_id set) or manual
-- payments such as cash (period_id NULL). Balance = credit amount - SUM(amount).
CREATE TABLE IF NOT EXISTS credit_payments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  credit_id   INT NOT NULL,
  period_id   VARCHAR(30) NULL,
  payslip_id  INT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  note        VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_credit_period (credit_id, period_id),  -- many NULL periods are allowed
  INDEX idx_crp_credit (credit_id),
  INDEX idx_crp_payslip (payslip_id),
  CONSTRAINT fk_crp_credit FOREIGN KEY (credit_id)
    REFERENCES credit_requests(id) ON DELETE RESTRICT
);

-- =====================================================================
-- UPGRADE EXISTING TABLES (adds only what is missing)
-- =====================================================================

-- credit_payments: link each payment to a payroll period and payslip
SET @s = (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_payments' AND COLUMN_NAME = 'period_id'),
  'SELECT 1',
  'ALTER TABLE credit_payments ADD COLUMN period_id VARCHAR(30) NULL AFTER credit_id'));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_payments' AND COLUMN_NAME = 'payslip_id'),
  'SELECT 1',
  'ALTER TABLE credit_payments ADD COLUMN payslip_id INT NULL AFTER period_id'));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_payments' AND COLUMN_NAME = 'note'),
  'SELECT 1',
  'ALTER TABLE credit_payments ADD COLUMN note VARCHAR(255) NULL AFTER amount'));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_payments' AND INDEX_NAME = 'uq_credit_period'),
  'SELECT 1',
  'ALTER TABLE credit_payments ADD UNIQUE KEY uq_credit_period (credit_id, period_id)'));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_payments' AND INDEX_NAME = 'idx_crp_payslip'),
  'SELECT 1',
  'ALTER TABLE credit_payments ADD INDEX idx_crp_payslip (payslip_id)'));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- payslips: credit deduction column
SET @s = (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payslips' AND COLUMN_NAME = 'credit'),
  'SELECT 1',
  'ALTER TABLE payslips ADD COLUMN credit DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cash_advance'));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;