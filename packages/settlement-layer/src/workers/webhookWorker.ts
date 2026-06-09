import { Queue, Worker, type Job } from "bullmq";
import { getRedis } from "../lib/redis.js";
import { env } from "../lib/env.js";

export const WEBHOOK_QUEUE = "settlement:webhooks";

export interface WebhookJobData {
  event_type: "settlement.confirmed" | "settlement.failed";
  settlement_id: string;
  rail_id: string;
  status: string;
  timestamp: string;
  callback_url: string;
}

let queue: Queue | null = null;

export function getWebhookQueue(): Queue {
  if (!queue) {
    queue = new Queue(WEBHOOK_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    });
  }
  return queue;
}

export function enqueueWebhook(data: Omit<WebhookJobData, "callback_url">): Promise<void> {
  const callback_url = env.CALLBACK_URL;
  if (!callback_url) return Promise.resolve();
  return getWebhookQueue()
    .add("dispatch", { ...data, callback_url })
    .then(() => undefined);
}

// ─── Worker (started in-process alongside Fastify) ───────────────────────────

async function processJob(job: Job<WebhookJobData>) {
  const { callback_url, ...payload } = job.data;
  const res = await fetch(callback_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook delivery failed: HTTP ${res.status}`);
  console.info(`[webhook] delivered ${payload.event_type} for ${payload.settlement_id}`);
}

let worker: Worker | null = null;

export function startWebhookWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(WEBHOOK_QUEUE, processJob, { connection: getRedis() });
  worker.on("failed", (job, err) =>
    console.error(`[webhook] job ${job?.id} failed:`, err.message),
  );
  return worker;
}
