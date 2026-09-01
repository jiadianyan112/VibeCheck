import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
const appUser = process.env.APP_DB_USER;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_REQUIRED");
}

if (!appUser) {
  throw new Error("APP_DB_USER_REQUIRED");
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const schemas = [
  "iam",
  "catalog",
  "workflow",
  "media",
  "private_material",
  "community",
  "comparison",
  "search",
  "taxonomy",
  "analytics",
  "ops",
  "audit",
];

const client = new Client({
  connectionString: databaseUrl,
});

await client.connect();

try {
  await client.query("SET statement_timeout = '30s'");
  await client.query("SET lock_timeout = '10s'");

  const user = quoteIdentifier(appUser);

  for (const schema of schemas) {
    const s = quoteIdentifier(schema);

    console.log(`granting ${schema}`);

    await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${user}`);

    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE
       ON ALL TABLES IN SCHEMA ${s}
       TO ${user}`,
    );

    await client.query(
      `GRANT USAGE, SELECT, UPDATE
       ON ALL SEQUENCES IN SCHEMA ${s}
       TO ${user}`,
    );

    await client.query(
      `GRANT EXECUTE
       ON ALL FUNCTIONS IN SCHEMA ${s}
       TO ${user}`,
    );

    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s}
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${user}`,
    );

    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s}
       GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${user}`,
    );

    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s}
       GRANT EXECUTE ON FUNCTIONS TO ${user}`,
    );
  }

  console.log("runtime_grants_ok");
} finally {
  await client.end();
}
