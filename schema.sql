-- Run this against the `defaulthrm` database on DigitalOcean.
-- Every table has a PRIMARY KEY (required by DigitalOcean Managed MySQL).

CREATE TABLE IF NOT EXISTS accounts (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    password    VARCHAR(255) NOT NULL,          -- bcrypt hash (60 chars), never plain text
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_accounts_email (email)        -- needed so ER_DUP_ENTRY fires on duplicate email
);

CREATE TABLE IF NOT EXISTS employees (
    id          VARCHAR(50) PRIMARY KEY,        -- employee ID is sent by the frontend (e.g. EMP-001)
    name        VARCHAR(255) NOT NULL,
    dept        VARCHAR(100) NULL,
    `position`  VARCHAR(100) NULL,
    hired       DATE NULL,
    status      VARCHAR(50) NULL,
    rate        DECIMAL(12,2) NOT NULL DEFAULT 0,
    salaryType  VARCHAR(20) NOT NULL DEFAULT 'cutoff',
    payday      VARCHAR(10) NOT NULL DEFAULT '2',
    birth       DATE NULL,
    civil       VARCHAR(50) NULL,
    contact     VARCHAR(50) NULL,
    address     VARCHAR(500) NULL,
    sss         VARCHAR(50) NULL,
    philhealth  VARCHAR(50) NULL,
    pagibig     VARCHAR(50) NULL,
    tin         VARCHAR(50) NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);