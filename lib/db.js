require('dotenv').config();
const { Pool } = require('pg');

// One pool for the process. node-pg connects lazily on the first query and
// reuses sockets after that, so there is no explicit connect() step.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
