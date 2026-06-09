import type { Config } from 'drizzle-kit';
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/xidr_corridor',
  },
} satisfies Config;
