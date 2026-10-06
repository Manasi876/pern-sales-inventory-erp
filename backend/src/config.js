require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  port: process.env.PORT || 5000,
  databaseUrl: isTest
    ? process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/erp_db_test'
    : process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'test-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  isTest,
};
