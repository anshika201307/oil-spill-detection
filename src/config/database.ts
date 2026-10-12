import 'dotenv/config';
import { Pool } from 'pg';

const port = Number(process.env.DB_PORT || 5432);

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port,
  database: process.env.DB_NAME || 'oiltrace',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log unexpected connection errors.
pool.on('error', (error) => {
  console.error('[Database] Unexpected PostgreSQL error:', error.message);
});

// Check the database connection.
export async function checkDatabaseConnection(): Promise<{
  connected: boolean;
  database?: string;
  error?: string;
}> {
  try {
    const result = await pool.query<{
      current_database: string;
    }>('SELECT current_database()');

    return {
      connected: true,
      database: result.rows[0]?.current_database,
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error
        ? error.message
        : 'Unknown database error',
    };
  }
}