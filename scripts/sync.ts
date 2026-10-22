import { metaGet } from "../src/lib/db";
import { ensureSchedule } from "../src/lib/sync";

async function main(): Promise<void> {
  const result = await ensureSchedule(true);
  console.log(result);
  console.log(metaGet("last_report"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
