declare module 'connect-pg-simple' {
  import { Store } from 'express-session';
  import { Pool } from 'pg';

  interface PGStoreOptions {
    pool: Pool;
    tableName?: string;
    schemaName?: string;
    ttl?: number;
    createTableIfMissing?: boolean;
    pruneSessionInterval?: number;
    errorLog?: (error: Error) => void;
  }

  function PGStore(session: { Store: typeof Store }): {
    new(options: PGStoreOptions): Store;
  };

  export = PGStore;
}
