/* CLI entry: `npx tsx scripts/seed.ts` */
import "dotenv/config";
import { seedDatabase } from "../src/db/seed";

seedDatabase()
  .then(() => {
    console.log("✔ Database seeded with demo data");
    process.exit(0);
  })
  .catch((err) => {
    console.error("✖ Seed failed:", err);
    process.exit(1);
  });
