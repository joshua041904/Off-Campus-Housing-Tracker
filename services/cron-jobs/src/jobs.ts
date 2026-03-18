import cron from "node-cron"
import { Pool } from "pg"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const pool = new Pool({ connectionString: process.env.POSTGRES_URL })
function s3() {
  const endpoint = process.env.S3_ENDPOINT || undefined
  const region = process.env.S3_REGION || 'auto'
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true'
  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' }
  })
}

async function snapshotTrends() {
  const client = await pool.connect()
  try {
    const snapDate = new Date().toISOString().slice(0,10)
    const { rows } = await client.query(`
      WITH recent AS (
        SELECT
          lower(regexp_replace(title, '\\s+\\(.*\\)$', '')) AS base_title,
          price::numeric AS price
        FROM listings.auctions
        WHERE fetched_at >= now() - interval '30 days' AND price IS NOT NULL
      ),
      split AS (
        SELECT
          split_part(base_title, ' - ', 1) AS artist,
          split_part(base_title, ' - ', 2) AS name,
          price
        FROM recent
      ),
      agg AS (
        SELECT artist, name,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
               count(*) AS sample_count
        FROM split
        WHERE artist <> '' AND name <> ''
        GROUP BY artist, name
        HAVING count(*) >= 5
        ORDER BY sample_count DESC
        LIMIT 200
      )
      INSERT INTO analytics.price_snapshots(snap_date, artist, name, median_price, sample_count)
      SELECT $1::date, artist, name, round(median_price::numeric, 2), sample_count FROM agg
      RETURNING count(*)
    `,[snapDate])
    console.log(`snapshots: inserted ${rows.length} rows`)
  } catch (e) {
    console.error("snapshot error", e)
  } finally { client.release() }
}

async function backupToS3() {
  const bucket = process.env.S3_BUCKET
  if (!bucket) return
  const client = await pool.connect()
  try {
    const { rows } = await client.query(`
      SELECT to_char(now(),'YYYYMMDD') as ymd,
             json_agg(json_build_object('title',title,'price',price,'currency',currency,'fetched_at',fetched_at) ORDER BY fetched_at DESC) AS payload
      FROM listings.auctions
      WHERE fetched_at >= now() - interval '1 day'
    `)
    const ymd = rows[0]?.ymd || 'unknown'
    const body = JSON.stringify(rows[0]?.payload ?? [])
    const key = `backups/auctions-${ymd}.json`
    await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/json' }))
    console.log(`backup uploaded s3://${bucket}/${key}`)
  } catch (e) {
    console.error("backup error", e)
  } finally { client.release() }
}

console.log("cron-jobs up")
cron.schedule("15 3 * * *", () => snapshotTrends().catch(console.error), { timezone: "UTC" })
cron.schedule("30 3 * * *", () => backupToS3().catch(console.error), { timezone: "UTC" })
