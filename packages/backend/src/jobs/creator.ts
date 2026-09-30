import type { PgBoss } from "pg-boss";
import { analyzeOpportunity } from "../creator/opportunity.ts";
import { ensureQueue, QUEUES } from "./queue.ts";

export async function registerCreatorJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.creatorOpportunity);
  await boss.work<{ storyId: number; trigger: "auto" | "manual"; attemptTag?: string }>(QUEUES.creatorOpportunity, { localConcurrency: 2, pollingIntervalSeconds: 5 }, async ([job]) => {
    if (!job) return;
    return analyzeOpportunity(job.data.storyId, { trigger: job.data.trigger, attemptTag: job.data.attemptTag });
  });
}
