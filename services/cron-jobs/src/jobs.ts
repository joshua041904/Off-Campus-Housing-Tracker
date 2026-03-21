import cron from "node-cron"

/**
 * Housing cron worker: periodic POST to notification-service internal heartbeat.
 * Set NOTIFICATION_HEARTBEAT_URL (in-cluster recommended), e.g.
 * http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015/internal/cron/heartbeat
 */
async function notificationHeartbeat() {
  const url = (process.env.NOTIFICATION_HEARTBEAT_URL || "").trim()
  if (!url) return
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    console.log(`notification heartbeat: ${r.status} ${url}`)
  } catch (e) {
    console.error("notification heartbeat error", e)
  }
}

console.log("cron-jobs (housing): notification heartbeat worker")
if (!(process.env.NOTIFICATION_HEARTBEAT_URL || "").trim()) {
  console.log("NOTIFICATION_HEARTBEAT_URL unset — heartbeat cron no-ops until URL is set")
}

cron.schedule("*/5 * * * *", () => notificationHeartbeat().catch(console.error), { timezone: "UTC" })
