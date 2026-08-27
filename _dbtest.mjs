import pg from "pg";
const attempts = [
  { name: "pooler-txn-6543", host: "aws-0-us-east-1.pooler.supabase.com", port: 6543, user: "postgres.dngdrbdtmlofmekfxlcv" },
  { name: "pooler-session-5432", host: "aws-0-us-east-1.pooler.supabase.com", port: 5432, user: "postgres.dngdrbdtmlofmekfxlcv" },
  { name: "direct-5432", host: "db.dngdrbdtmlofmekfxlcv.supabase.co", port: 5432, user: "postgres" },
];
for (const a of attempts) {
  const c = new pg.Client({ host: a.host, port: a.port, database: "postgres", user: a.user, password: "Viboro22!!!", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    const r = await c.query("select current_user u, current_database() d");
    console.log(`[${a.name}] OK: user=${r.rows[0].u} db=${r.rows[0].d}`);
    await c.end();
    console.log("USE:", a.name);
    process.exit(0);
  } catch (e) { console.log(`[${a.name}] FAIL: ${e.message.slice(0, 80)}`); try { await c.end(); } catch {} }
}
process.exit(1);
