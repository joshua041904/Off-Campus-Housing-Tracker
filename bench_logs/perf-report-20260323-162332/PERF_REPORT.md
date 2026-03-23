# Full performance report (housing)

- **Timestamp:** 2026-03-23T20:23:32Z
- **Host:** vl965-172-31-175-60.wireless.umass.edu
- **Repo:** `/Users/tom/Off-Campus-Housing-Tracker`

## Contents
1. Postgres EXPLAIN (all service DBs)
2. k6 edge load (health + optional ramps)

# EXPLAIN ANALYZE — all housing databases

Generated: 2026-03-23T20:23:33Z
Host: `127.0.0.1` user: `postgres`

| Service | Port | Database | SQL file |
|---------|------|----------|----------|
| auth | 5441 | auth | explain-auth.sql |
| listings | 5442 | listings | explain-listings.sql |
| booking | 5443 | bookings | explain-bookings.sql |
| messaging | 5444 | messaging | explain-messaging.sql |
| notification | 5445 | notification | explain-notification.sql |
| trust | 5446 | trust | explain-trust.sql |
| analytics | 5447 | analytics | explain-analytics.sql |
| media | 5448 | media | explain-media.sql |


## auth (port 5441, database `auth`)

```
                                                            QUERY PLAN                                                             
-----------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.27..8.29 rows=1 width=53) (actual time=0.164..0.165 rows=0 loops=1)
   Output: id, email
   Buffers: shared hit=5
   ->  Index Scan using idx_users_email on auth.users  (cost=0.27..8.29 rows=1 width=53) (actual time=0.163..0.163 rows=0 loops=1)
         Output: id, email
         Index Cond: (users.email = '__explain_probe_nonexistent__@example.com'::citext)
         Buffers: shared hit=5
 Planning:
   Buffers: shared hit=110
 Planning Time: 4.567 ms
 Execution Time: 2.229 ms
(11 rows)

```

## listings (port 5442, database `listings`)

```
                                                                   QUERY PLAN                                                                   
------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=14.21..14.22 rows=1 width=175) (actual time=0.100..0.101 rows=0 loops=1)
   Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
   Buffers: shared hit=3
   ->  Sort  (cost=14.21..14.22 rows=1 width=175) (actual time=0.099..0.099 rows=0 loops=1)
         Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
         Sort Key: listings.created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=3
         ->  Seq Scan on listings.listings  (cost=0.00..14.21 rows=1 width=175) (actual time=0.006..0.006 rows=0 loops=1)
               Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, (status)::text, created_at
               Filter: ((listings.deleted_at IS NULL) AND ((listings.status)::text = 'active'::text))
 Planning:
   Buffers: shared hit=393
 Planning Time: 6.944 ms
 Execution Time: 0.195 ms
(15 rows)

                                                                                                  QUERY PLAN                                                                                                   
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=15.41..15.42 rows=1 width=175)
   Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
   ->  Sort  (cost=15.41..15.42 rows=1 width=175)
         Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
         Sort Key: listings.created_at DESC
         ->  Seq Scan on listings.listings  (cost=0.00..15.40 rows=1 width=175)
               Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, (status)::text, created_at
               Filter: ((listings.deleted_at IS NULL) AND ((listings.title ~~* '%explain-probe%'::text) OR (listings.description ~~* '%explain-probe%'::text)) AND ((listings.status)::text = 'active'::text))
 Planning:
   Buffers: shared hit=9
(10 rows)

```

## booking (port 5443, database `bookings`)

```
                                                       QUERY PLAN                                                        
-------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=1.71..1.77 rows=22 width=76) (actual time=0.146..0.150 rows=31 loops=1)
   Output: id, listing_id, tenant_id, landlord_id, status, created_at
   Buffers: shared hit=4
   ->  Sort  (cost=1.71..1.77 rows=22 width=76) (actual time=0.144..0.146 rows=31 loops=1)
         Output: id, listing_id, tenant_id, landlord_id, status, created_at
         Sort Key: bookings.created_at DESC
         Sort Method: quicksort  Memory: 29kB
         Buffers: shared hit=4
         ->  Seq Scan on booking.bookings  (cost=0.00..1.22 rows=22 width=76) (actual time=0.050..0.055 rows=31 loops=1)
               Output: id, listing_id, tenant_id, landlord_id, status, created_at
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=252
 Planning Time: 8.857 ms
 Execution Time: 0.279 ms
(15 rows)

```

## messaging (port 5444, database `messaging`)

```
                                                        QUERY PLAN                                                         
---------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=3.00..3.13 rows=50 width=78) (actual time=0.729..0.738 rows=50 loops=1)
   Output: id, conversation_id, sender_id, body, created_at
   Buffers: shared hit=4
   ->  Sort  (cost=3.00..3.13 rows=52 width=78) (actual time=0.728..0.731 rows=50 loops=1)
         Output: id, conversation_id, sender_id, body, created_at
         Sort Key: messages.created_at DESC
         Sort Method: quicksort  Memory: 32kB
         Buffers: shared hit=4
         ->  Seq Scan on messaging.messages  (cost=0.00..1.52 rows=52 width=78) (actual time=0.556..0.569 rows=60 loops=1)
               Output: id, conversation_id, sender_id, body, created_at
               Filter: (messages.deleted_at IS NULL)
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=121
 Planning Time: 3.430 ms
 Execution Time: 0.855 ms
(16 rows)

                                                                            QUERY PLAN                                                                            
------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=4.13..11.24 rows=3 width=40) (actual time=0.006..0.007 rows=0 loops=1)
   Output: conversation_id, user_id, joined_at
   Buffers: shared hit=2
   ->  Bitmap Heap Scan on messaging.conversation_participants  (cost=4.13..11.24 rows=3 width=40) (actual time=0.006..0.006 rows=0 loops=1)
         Output: conversation_id, user_id, joined_at
         Recheck Cond: ((conversation_participants.user_id = '00000000-0000-0000-0000-000000000001'::uuid) AND (NOT conversation_participants.deleted))
         Buffers: shared hit=2
         ->  Bitmap Index Scan on idx_conversation_participants_user_archived_deleted  (cost=0.00..4.13 rows=3 width=0) (actual time=0.003..0.004 rows=0 loops=1)
               Index Cond: (conversation_participants.user_id = '00000000-0000-0000-0000-000000000001'::uuid)
               Buffers: shared hit=2
 Planning:
   Buffers: shared hit=72
 Planning Time: 1.786 ms
 Execution Time: 0.159 ms
(14 rows)

```

## notification (port 5445, database `notification`)

```
                                                             QUERY PLAN                                                             
------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=32.91..33.03 rows=50 width=76) (actual time=0.056..0.057 rows=0 loops=1)
   Output: id, user_id, event_type, status, created_at
   Buffers: shared hit=3
   ->  Sort  (cost=32.91..34.23 rows=530 width=76) (actual time=0.055..0.055 rows=0 loops=1)
         Output: id, user_id, event_type, status, created_at
         Sort Key: notifications.created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=3
         ->  Seq Scan on notification.notifications  (cost=0.00..15.30 rows=530 width=76) (actual time=0.005..0.005 rows=0 loops=1)
               Output: id, user_id, event_type, status, created_at
 Planning:
   Buffers: shared hit=160
 Planning Time: 5.381 ms
 Execution Time: 0.138 ms
(14 rows)

```

## trust (port 5446, database `trust`)

```
                                                         QUERY PLAN                                                          
-----------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=29.02..29.14 rows=50 width=60) (actual time=0.134..0.135 rows=0 loops=1)
   Output: id, listing_id, reporter_id, status, created_at
   Buffers: shared hit=3
   ->  Sort  (cost=29.02..30.12 rows=440 width=60) (actual time=0.133..0.133 rows=0 loops=1)
         Output: id, listing_id, reporter_id, status, created_at
         Sort Key: listing_flags.created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=3
         ->  Seq Scan on trust.listing_flags  (cost=0.00..14.40 rows=440 width=60) (actual time=0.018..0.018 rows=0 loops=1)
               Output: id, listing_id, reporter_id, status, created_at
 Planning:
   Buffers: shared hit=151
 Planning Time: 7.801 ms
 Execution Time: 0.216 ms
(14 rows)

```

## analytics (port 5447, database `analytics`)

```
                                                                 QUERY PLAN                                                                  
---------------------------------------------------------------------------------------------------------------------------------------------
 Index Scan using daily_metrics_pkey on analytics.daily_metrics  (cost=0.15..8.17 rows=1 width=28) (actual time=0.024..0.025 rows=0 loops=1)
   Output: date, new_users, new_listings, new_bookings, completed_bookings, messages_sent, listings_flagged
   Index Cond: (daily_metrics.date = CURRENT_DATE)
   Buffers: shared hit=2
 Planning:
   Buffers: shared hit=77
 Planning Time: 4.158 ms
 Execution Time: 0.423 ms
(8 rows)

                                                     QUERY PLAN                                                     
--------------------------------------------------------------------------------------------------------------------
 HashAggregate  (cost=17.20..19.20 rows=200 width=40) (actual time=0.013..0.014 rows=0 loops=1)
   Output: event_type, count(*)
   Group Key: events.event_type
   Batches: 1  Memory Usage: 40kB
   ->  Seq Scan on analytics.events  (cost=0.00..14.80 rows=480 width=32) (actual time=0.004..0.004 rows=0 loops=1)
         Output: id, event_type, event_version, payload, source_service, created_at, event_id
 Planning:
   Buffers: shared hit=122
 Planning Time: 2.043 ms
 Execution Time: 0.233 ms
(10 rows)

```

## media (port 5448, database `media`)

```
                                                        QUERY PLAN                                                         
---------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=1.87..1.94 rows=26 width=131) (actual time=0.742..0.747 rows=30 loops=1)
   Output: id, user_id, object_key, status, created_at
   Buffers: shared hit=4
   ->  Sort  (cost=1.87..1.94 rows=26 width=131) (actual time=0.741..0.743 rows=30 loops=1)
         Output: id, user_id, object_key, status, created_at
         Sort Key: media_files.created_at DESC
         Sort Method: quicksort  Memory: 32kB
         Buffers: shared hit=4
         ->  Seq Scan on media.media_files  (cost=0.00..1.26 rows=26 width=131) (actual time=0.607..0.612 rows=30 loops=1)
               Output: id, user_id, object_key, status, created_at
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=124
 Planning Time: 8.807 ms
 Execution Time: 0.978 ms
(15 rows)

```

---
End of EXPLAIN section.


# k6 load / smoke (edge)

Generated: 2026-03-23T20:23:39Z
BASE_URL: `https://off-campus-housing.test`
DURATION: `45s` VUS: `6`

## k6: gateway-health

`k6-gateway-health.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-gateway-health.js
        output: -

     scenarios: (100.00%) 1 scenario, 6 max VUs, 1m15s max duration (incl. graceful stop):
              * default: 6 looping VUs for 45s (gracefulStop: 30s)


running (0m01.0s), 6/6 VUs, 21 complete and 0 interrupted iterations
default   [   2% ] 6 VUs  01.0s/45s

running (0m02.0s), 6/6 VUs, 46 complete and 0 interrupted iterations
default   [   4% ] 6 VUs  02.0s/45s

running (0m03.0s), 6/6 VUs, 109 complete and 0 interrupted iterations
default   [   7% ] 6 VUs  03.0s/45s

running (0m04.0s), 6/6 VUs, 163 complete and 0 interrupted iterations
default   [   9% ] 6 VUs  04.0s/45s

running (0m05.0s), 6/6 VUs, 234 complete and 0 interrupted iterations
default   [  11% ] 6 VUs  05.0s/45s

running (0m06.0s), 6/6 VUs, 333 complete and 0 interrupted iterations
default   [  13% ] 6 VUs  06.0s/45s

running (0m07.0s), 6/6 VUs, 430 complete and 0 interrupted iterations
default   [  16% ] 6 VUs  07.0s/45s

running (0m08.0s), 6/6 VUs, 519 complete and 0 interrupted iterations
default   [  18% ] 6 VUs  08.0s/45s

running (0m09.0s), 6/6 VUs, 620 complete and 0 interrupted iterations
default   [  20% ] 6 VUs  09.0s/45s

running (0m10.0s), 6/6 VUs, 726 complete and 0 interrupted iterations
default   [  22% ] 6 VUs  10.0s/45s

running (0m11.0s), 6/6 VUs, 822 complete and 0 interrupted iterations
default   [  24% ] 6 VUs  11.0s/45s

running (0m12.0s), 6/6 VUs, 930 complete and 0 interrupted iterations
default   [  27% ] 6 VUs  12.0s/45s

running (0m13.0s), 6/6 VUs, 1037 complete and 0 interrupted iterations
default   [  29% ] 6 VUs  13.0s/45s

running (0m14.0s), 6/6 VUs, 1141 complete and 0 interrupted iterations
default   [  31% ] 6 VUs  14.0s/45s

running (0m15.0s), 6/6 VUs, 1244 complete and 0 interrupted iterations
default   [  33% ] 6 VUs  15.0s/45s

running (0m16.0s), 6/6 VUs, 1347 complete and 0 interrupted iterations
default   [  36% ] 6 VUs  16.0s/45s

running (0m17.0s), 6/6 VUs, 1451 complete and 0 interrupted iterations
default   [  38% ] 6 VUs  17.0s/45s

running (0m18.0s), 6/6 VUs, 1543 complete and 0 interrupted iterations
default   [  40% ] 6 VUs  18.0s/45s

running (0m19.0s), 6/6 VUs, 1644 complete and 0 interrupted iterations
default   [  42% ] 6 VUs  19.0s/45s

running (0m20.0s), 6/6 VUs, 1752 complete and 0 interrupted iterations
default   [  44% ] 6 VUs  20.0s/45s

running (0m21.0s), 6/6 VUs, 1840 complete and 0 interrupted iterations
default   [  47% ] 6 VUs  21.0s/45s

running (0m22.0s), 6/6 VUs, 1923 complete and 0 interrupted iterations
default   [  49% ] 6 VUs  22.0s/45s

running (0m23.0s), 6/6 VUs, 2025 complete and 0 interrupted iterations
default   [  51% ] 6 VUs  23.0s/45s

running (0m24.0s), 6/6 VUs, 2081 complete and 0 interrupted iterations
default   [  53% ] 6 VUs  24.0s/45s

running (0m25.0s), 6/6 VUs, 2134 complete and 0 interrupted iterations
default   [  56% ] 6 VUs  25.0s/45s

running (0m26.0s), 6/6 VUs, 2241 complete and 0 interrupted iterations
default   [  58% ] 6 VUs  26.0s/45s

running (0m27.0s), 6/6 VUs, 2346 complete and 0 interrupted iterations
default   [  60% ] 6 VUs  27.0s/45s

running (0m28.0s), 6/6 VUs, 2445 complete and 0 interrupted iterations
default   [  62% ] 6 VUs  28.0s/45s

running (0m29.0s), 6/6 VUs, 2544 complete and 0 interrupted iterations
default   [  64% ] 6 VUs  29.0s/45s

running (0m30.0s), 6/6 VUs, 2646 complete and 0 interrupted iterations
default   [  67% ] 6 VUs  30.0s/45s

running (0m31.0s), 6/6 VUs, 2750 complete and 0 interrupted iterations
default   [  69% ] 6 VUs  31.0s/45s

running (0m32.0s), 6/6 VUs, 2858 complete and 0 interrupted iterations
default   [  71% ] 6 VUs  32.0s/45s

running (0m33.0s), 6/6 VUs, 2960 complete and 0 interrupted iterations
default   [  73% ] 6 VUs  33.0s/45s

running (0m34.0s), 6/6 VUs, 3056 complete and 0 interrupted iterations
default   [  76% ] 6 VUs  34.0s/45s

running (0m35.0s), 6/6 VUs, 3163 complete and 0 interrupted iterations
default   [  78% ] 6 VUs  35.0s/45s

running (0m36.0s), 6/6 VUs, 3271 complete and 0 interrupted iterations
default   [  80% ] 6 VUs  36.0s/45s

running (0m37.0s), 6/6 VUs, 3364 complete and 0 interrupted iterations
default   [  82% ] 6 VUs  37.0s/45s

running (0m38.0s), 6/6 VUs, 3458 complete and 0 interrupted iterations
default   [  84% ] 6 VUs  38.0s/45s

running (0m39.0s), 6/6 VUs, 3537 complete and 0 interrupted iterations
default   [  87% ] 6 VUs  39.0s/45s

running (0m40.0s), 6/6 VUs, 3637 complete and 0 interrupted iterations
default   [  89% ] 6 VUs  40.0s/45s

running (0m41.0s), 6/6 VUs, 3745 complete and 0 interrupted iterations
default   [  91% ] 6 VUs  41.0s/45s

running (0m42.0s), 6/6 VUs, 3858 complete and 0 interrupted iterations
default   [  93% ] 6 VUs  42.0s/45s

running (0m43.0s), 6/6 VUs, 3966 complete and 0 interrupted iterations
default   [  96% ] 6 VUs  43.0s/45s

running (0m44.0s), 6/6 VUs, 4074 complete and 0 interrupted iterations
default   [  98% ] 6 VUs  44.0s/45s

running (0m45.0s), 6/6 VUs, 4178 complete and 0 interrupted iterations
default   [ 100% ] 6 VUs  45.0s/45s


  █ THRESHOLDS 

    http_req_duration
    ✓ 'p(50)<250' p(50)=5.92ms
    ✓ 'p(95)<500' p(95)=45.11ms
    ✓ 'p(99)<1000' p(99)=162.88ms
    ✓ 'p(100)<4000' p(100)=691.54ms

    http_req_failed
    ✓ 'rate<0.05' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 4185    92.876709/s
    checks_succeeded...: 100.00% 4185 out of 4185
    checks_failed......: 0.00%   0 out of 4185

    ✓ 200

    HTTP
    http_req_duration..............: avg=13.73ms min=1.41ms  med=5.92ms  max=691.54ms p(90)=21.37ms p(95)=45.11ms
      { expected_response:true }...: avg=13.73ms min=1.41ms  med=5.92ms  max=691.54ms p(90)=21.37ms p(95)=45.11ms
    http_req_failed................: 0.00%  0 out of 4185
    http_reqs......................: 4185   92.876709/s

    EXECUTION
    iteration_duration.............: avg=64.53ms min=51.58ms med=56.48ms max=749.57ms p(90)=72.1ms  p(95)=95.62ms
    iterations.....................: 4185   92.876709/s
    vus............................: 6      min=6         max=6
    vus_max........................: 6      min=6         max=6

    NETWORK
    data_received..................: 420 kB 9.3 kB/s
    data_sent......................: 166 kB 3.7 kB/s




running (0m45.1s), 0/6 VUs, 4185 complete and 0 interrupted iterations
default ✓ [ 100% ] 6 VUs  45s
```

## k6: auth-service-health

`k6-auth-service-health.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-auth-service-health.js
        output: -

     scenarios: (100.00%) 1 scenario, 6 max VUs, 1m15s max duration (incl. graceful stop):
              * default: 6 looping VUs for 45s (gracefulStop: 30s)


running (0m01.0s), 6/6 VUs, 30 complete and 0 interrupted iterations
default   [   2% ] 6 VUs  01.0s/45s

running (0m02.0s), 6/6 VUs, 96 complete and 0 interrupted iterations
default   [   4% ] 6 VUs  02.0s/45s

running (0m03.0s), 6/6 VUs, 163 complete and 0 interrupted iterations
default   [   7% ] 6 VUs  03.0s/45s

running (0m04.0s), 6/6 VUs, 211 complete and 0 interrupted iterations
default   [   9% ] 6 VUs  04.0s/45s

running (0m05.0s), 6/6 VUs, 262 complete and 0 interrupted iterations
default   [  11% ] 6 VUs  05.0s/45s

running (0m06.0s), 6/6 VUs, 313 complete and 0 interrupted iterations
default   [  13% ] 6 VUs  06.0s/45s

running (0m07.0s), 6/6 VUs, 377 complete and 0 interrupted iterations
default   [  16% ] 6 VUs  07.0s/45s

running (0m08.0s), 6/6 VUs, 435 complete and 0 interrupted iterations
default   [  18% ] 6 VUs  08.0s/45s

running (0m09.0s), 6/6 VUs, 486 complete and 0 interrupted iterations
default   [  20% ] 6 VUs  09.0s/45s

running (0m10.0s), 6/6 VUs, 541 complete and 0 interrupted iterations
default   [  22% ] 6 VUs  10.0s/45s

running (0m11.0s), 6/6 VUs, 625 complete and 0 interrupted iterations
default   [  24% ] 6 VUs  11.0s/45s

running (0m12.0s), 6/6 VUs, 698 complete and 0 interrupted iterations
default   [  27% ] 6 VUs  12.0s/45s

running (0m13.0s), 6/6 VUs, 754 complete and 0 interrupted iterations
default   [  29% ] 6 VUs  13.0s/45s

running (0m14.0s), 6/6 VUs, 817 complete and 0 interrupted iterations
default   [  31% ] 6 VUs  14.0s/45s

running (0m15.0s), 6/6 VUs, 901 complete and 0 interrupted iterations
default   [  33% ] 6 VUs  15.0s/45s

running (0m16.0s), 6/6 VUs, 974 complete and 0 interrupted iterations
default   [  36% ] 6 VUs  16.0s/45s

running (0m17.0s), 6/6 VUs, 1012 complete and 0 interrupted iterations
default   [  38% ] 6 VUs  17.0s/45s

running (0m18.0s), 6/6 VUs, 1090 complete and 0 interrupted iterations
default   [  40% ] 6 VUs  18.0s/45s

running (0m19.0s), 6/6 VUs, 1156 complete and 0 interrupted iterations
default   [  42% ] 6 VUs  19.0s/45s

running (0m20.0s), 6/6 VUs, 1227 complete and 0 interrupted iterations
default   [  44% ] 6 VUs  20.0s/45s

running (0m21.0s), 6/6 VUs, 1300 complete and 0 interrupted iterations
default   [  47% ] 6 VUs  21.0s/45s

running (0m22.0s), 6/6 VUs, 1358 complete and 0 interrupted iterations
default   [  49% ] 6 VUs  22.0s/45s

running (0m23.0s), 6/6 VUs, 1413 complete and 0 interrupted iterations
default   [  51% ] 6 VUs  23.0s/45s

running (0m24.0s), 6/6 VUs, 1479 complete and 0 interrupted iterations
default   [  53% ] 6 VUs  24.0s/45s

running (0m25.0s), 6/6 VUs, 1544 complete and 0 interrupted iterations
default   [  56% ] 6 VUs  25.0s/45s

running (0m26.0s), 6/6 VUs, 1620 complete and 0 interrupted iterations
default   [  58% ] 6 VUs  26.0s/45s

running (0m27.0s), 6/6 VUs, 1683 complete and 0 interrupted iterations
default   [  60% ] 6 VUs  27.0s/45s

running (0m28.0s), 6/6 VUs, 1757 complete and 0 interrupted iterations
default   [  62% ] 6 VUs  28.0s/45s

running (0m29.0s), 6/6 VUs, 1838 complete and 0 interrupted iterations
default   [  64% ] 6 VUs  29.0s/45s

running (0m30.0s), 6/6 VUs, 1915 complete and 0 interrupted iterations
default   [  67% ] 6 VUs  30.0s/45s

running (0m31.0s), 6/6 VUs, 1988 complete and 0 interrupted iterations
default   [  69% ] 6 VUs  31.0s/45s

running (0m32.0s), 6/6 VUs, 2052 complete and 0 interrupted iterations
default   [  71% ] 6 VUs  32.0s/45s

running (0m33.0s), 6/6 VUs, 2106 complete and 0 interrupted iterations
default   [  73% ] 6 VUs  33.0s/45s

running (0m34.0s), 6/6 VUs, 2165 complete and 0 interrupted iterations
default   [  76% ] 6 VUs  34.0s/45s

running (0m35.0s), 6/6 VUs, 2214 complete and 0 interrupted iterations
default   [  78% ] 6 VUs  35.0s/45s

running (0m36.0s), 6/6 VUs, 2280 complete and 0 interrupted iterations
default   [  80% ] 6 VUs  36.0s/45s

running (0m37.0s), 6/6 VUs, 2345 complete and 0 interrupted iterations
default   [  82% ] 6 VUs  37.0s/45s

running (0m38.0s), 6/6 VUs, 2392 complete and 0 interrupted iterations
default   [  84% ] 6 VUs  38.0s/45s

running (0m39.0s), 6/6 VUs, 2472 complete and 0 interrupted iterations
default   [  87% ] 6 VUs  39.0s/45s

running (0m40.0s), 6/6 VUs, 2538 complete and 0 interrupted iterations
default   [  89% ] 6 VUs  40.0s/45s

running (0m41.0s), 6/6 VUs, 2580 complete and 0 interrupted iterations
default   [  91% ] 6 VUs  41.0s/45s

running (0m42.0s), 6/6 VUs, 2651 complete and 0 interrupted iterations
default   [  93% ] 6 VUs  42.0s/45s

running (0m43.0s), 6/6 VUs, 2700 complete and 0 interrupted iterations
default   [  96% ] 6 VUs  43.0s/45s

running (0m44.0s), 6/6 VUs, 2763 complete and 0 interrupted iterations
default   [  98% ] 6 VUs  44.0s/45s

running (0m45.0s), 6/6 VUs, 2847 complete and 0 interrupted iterations
default   [ 100% ] 6 VUs  45.0s/45s


  █ THRESHOLDS 

    http_req_duration
    ✓ 'p(95)<800' p(95)=112.19ms
    ✓ 'p(99)<3000' p(99)=168.92ms
    ✓ 'p(100)<8000' p(100)=511.11ms

    http_req_failed
    ✓ 'rate<0.08' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 2854    63.327361/s
    checks_succeeded...: 100.00% 2854 out of 2854
    checks_failed......: 0.00%   0 out of 2854

    ✓ 200

    HTTP
    http_req_duration..............: avg=43.97ms min=10.19ms med=32.9ms  max=511.11ms p(90)=79.79ms  p(95)=112.19ms
      { expected_response:true }...: avg=43.97ms min=10.19ms med=32.9ms  max=511.11ms p(90)=79.79ms  p(95)=112.19ms
    http_req_failed................: 0.00%  0 out of 2854
    http_reqs......................: 2854   63.327361/s

    EXECUTION
    iteration_duration.............: avg=94.65ms min=60.96ms med=83.58ms max=584.18ms p(90)=130.52ms p(95)=162.72ms
    iterations.....................: 2854   63.327361/s
    vus............................: 6      min=6         max=6
    vus_max........................: 6      min=6         max=6

    NETWORK
    data_received..................: 754 kB 17 kB/s
    data_sent......................: 120 kB 2.7 kB/s




running (0m45.1s), 0/6 VUs, 2854 complete and 0 interrupted iterations
default ✓ [ 100% ] 6 VUs  45s
```

## k6: listings-health

`k6-listings-health.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-listings-health.js
        output: -

     scenarios: (100.00%) 1 scenario, 6 max VUs, 1m15s max duration (incl. graceful stop):
              * default: 6 looping VUs for 45s (gracefulStop: 30s)


running (0m01.0s), 6/6 VUs, 6 complete and 0 interrupted iterations
default   [   2% ] 6 VUs  01.0s/45s

running (0m02.0s), 6/6 VUs, 17 complete and 0 interrupted iterations
default   [   4% ] 6 VUs  02.0s/45s

running (0m03.0s), 6/6 VUs, 47 complete and 0 interrupted iterations
default   [   7% ] 6 VUs  03.0s/45s

running (0m04.0s), 6/6 VUs, 81 complete and 0 interrupted iterations
default   [   9% ] 6 VUs  04.0s/45s

running (0m05.0s), 6/6 VUs, 149 complete and 0 interrupted iterations
default   [  11% ] 6 VUs  05.0s/45s

running (0m06.0s), 6/6 VUs, 202 complete and 0 interrupted iterations
default   [  13% ] 6 VUs  06.0s/45s

running (0m07.0s), 6/6 VUs, 282 complete and 0 interrupted iterations
default   [  16% ] 6 VUs  07.0s/45s

running (0m08.0s), 6/6 VUs, 324 complete and 0 interrupted iterations
default   [  18% ] 6 VUs  08.0s/45s

running (0m09.0s), 6/6 VUs, 390 complete and 0 interrupted iterations
default   [  20% ] 6 VUs  09.0s/45s

running (0m10.0s), 6/6 VUs, 474 complete and 0 interrupted iterations
default   [  22% ] 6 VUs  10.0s/45s

running (0m11.0s), 6/6 VUs, 529 complete and 0 interrupted iterations
default   [  24% ] 6 VUs  11.0s/45s

running (0m12.0s), 6/6 VUs, 581 complete and 0 interrupted iterations
default   [  27% ] 6 VUs  12.0s/45s

running (0m13.0s), 6/6 VUs, 637 complete and 0 interrupted iterations
default   [  29% ] 6 VUs  13.0s/45s

running (0m14.0s), 6/6 VUs, 702 complete and 0 interrupted iterations
default   [  31% ] 6 VUs  14.0s/45s

running (0m15.0s), 6/6 VUs, 723 complete and 0 interrupted iterations
default   [  33% ] 6 VUs  15.0s/45s

running (0m16.0s), 6/6 VUs, 756 complete and 0 interrupted iterations
default   [  36% ] 6 VUs  16.0s/45s

running (0m17.0s), 6/6 VUs, 812 complete and 0 interrupted iterations
default   [  38% ] 6 VUs  17.0s/45s

running (0m18.0s), 6/6 VUs, 878 complete and 0 interrupted iterations
default   [  40% ] 6 VUs  18.0s/45s

running (0m19.0s), 6/6 VUs, 957 complete and 0 interrupted iterations
default   [  42% ] 6 VUs  19.0s/45s

running (0m20.0s), 6/6 VUs, 1038 complete and 0 interrupted iterations
default   [  44% ] 6 VUs  20.0s/45s

running (0m21.0s), 6/6 VUs, 1089 complete and 0 interrupted iterations
default   [  47% ] 6 VUs  21.0s/45s

running (0m22.0s), 6/6 VUs, 1122 complete and 0 interrupted iterations
default   [  49% ] 6 VUs  22.0s/45s

running (0m23.0s), 6/6 VUs, 1182 complete and 0 interrupted iterations
default   [  51% ] 6 VUs  23.0s/45s

running (0m24.0s), 6/6 VUs, 1266 complete and 0 interrupted iterations
default   [  53% ] 6 VUs  24.0s/45s

running (0m25.0s), 6/6 VUs, 1330 complete and 0 interrupted iterations
default   [  56% ] 6 VUs  25.0s/45s

running (0m26.0s), 6/6 VUs, 1333 complete and 0 interrupted iterations
default   [  58% ] 6 VUs  26.0s/45s

running (0m27.0s), 6/6 VUs, 1333 complete and 0 interrupted iterations
default   [  60% ] 6 VUs  27.0s/45s

running (0m28.0s), 6/6 VUs, 1333 complete and 0 interrupted iterations
default   [  62% ] 6 VUs  28.0s/45s

running (0m29.0s), 6/6 VUs, 1333 complete and 0 interrupted iterations
default   [  64% ] 6 VUs  29.0s/45s

running (0m30.0s), 6/6 VUs, 1333 complete and 0 interrupted iterations
default   [  67% ] 6 VUs  30.0s/45s

running (0m31.0s), 6/6 VUs, 1339 complete and 0 interrupted iterations
default   [  69% ] 6 VUs  31.0s/45s

running (0m32.0s), 6/6 VUs, 1339 complete and 0 interrupted iterations
default   [  71% ] 6 VUs  32.0s/45s

running (0m33.0s), 6/6 VUs, 1339 complete and 0 interrupted iterations
default   [  73% ] 6 VUs  33.0s/45s

running (0m34.0s), 6/6 VUs, 1339 complete and 0 interrupted iterations
default   [  76% ] 6 VUs  34.0s/45s

running (0m35.0s), 6/6 VUs, 1339 complete and 0 interrupted iterations
default   [  78% ] 6 VUs  35.0s/45s

running (0m36.0s), 6/6 VUs, 1345 complete and 0 interrupted iterations
default   [  80% ] 6 VUs  36.0s/45s

running (0m37.0s), 6/6 VUs, 1345 complete and 0 interrupted iterations
default   [  82% ] 6 VUs  37.0s/45s

running (0m38.0s), 6/6 VUs, 1345 complete and 0 interrupted iterations
default   [  84% ] 6 VUs  38.0s/45s

running (0m39.0s), 6/6 VUs, 1345 complete and 0 interrupted iterations
default   [  87% ] 6 VUs  39.0s/45s

running (0m40.0s), 6/6 VUs, 1345 complete and 0 interrupted iterations
default   [  89% ] 6 VUs  40.0s/45s

running (0m41.0s), 6/6 VUs, 1363 complete and 0 interrupted iterations
default   [  91% ] 6 VUs  41.0s/45s

running (0m42.0s), 6/6 VUs, 1399 complete and 0 interrupted iterations
default   [  93% ] 6 VUs  42.0s/45s

running (0m43.0s), 6/6 VUs, 1440 complete and 0 interrupted iterations
default   [  96% ] 6 VUs  43.0s/45s

running (0m44.0s), 6/6 VUs, 1515 complete and 0 interrupted iterations
default   [  98% ] 6 VUs  44.0s/45s

running (0m45.0s), 6/6 VUs, 1605 complete and 0 interrupted iterations
default   [ 100% ] 6 VUs  45.0s/45s


  █ THRESHOLDS 

    http_req_duration
    ✓ 'p(95)<600' p(95)=242.94ms
    ✗ 'p(99)<2500' p(99)=5.03s
    ✓ 'p(100)<8000' p(100)=5.2s

    http_req_failed
    ✓ 'rate<0.08' rate=1.11%


  █ TOTAL RESULTS 

    checks_total.......: 1611   35.755684/s
    checks_succeeded...: 98.88% 1593 out of 1611
    checks_failed......: 1.11%  18 out of 1611

    ✗ 200
      ↳  98% — ✓ 1593 / ✗ 18

    HTTP
    http_req_duration..............: avg=117.09ms min=5.71ms  med=31.26ms max=5.2s  p(90)=144.86ms p(95)=242.94ms
      { expected_response:true }...: avg=60.56ms  min=5.71ms  med=30.77ms max=1.65s p(90)=138.07ms p(95)=182.76ms
    http_req_failed................: 1.11%  18 out of 1611
    http_reqs......................: 1611   35.755684/s

    EXECUTION
    iteration_duration.............: avg=167.75ms min=56.05ms med=81.93ms max=5.25s p(90)=195.66ms p(95)=294.11ms
    iterations.....................: 1611   35.755684/s
    vus............................: 6      min=6          max=6
    vus_max........................: 6      min=6          max=6

    NETWORK
    data_received..................: 203 kB 4.5 kB/s
    data_sent......................: 71 kB  1.6 kB/s




running (0m45.1s), 0/6 VUs, 1611 complete and 0 interrupted iterations
default ✓ [ 100% ] 6 VUs  45s
time="2026-03-23T16:25:55-04:00" level=error msg="thresholds on metrics 'http_req_duration' have been crossed"
(exit non-zero)
```

## k6: booking-health

`k6-booking-health.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-booking-health.js
        output: -

     scenarios: (100.00%) 1 scenario, 6 max VUs, 1m15s max duration (incl. graceful stop):
              * default: 6 looping VUs for 45s (gracefulStop: 30s)


running (0m01.0s), 6/6 VUs, 4 complete and 0 interrupted iterations
default   [   2% ] 6 VUs  01.0s/45s

running (0m02.0s), 6/6 VUs, 27 complete and 0 interrupted iterations
default   [   4% ] 6 VUs  02.0s/45s

running (0m03.0s), 6/6 VUs, 58 complete and 0 interrupted iterations
default   [   7% ] 6 VUs  03.0s/45s

running (0m04.0s), 6/6 VUs, 85 complete and 0 interrupted iterations
default   [   9% ] 6 VUs  04.0s/45s

running (0m05.0s), 6/6 VUs, 125 complete and 0 interrupted iterations
default   [  11% ] 6 VUs  05.0s/45s

running (0m06.0s), 6/6 VUs, 136 complete and 0 interrupted iterations
default   [  13% ] 6 VUs  06.0s/45s

running (0m07.0s), 6/6 VUs, 142 complete and 0 interrupted iterations
default   [  16% ] 6 VUs  07.0s/45s

running (0m08.0s), 6/6 VUs, 166 complete and 0 interrupted iterations
default   [  18% ] 6 VUs  08.0s/45s

running (0m09.0s), 6/6 VUs, 234 complete and 0 interrupted iterations
default   [  20% ] 6 VUs  09.0s/45s

running (0m10.0s), 6/6 VUs, 311 complete and 0 interrupted iterations
default   [  22% ] 6 VUs  10.0s/45s

running (0m11.0s), 6/6 VUs, 394 complete and 0 interrupted iterations
default   [  24% ] 6 VUs  11.0s/45s

running (0m12.0s), 6/6 VUs, 431 complete and 0 interrupted iterations
default   [  27% ] 6 VUs  12.0s/45s

running (0m13.0s), 6/6 VUs, 459 complete and 0 interrupted iterations
default   [  29% ] 6 VUs  13.0s/45s

running (0m14.0s), 6/6 VUs, 507 complete and 0 interrupted iterations
default   [  31% ] 6 VUs  14.0s/45s

running (0m15.0s), 6/6 VUs, 584 complete and 0 interrupted iterations
default   [  33% ] 6 VUs  15.0s/45s

running (0m16.0s), 6/6 VUs, 673 complete and 0 interrupted iterations
default   [  36% ] 6 VUs  16.0s/45s

running (0m17.0s), 6/6 VUs, 762 complete and 0 interrupted iterations
default   [  38% ] 6 VUs  17.0s/45s

running (0m18.0s), 6/6 VUs, 814 complete and 0 interrupted iterations
default   [  40% ] 6 VUs  18.0s/45s

running (0m19.0s), 6/6 VUs, 860 complete and 0 interrupted iterations
default   [  42% ] 6 VUs  19.0s/45s

running (0m20.0s), 6/6 VUs, 924 complete and 0 interrupted iterations
default   [  44% ] 6 VUs  20.0s/45s

running (0m21.0s), 6/6 VUs, 1008 complete and 0 interrupted iterations
default   [  47% ] 6 VUs  21.0s/45s

running (0m22.0s), 6/6 VUs, 1045 complete and 0 interrupted iterations
default   [  49% ] 6 VUs  22.0s/45s

running (0m23.0s), 6/6 VUs, 1050 complete and 0 interrupted iterations
default   [  51% ] 6 VUs  23.0s/45s

running (0m24.0s), 6/6 VUs, 1086 complete and 0 interrupted iterations
default   [  53% ] 6 VUs  24.0s/45s

running (0m25.0s), 6/6 VUs, 1164 complete and 0 interrupted iterations
default   [  56% ] 6 VUs  25.0s/45s

running (0m26.0s), 6/6 VUs, 1246 complete and 0 interrupted iterations
default   [  58% ] 6 VUs  26.0s/45s

running (0m27.0s), 6/6 VUs, 1320 complete and 0 interrupted iterations
default   [  60% ] 6 VUs  27.0s/45s

running (0m28.0s), 6/6 VUs, 1366 complete and 0 interrupted iterations
default   [  62% ] 6 VUs  28.0s/45s

running (0m29.0s), 6/6 VUs, 1399 complete and 0 interrupted iterations
default   [  64% ] 6 VUs  29.0s/45s

running (0m30.0s), 6/6 VUs, 1443 complete and 0 interrupted iterations
default   [  67% ] 6 VUs  30.0s/45s

running (0m31.0s), 6/6 VUs, 1497 complete and 0 interrupted iterations
default   [  69% ] 6 VUs  31.0s/45s

running (0m32.0s), 6/6 VUs, 1520 complete and 0 interrupted iterations
default   [  71% ] 6 VUs  32.0s/45s

running (0m33.0s), 6/6 VUs, 1526 complete and 0 interrupted iterations
default   [  73% ] 6 VUs  33.0s/45s

running (0m34.0s), 6/6 VUs, 1527 complete and 0 interrupted iterations
default   [  76% ] 6 VUs  34.0s/45s

running (0m35.0s), 6/6 VUs, 1529 complete and 0 interrupted iterations
default   [  78% ] 6 VUs  35.0s/45s

running (0m36.0s), 6/6 VUs, 1530 complete and 0 interrupted iterations
default   [  80% ] 6 VUs  36.0s/45s

running (0m37.0s), 6/6 VUs, 1533 complete and 0 interrupted iterations
default   [  82% ] 6 VUs  37.0s/45s

running (0m38.0s), 6/6 VUs, 1534 complete and 0 interrupted iterations
default   [  84% ] 6 VUs  38.0s/45s

running (0m39.0s), 6/6 VUs, 1549 complete and 0 interrupted iterations
default   [  87% ] 6 VUs  39.0s/45s

running (0m40.0s), 6/6 VUs, 1576 complete and 0 interrupted iterations
default   [  89% ] 6 VUs  40.0s/45s

running (0m41.0s), 6/6 VUs, 1634 complete and 0 interrupted iterations
default   [  91% ] 6 VUs  41.0s/45s

running (0m42.0s), 6/6 VUs, 1662 complete and 0 interrupted iterations
default   [  93% ] 6 VUs  42.0s/45s

running (0m43.0s), 6/6 VUs, 1690 complete and 0 interrupted iterations
default   [  96% ] 6 VUs  43.0s/45s

running (0m44.0s), 6/6 VUs, 1760 complete and 0 interrupted iterations
default   [  98% ] 6 VUs  44.0s/45s

running (0m45.0s), 6/6 VUs, 1820 complete and 0 interrupted iterations
default   [ 100% ] 6 VUs  45.0s/45s


  █ THRESHOLDS 

    http_req_duration
    ✓ 'p(95)<800' p(95)=313.56ms
    ✓ 'p(99)<3000' p(99)=1.22s
    ✓ 'p(100)<8000' p(100)=3.42s

    http_req_failed
    ✓ 'rate<0.08' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 1826    40.481021/s
    checks_succeeded...: 100.00% 1826 out of 1826
    checks_failed......: 0.00%   0 out of 1826

    ✓ 200

    HTTP
    http_req_duration..............: avg=97.37ms  min=7.11ms  med=37.63ms max=3.42s p(90)=175.8ms  p(95)=313.56ms
      { expected_response:true }...: avg=97.37ms  min=7.11ms  med=37.63ms max=3.42s p(90)=175.8ms  p(95)=313.56ms
    http_req_failed................: 0.00%  0 out of 1826
    http_reqs......................: 1826   40.481021/s

    EXECUTION
    iteration_duration.............: avg=148.11ms min=57.44ms med=88.08ms max=3.47s p(90)=226.47ms p(95)=364.43ms
    iterations.....................: 1826   40.481021/s
    vus............................: 6      min=6         max=6
    vus_max........................: 6      min=6         max=6

    NETWORK
    data_received..................: 230 kB 5.1 kB/s
    data_sent......................: 79 kB  1.7 kB/s




running (0m45.1s), 0/6 VUs, 1826 complete and 0 interrupted iterations
default ✓ [ 100% ] 6 VUs  45s
```

## k6: trust-public

`k6-trust-public.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-trust-public.js
        output: -

     scenarios: (100.00%) 1 scenario, 6 max VUs, 1m15s max duration (incl. graceful stop):
              * default: 6 looping VUs for 45s (gracefulStop: 30s)


running (0m01.0s), 6/6 VUs, 0 complete and 0 interrupted iterations
default   [   2% ] 6 VUs  01.0s/45s

running (0m02.0s), 6/6 VUs, 0 complete and 0 interrupted iterations
default   [   4% ] 6 VUs  02.0s/45s

running (0m03.0s), 6/6 VUs, 6 complete and 0 interrupted iterations
default   [   7% ] 6 VUs  03.0s/45s

running (0m04.0s), 6/6 VUs, 24 complete and 0 interrupted iterations
default   [   9% ] 6 VUs  04.0s/45s

running (0m05.0s), 6/6 VUs, 67 complete and 0 interrupted iterations
default   [  11% ] 6 VUs  05.0s/45s

running (0m06.0s), 6/6 VUs, 89 complete and 0 interrupted iterations
default   [  13% ] 6 VUs  06.0s/45s

running (0m07.0s), 6/6 VUs, 102 complete and 0 interrupted iterations
default   [  16% ] 6 VUs  07.0s/45s

running (0m08.0s), 6/6 VUs, 122 complete and 0 interrupted iterations
default   [  18% ] 6 VUs  08.0s/45s

running (0m09.0s), 6/6 VUs, 147 complete and 0 interrupted iterations
default   [  20% ] 6 VUs  09.0s/45s

running (0m10.0s), 6/6 VUs, 188 complete and 0 interrupted iterations
default   [  22% ] 6 VUs  10.0s/45s

running (0m11.0s), 6/6 VUs, 238 complete and 0 interrupted iterations
default   [  24% ] 6 VUs  11.0s/45s

running (0m12.0s), 6/6 VUs, 278 complete and 0 interrupted iterations
default   [  27% ] 6 VUs  12.0s/45s

running (0m13.0s), 6/6 VUs, 327 complete and 0 interrupted iterations
default   [  29% ] 6 VUs  13.0s/45s

running (0m14.0s), 6/6 VUs, 379 complete and 0 interrupted iterations
default   [  31% ] 6 VUs  14.0s/45s

running (0m15.0s), 6/6 VUs, 401 complete and 0 interrupted iterations
default   [  33% ] 6 VUs  15.0s/45s

running (0m16.0s), 6/6 VUs, 408 complete and 0 interrupted iterations
default   [  36% ] 6 VUs  16.0s/45s

running (0m17.0s), 6/6 VUs, 411 complete and 0 interrupted iterations
default   [  38% ] 6 VUs  17.0s/45s

running (0m18.0s), 6/6 VUs, 411 complete and 0 interrupted iterations
default   [  40% ] 6 VUs  18.0s/45s

running (0m19.0s), 6/6 VUs, 411 complete and 0 interrupted iterations
default   [  42% ] 6 VUs  19.0s/45s

running (0m20.0s), 6/6 VUs, 411 complete and 0 interrupted iterations
default   [  44% ] 6 VUs  20.0s/45s

running (0m21.0s), 6/6 VUs, 428 complete and 0 interrupted iterations
default   [  47% ] 6 VUs  21.0s/45s

running (0m22.0s), 6/6 VUs, 453 complete and 0 interrupted iterations
default   [  49% ] 6 VUs  22.0s/45s

running (0m23.0s), 6/6 VUs, 486 complete and 0 interrupted iterations
default   [  51% ] 6 VUs  23.0s/45s

running (0m24.0s), 6/6 VUs, 531 complete and 0 interrupted iterations
default   [  53% ] 6 VUs  24.0s/45s

running (0m25.0s), 6/6 VUs, 567 complete and 0 interrupted iterations
default   [  56% ] 6 VUs  25.0s/45s

running (0m26.0s), 6/6 VUs, 596 complete and 0 interrupted iterations
default   [  58% ] 6 VUs  26.0s/45s

running (0m27.0s), 6/6 VUs, 620 complete and 0 interrupted iterations
default   [  60% ] 6 VUs  27.0s/45s

running (0m28.0s), 6/6 VUs, 643 complete and 0 interrupted iterations
default   [  62% ] 6 VUs  28.0s/45s

running (0m29.0s), 6/6 VUs, 688 complete and 0 interrupted iterations
default   [  64% ] 6 VUs  29.0s/45s

running (0m30.0s), 6/6 VUs, 737 complete and 0 interrupted iterations
default   [  67% ] 6 VUs  30.0s/45s

running (0m31.0s), 6/6 VUs, 792 complete and 0 interrupted iterations
default   [  69% ] 6 VUs  31.0s/45s

running (0m32.0s), 6/6 VUs, 848 complete and 0 interrupted iterations
default   [  71% ] 6 VUs  32.0s/45s

running (0m33.0s), 6/6 VUs, 906 complete and 0 interrupted iterations
default   [  73% ] 6 VUs  33.0s/45s

running (0m34.0s), 6/6 VUs, 966 complete and 0 interrupted iterations
default   [  76% ] 6 VUs  34.0s/45s

running (0m35.0s), 6/6 VUs, 1020 complete and 0 interrupted iterations
default   [  78% ] 6 VUs  35.0s/45s

running (0m36.0s), 6/6 VUs, 1061 complete and 0 interrupted iterations
default   [  80% ] 6 VUs  36.0s/45s

running (0m37.0s), 6/6 VUs, 1082 complete and 0 interrupted iterations
default   [  82% ] 6 VUs  37.0s/45s

running (0m38.0s), 6/6 VUs, 1093 complete and 0 interrupted iterations
default   [  84% ] 6 VUs  38.0s/45s

running (0m39.0s), 6/6 VUs, 1122 complete and 0 interrupted iterations
default   [  87% ] 6 VUs  39.0s/45s

running (0m40.0s), 6/6 VUs, 1180 complete and 0 interrupted iterations
default   [  89% ] 6 VUs  40.0s/45s

running (0m41.0s), 6/6 VUs, 1239 complete and 0 interrupted iterations
default   [  91% ] 6 VUs  41.0s/45s

running (0m42.0s), 6/6 VUs, 1283 complete and 0 interrupted iterations
default   [  93% ] 6 VUs  42.0s/45s

running (0m43.0s), 6/6 VUs, 1323 complete and 0 interrupted iterations
default   [  96% ] 6 VUs  43.0s/45s

running (0m44.0s), 6/6 VUs, 1355 complete and 0 interrupted iterations
default   [  98% ] 6 VUs  44.0s/45s

running (0m45.0s), 6/6 VUs, 1415 complete and 0 interrupted iterations
default   [ 100% ] 6 VUs  45.0s/45s


  █ THRESHOLDS 

    http_req_duration
    ✓ 'p(95)<800' p(95)=311.95ms
    ✓ 'p(99)<2000' p(99)=1.41s
    ✗ 'p(100)<5000' p(100)=6.02s

    http_req_failed
    ✓ 'rate<0.05' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 1421    31.533096/s
    checks_succeeded...: 100.00% 1421 out of 1421
    checks_failed......: 0.00%   0 out of 1421

    ✓ 200

    HTTP
    http_req_duration..............: avg=109.28ms min=8.08ms  med=33.52ms  max=6.02s p(90)=211.96ms p(95)=311.95ms
      { expected_response:true }...: avg=109.28ms min=8.08ms  med=33.52ms  max=6.02s p(90)=211.96ms p(95)=311.95ms
    http_req_failed................: 0.00%  0 out of 1421
    http_reqs......................: 1421   31.533096/s

    EXECUTION
    iteration_duration.............: avg=190.12ms min=88.38ms med=114.13ms max=6.1s  p(90)=292.97ms p(95)=393.36ms
    iterations.....................: 1421   31.533096/s
    vus............................: 6      min=6         max=6
    vus_max........................: 6      min=6         max=6

    NETWORK
    data_received..................: 228 kB 5.0 kB/s
    data_sent......................: 64 kB  1.4 kB/s




running (0m45.1s), 0/6 VUs, 1421 complete and 0 interrupted iterations
default ✓ [ 100% ] 6 VUs  45s
time="2026-03-23T16:27:25-04:00" level=error msg="thresholds on metrics 'http_req_duration' have been crossed"
(exit non-zero)
```

## k6: analytics-public

`k6-analytics-public.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-analytics-public.js
        output: -

     scenarios: (100.00%) 1 scenario, 6 max VUs, 1m15s max duration (incl. graceful stop):
              * default: 6 looping VUs for 45s (gracefulStop: 30s)


running (0m01.0s), 6/6 VUs, 1 complete and 0 interrupted iterations
default   [   2% ] 6 VUs  01.0s/45s

running (0m02.0s), 6/6 VUs, 4 complete and 0 interrupted iterations
default   [   4% ] 6 VUs  02.0s/45s

running (0m03.0s), 6/6 VUs, 7 complete and 0 interrupted iterations
default   [   7% ] 6 VUs  03.0s/45s

running (0m04.0s), 6/6 VUs, 22 complete and 0 interrupted iterations
default   [   9% ] 6 VUs  04.0s/45s

running (0m05.0s), 6/6 VUs, 37 complete and 0 interrupted iterations
default   [  11% ] 6 VUs  05.0s/45s

running (0m06.0s), 6/6 VUs, 43 complete and 0 interrupted iterations
default   [  13% ] 6 VUs  06.0s/45s

running (0m07.0s), 6/6 VUs, 80 complete and 0 interrupted iterations
default   [  16% ] 6 VUs  07.0s/45s

running (0m08.0s), 6/6 VUs, 121 complete and 0 interrupted iterations
default   [  18% ] 6 VUs  08.0s/45s

running (0m09.0s), 6/6 VUs, 170 complete and 0 interrupted iterations
default   [  20% ] 6 VUs  09.0s/45s

running (0m10.0s), 6/6 VUs, 206 complete and 0 interrupted iterations
default   [  22% ] 6 VUs  10.0s/45s

running (0m11.0s), 6/6 VUs, 236 complete and 0 interrupted iterations
default   [  24% ] 6 VUs  11.0s/45s

running (0m12.0s), 6/6 VUs, 271 complete and 0 interrupted iterations
default   [  27% ] 6 VUs  12.0s/45s

running (0m13.0s), 6/6 VUs, 306 complete and 0 interrupted iterations
default   [  29% ] 6 VUs  13.0s/45s

running (0m14.0s), 6/6 VUs, 347 complete and 0 interrupted iterations
default   [  31% ] 6 VUs  14.0s/45s

running (0m15.0s), 6/6 VUs, 394 complete and 0 interrupted iterations
default   [  33% ] 6 VUs  15.0s/45s

running (0m16.0s), 6/6 VUs, 449 complete and 0 interrupted iterations
default   [  36% ] 6 VUs  16.0s/45s

running (0m17.0s), 6/6 VUs, 504 complete and 0 interrupted iterations
default   [  38% ] 6 VUs  17.0s/45s

running (0m18.0s), 6/6 VUs, 546 complete and 0 interrupted iterations
default   [  40% ] 6 VUs  18.0s/45s

running (0m19.0s), 6/6 VUs, 597 complete and 0 interrupted iterations
default   [  42% ] 6 VUs  19.0s/45s

running (0m20.0s), 6/6 VUs, 650 complete and 0 interrupted iterations
default   [  44% ] 6 VUs  20.0s/45s

running (0m21.0s), 6/6 VUs, 705 complete and 0 interrupted iterations
default   [  47% ] 6 VUs  21.0s/45s

running (0m22.0s), 6/6 VUs, 744 complete and 0 interrupted iterations
default   [  49% ] 6 VUs  22.0s/45s

running (0m23.0s), 6/6 VUs, 771 complete and 0 interrupted iterations
default   [  51% ] 6 VUs  23.0s/45s

running (0m24.0s), 6/6 VUs, 779 complete and 0 interrupted iterations
default   [  53% ] 6 VUs  24.0s/45s

running (0m25.0s), 6/6 VUs, 804 complete and 0 interrupted iterations
default   [  56% ] 6 VUs  25.0s/45s

running (0m26.0s), 6/6 VUs, 807 complete and 0 interrupted iterations
default   [  58% ] 6 VUs  26.0s/45s

running (0m27.0s), 6/6 VUs, 808 complete and 0 interrupted iterations
default   [  60% ] 6 VUs  27.0s/45s

running (0m28.0s), 6/6 VUs, 815 complete and 0 interrupted iterations
default   [  62% ] 6 VUs  28.0s/45s

running (0m29.0s), 6/6 VUs, 833 complete and 0 interrupted iterations
default   [  64% ] 6 VUs  29.0s/45s

running (0m30.0s), 6/6 VUs, 888 complete and 0 interrupted iterations
default   [  67% ] 6 VUs  30.0s/45s

running (0m31.0s), 6/6 VUs, 946 complete and 0 interrupted iterations
default   [  69% ] 6 VUs  31.0s/45s

running (0m32.0s), 6/6 VUs, 995 complete and 0 interrupted iterations
default   [  71% ] 6 VUs  32.0s/45s

running (0m33.0s), 6/6 VUs, 1025 complete and 0 interrupted iterations
default   [  73% ] 6 VUs  33.0s/45s

running (0m34.0s), 6/6 VUs, 1034 complete and 0 interrupted iterations
default   [  76% ] 6 VUs  34.0s/45s

running (0m35.0s), 6/6 VUs, 1093 complete and 0 interrupted iterations
default   [  78% ] 6 VUs  35.0s/45s

running (0m36.0s), 6/6 VUs, 1149 complete and 0 interrupted iterations
default   [  80% ] 6 VUs  36.0s/45s

running (0m37.0s), 6/6 VUs, 1201 complete and 0 interrupted iterations
default   [  82% ] 6 VUs  37.0s/45s

running (0m38.0s), 6/6 VUs, 1232 complete and 0 interrupted iterations
default   [  84% ] 6 VUs  38.0s/45s

running (0m39.0s), 6/6 VUs, 1278 complete and 0 interrupted iterations
default   [  87% ] 6 VUs  39.0s/45s

running (0m40.0s), 6/6 VUs, 1318 complete and 0 interrupted iterations
default   [  89% ] 6 VUs  40.0s/45s

running (0m41.0s), 6/6 VUs, 1355 complete and 0 interrupted iterations
default   [  91% ] 6 VUs  41.0s/45s

running (0m42.0s), 6/6 VUs, 1401 complete and 0 interrupted iterations
default   [  93% ] 6 VUs  42.0s/45s

running (0m43.0s), 6/6 VUs, 1434 complete and 0 interrupted iterations
default   [  96% ] 6 VUs  43.0s/45s

running (0m44.0s), 6/6 VUs, 1485 complete and 0 interrupted iterations
default   [  98% ] 6 VUs  44.0s/45s

running (0m45.0s), 6/6 VUs, 1536 complete and 0 interrupted iterations
default   [ 100% ] 6 VUs  45.0s/45s


  █ THRESHOLDS 

    http_req_duration
    ✓ 'p(95)<1200' p(95)=253.08ms
    ✓ 'p(99)<4000' p(99)=1.01s
    ✓ 'p(100)<8000' p(100)=3.61s

    http_req_failed
    ✓ 'rate<0.05' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 1542    34.17716/s
    checks_succeeded...: 100.00% 1542 out of 1542
    checks_failed......: 0.00%   0 out of 1542

    ✓ 200

    HTTP
    http_req_duration..............: avg=94.66ms min=6.17ms  med=30.38ms  max=3.61s p(90)=162.84ms p(95)=253.08ms
      { expected_response:true }...: avg=94.66ms min=6.17ms  med=30.38ms  max=3.61s p(90)=162.84ms p(95)=253.08ms
    http_req_failed................: 0.00%  0 out of 1542
    http_reqs......................: 1542   34.17716/s

    EXECUTION
    iteration_duration.............: avg=175.4ms min=86.42ms med=110.92ms max=3.72s p(90)=244.12ms p(95)=334.43ms
    iterations.....................: 1542   34.17716/s
    vus............................: 6      min=6         max=6
    vus_max........................: 6      min=6         max=6

    NETWORK
    data_received..................: 357 kB 7.9 kB/s
    data_sent......................: 70 kB  1.5 kB/s




running (0m45.1s), 0/6 VUs, 1542 complete and 0 interrupted iterations
default ✓ [ 100% ] 6 VUs  45s
```

## k6: messaging-health

`k6-messaging.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-messaging.js
        output: -

     scenarios: (100.00%) 1 scenario, 50 max VUs, 1m15s max duration (incl. graceful stop):
              * messaging_health: 20.00 iterations/s for 45s (maxVUs: 6-50, gracefulStop: 30s)


running (0m01.0s), 02/07 VUs, 17 complete and 0 interrupted iterations
messaging_health   [   2% ] 02/07 VUs  01.0s/45s  20.00 iters/s

running (0m02.0s), 02/07 VUs, 37 complete and 0 interrupted iterations
messaging_health   [   4% ] 02/07 VUs  02.0s/45s  20.00 iters/s

running (0m03.0s), 02/07 VUs, 57 complete and 0 interrupted iterations
messaging_health   [   7% ] 02/07 VUs  03.0s/45s  20.00 iters/s

running (0m04.0s), 02/07 VUs, 77 complete and 0 interrupted iterations
messaging_health   [   9% ] 02/07 VUs  04.0s/45s  20.00 iters/s

running (0m05.0s), 02/08 VUs, 96 complete and 0 interrupted iterations
messaging_health   [  11% ] 02/08 VUs  05.0s/45s  20.00 iters/s

running (0m06.0s), 02/08 VUs, 116 complete and 0 interrupted iterations
messaging_health   [  13% ] 02/08 VUs  06.0s/45s  20.00 iters/s

running (0m07.0s), 02/08 VUs, 136 complete and 0 interrupted iterations
messaging_health   [  16% ] 02/08 VUs  07.0s/45s  20.00 iters/s

running (0m08.0s), 02/08 VUs, 156 complete and 0 interrupted iterations
messaging_health   [  18% ] 02/08 VUs  08.0s/45s  20.00 iters/s

running (0m09.0s), 02/08 VUs, 176 complete and 0 interrupted iterations
messaging_health   [  20% ] 02/08 VUs  09.0s/45s  20.00 iters/s

running (0m10.0s), 02/08 VUs, 196 complete and 0 interrupted iterations
messaging_health   [  22% ] 02/08 VUs  10.0s/45s  20.00 iters/s

running (0m11.0s), 02/08 VUs, 216 complete and 0 interrupted iterations
messaging_health   [  24% ] 02/08 VUs  11.0s/45s  20.00 iters/s

running (0m12.0s), 02/08 VUs, 236 complete and 0 interrupted iterations
messaging_health   [  27% ] 02/08 VUs  12.0s/45s  20.00 iters/s

running (0m13.0s), 02/08 VUs, 256 complete and 0 interrupted iterations
messaging_health   [  29% ] 02/08 VUs  13.0s/45s  20.00 iters/s

running (0m14.0s), 02/08 VUs, 276 complete and 0 interrupted iterations
messaging_health   [  31% ] 02/08 VUs  14.0s/45s  20.00 iters/s

running (0m15.0s), 03/08 VUs, 296 complete and 0 interrupted iterations
messaging_health   [  33% ] 03/08 VUs  15.0s/45s  20.00 iters/s

running (0m16.0s), 02/08 VUs, 316 complete and 0 interrupted iterations
messaging_health   [  36% ] 02/08 VUs  16.0s/45s  20.00 iters/s

running (0m17.0s), 02/08 VUs, 336 complete and 0 interrupted iterations
messaging_health   [  38% ] 02/08 VUs  17.0s/45s  20.00 iters/s

running (0m18.0s), 02/08 VUs, 356 complete and 0 interrupted iterations
messaging_health   [  40% ] 02/08 VUs  18.0s/45s  20.00 iters/s

running (0m19.0s), 02/08 VUs, 376 complete and 0 interrupted iterations
messaging_health   [  42% ] 02/08 VUs  19.0s/45s  20.00 iters/s

running (0m20.0s), 02/08 VUs, 396 complete and 0 interrupted iterations
messaging_health   [  44% ] 02/08 VUs  20.0s/45s  20.00 iters/s

running (0m21.0s), 02/08 VUs, 416 complete and 0 interrupted iterations
messaging_health   [  47% ] 02/08 VUs  21.0s/45s  20.00 iters/s

running (0m22.0s), 02/08 VUs, 436 complete and 0 interrupted iterations
messaging_health   [  49% ] 02/08 VUs  22.0s/45s  20.00 iters/s

running (0m23.0s), 02/08 VUs, 456 complete and 0 interrupted iterations
messaging_health   [  51% ] 02/08 VUs  23.0s/45s  20.00 iters/s

running (0m24.0s), 02/08 VUs, 476 complete and 0 interrupted iterations
messaging_health   [  53% ] 02/08 VUs  24.0s/45s  20.00 iters/s

running (0m25.0s), 02/08 VUs, 496 complete and 0 interrupted iterations
messaging_health   [  56% ] 02/08 VUs  25.0s/45s  20.00 iters/s

running (0m26.0s), 02/08 VUs, 516 complete and 0 interrupted iterations
messaging_health   [  58% ] 02/08 VUs  26.0s/45s  20.00 iters/s

running (0m27.0s), 02/08 VUs, 536 complete and 0 interrupted iterations
messaging_health   [  60% ] 02/08 VUs  27.0s/45s  20.00 iters/s

running (0m28.0s), 02/08 VUs, 556 complete and 0 interrupted iterations
messaging_health   [  62% ] 02/08 VUs  28.0s/45s  20.00 iters/s

running (0m29.0s), 02/08 VUs, 576 complete and 0 interrupted iterations
messaging_health   [  64% ] 02/08 VUs  29.0s/45s  20.00 iters/s

running (0m30.0s), 02/08 VUs, 596 complete and 0 interrupted iterations
messaging_health   [  67% ] 02/08 VUs  30.0s/45s  20.00 iters/s

running (0m31.0s), 02/08 VUs, 616 complete and 0 interrupted iterations
messaging_health   [  69% ] 02/08 VUs  31.0s/45s  20.00 iters/s

running (0m32.0s), 02/08 VUs, 636 complete and 0 interrupted iterations
messaging_health   [  71% ] 02/08 VUs  32.0s/45s  20.00 iters/s

running (0m33.0s), 04/08 VUs, 654 complete and 0 interrupted iterations
messaging_health   [  73% ] 04/08 VUs  33.0s/45s  20.00 iters/s

running (0m34.0s), 02/08 VUs, 676 complete and 0 interrupted iterations
messaging_health   [  76% ] 02/08 VUs  34.0s/45s  20.00 iters/s

running (0m35.0s), 02/08 VUs, 696 complete and 0 interrupted iterations
messaging_health   [  78% ] 02/08 VUs  35.0s/45s  20.00 iters/s

running (0m36.0s), 07/09 VUs, 710 complete and 0 interrupted iterations
messaging_health   [  80% ] 07/09 VUs  36.0s/45s  20.00 iters/s

running (0m37.0s), 02/10 VUs, 734 complete and 0 interrupted iterations
messaging_health   [  82% ] 02/10 VUs  37.0s/45s  20.00 iters/s

running (0m38.0s), 02/10 VUs, 754 complete and 0 interrupted iterations
messaging_health   [  84% ] 02/10 VUs  38.0s/45s  20.00 iters/s

running (0m39.0s), 02/10 VUs, 774 complete and 0 interrupted iterations
messaging_health   [  87% ] 02/10 VUs  39.0s/45s  20.00 iters/s

running (0m40.0s), 02/10 VUs, 794 complete and 0 interrupted iterations
messaging_health   [  89% ] 02/10 VUs  40.0s/45s  20.00 iters/s

running (0m41.0s), 02/10 VUs, 814 complete and 0 interrupted iterations
messaging_health   [  91% ] 02/10 VUs  41.0s/45s  20.00 iters/s

running (0m42.0s), 02/10 VUs, 834 complete and 0 interrupted iterations
messaging_health   [  93% ] 02/10 VUs  42.0s/45s  20.00 iters/s

running (0m43.0s), 02/10 VUs, 854 complete and 0 interrupted iterations
messaging_health   [  96% ] 02/10 VUs  43.0s/45s  20.00 iters/s

running (0m44.0s), 05/10 VUs, 872 complete and 0 interrupted iterations
messaging_health   [  98% ] 05/10 VUs  44.0s/45s  20.00 iters/s

running (0m45.0s), 02/11 VUs, 893 complete and 0 interrupted iterations
messaging_health   [ 100% ] 02/11 VUs  45.0s/45s  20.00 iters/s


  █ THRESHOLDS 

    errors
    ✓ 'rate<0.02' rate=0.00%

    http_req_duration
    ✓ 'p(95)<500' p(95)=123.93ms
    ✓ 'p(99)<2000' p(99)=374.2ms
    ✓ 'p(100)<8000' p(100)=791.24ms

    http_req_failed
    ✓ 'rate<0.02' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 896     19.859797/s
    checks_succeeded...: 100.00% 896 out of 896
    checks_failed......: 0.00%   0 out of 896

    ✓ messaging health

    CUSTOM
    errors.........................: 0.00%  0 out of 896

    HTTP
    http_req_duration..............: avg=32.96ms  min=7.03ms   med=13.54ms  max=791.24ms p(90)=49ms     p(95)=123.93ms
      { expected_response:true }...: avg=32.96ms  min=7.03ms   med=13.54ms  max=791.24ms p(90)=49ms     p(95)=123.93ms
    http_req_failed................: 0.00%  0 out of 896
    http_reqs......................: 896    19.859797/s

    EXECUTION
    dropped_iterations.............: 5      0.110825/s
    iteration_duration.............: avg=133.97ms min=107.24ms med=114.37ms max=891.84ms p(90)=149.34ms p(95)=224.51ms
    iterations.....................: 896    19.859797/s
    vus............................: 2      min=2        max=7 
    vus_max........................: 11     min=7        max=11

    NETWORK
    data_received..................: 129 kB 2.9 kB/s
    data_sent......................: 53 kB  1.2 kB/s




running (0m45.1s), 00/11 VUs, 896 complete and 0 interrupted iterations
messaging_health ✓ [ 100% ] 00/11 VUs  45s  20.00 iters/s
```

## k6: media-health

`k6-media-health.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-media-health.js
        output: -

     scenarios: (100.00%) 1 scenario, 40 max VUs, 1m15s max duration (incl. graceful stop):
              * media_health: 15.00 iterations/s for 45s (maxVUs: 6-40, gracefulStop: 30s)


running (0m01.0s), 02/06 VUs, 13 complete and 0 interrupted iterations
media_health   [   2% ] 02/06 VUs  01.0s/45s  15.00 iters/s

running (0m02.0s), 01/06 VUs, 29 complete and 0 interrupted iterations
media_health   [   4% ] 01/06 VUs  02.0s/45s  15.00 iters/s

running (0m03.0s), 01/06 VUs, 44 complete and 0 interrupted iterations
media_health   [   7% ] 01/06 VUs  03.0s/45s  15.00 iters/s

running (0m04.0s), 03/06 VUs, 57 complete and 0 interrupted iterations
media_health   [   9% ] 03/06 VUs  04.0s/45s  15.00 iters/s

running (0m05.0s), 01/06 VUs, 74 complete and 0 interrupted iterations
media_health   [  11% ] 01/06 VUs  05.0s/45s  15.00 iters/s

running (0m06.0s), 01/06 VUs, 89 complete and 0 interrupted iterations
media_health   [  13% ] 01/06 VUs  06.0s/45s  15.00 iters/s

running (0m07.0s), 01/06 VUs, 104 complete and 0 interrupted iterations
media_health   [  16% ] 01/06 VUs  07.0s/45s  15.00 iters/s

running (0m08.0s), 01/06 VUs, 119 complete and 0 interrupted iterations
media_health   [  18% ] 01/06 VUs  08.0s/45s  15.00 iters/s

running (0m09.0s), 01/06 VUs, 134 complete and 0 interrupted iterations
media_health   [  20% ] 01/06 VUs  09.0s/45s  15.00 iters/s

running (0m10.0s), 01/06 VUs, 149 complete and 0 interrupted iterations
media_health   [  22% ] 01/06 VUs  10.0s/45s  15.00 iters/s

running (0m11.0s), 01/06 VUs, 164 complete and 0 interrupted iterations
media_health   [  24% ] 01/06 VUs  11.0s/45s  15.00 iters/s

running (0m12.0s), 01/06 VUs, 179 complete and 0 interrupted iterations
media_health   [  27% ] 01/06 VUs  12.0s/45s  15.00 iters/s

running (0m13.0s), 01/06 VUs, 194 complete and 0 interrupted iterations
media_health   [  29% ] 01/06 VUs  13.0s/45s  15.00 iters/s

running (0m14.0s), 02/06 VUs, 208 complete and 0 interrupted iterations
media_health   [  31% ] 02/06 VUs  14.0s/45s  15.00 iters/s

running (0m15.0s), 01/06 VUs, 224 complete and 0 interrupted iterations
media_health   [  33% ] 01/06 VUs  15.0s/45s  15.00 iters/s

running (0m16.0s), 01/06 VUs, 239 complete and 0 interrupted iterations
media_health   [  36% ] 01/06 VUs  16.0s/45s  15.00 iters/s

running (0m17.0s), 01/06 VUs, 254 complete and 0 interrupted iterations
media_health   [  38% ] 01/06 VUs  17.0s/45s  15.00 iters/s

running (0m18.0s), 01/06 VUs, 269 complete and 0 interrupted iterations
media_health   [  40% ] 01/06 VUs  18.0s/45s  15.00 iters/s

running (0m19.0s), 02/06 VUs, 283 complete and 0 interrupted iterations
media_health   [  42% ] 02/06 VUs  19.0s/45s  15.00 iters/s

running (0m20.0s), 02/06 VUs, 298 complete and 0 interrupted iterations
media_health   [  44% ] 02/06 VUs  20.0s/45s  15.00 iters/s

running (0m21.0s), 02/06 VUs, 313 complete and 0 interrupted iterations
media_health   [  47% ] 02/06 VUs  21.0s/45s  15.00 iters/s

running (0m22.0s), 02/06 VUs, 328 complete and 0 interrupted iterations
media_health   [  49% ] 02/06 VUs  22.0s/45s  15.00 iters/s

running (0m23.0s), 01/06 VUs, 344 complete and 0 interrupted iterations
media_health   [  51% ] 01/06 VUs  23.0s/45s  15.00 iters/s

running (0m24.0s), 01/06 VUs, 359 complete and 0 interrupted iterations
media_health   [  53% ] 01/06 VUs  24.0s/45s  15.00 iters/s

running (0m25.0s), 02/06 VUs, 373 complete and 0 interrupted iterations
media_health   [  56% ] 02/06 VUs  25.0s/45s  15.00 iters/s

running (0m26.0s), 01/06 VUs, 389 complete and 0 interrupted iterations
media_health   [  58% ] 01/06 VUs  26.0s/45s  15.00 iters/s

running (0m27.0s), 01/06 VUs, 404 complete and 0 interrupted iterations
media_health   [  60% ] 01/06 VUs  27.0s/45s  15.00 iters/s

running (0m28.0s), 01/06 VUs, 419 complete and 0 interrupted iterations
media_health   [  62% ] 01/06 VUs  28.0s/45s  15.00 iters/s

running (0m29.0s), 01/06 VUs, 434 complete and 0 interrupted iterations
media_health   [  64% ] 01/06 VUs  29.0s/45s  15.00 iters/s

running (0m30.0s), 01/06 VUs, 449 complete and 0 interrupted iterations
media_health   [  67% ] 01/06 VUs  30.0s/45s  15.00 iters/s

running (0m31.0s), 01/06 VUs, 464 complete and 0 interrupted iterations
media_health   [  69% ] 01/06 VUs  31.0s/45s  15.00 iters/s

running (0m32.0s), 01/06 VUs, 479 complete and 0 interrupted iterations
media_health   [  71% ] 01/06 VUs  32.0s/45s  15.00 iters/s

running (0m33.0s), 01/06 VUs, 494 complete and 0 interrupted iterations
media_health   [  73% ] 01/06 VUs  33.0s/45s  15.00 iters/s

running (0m34.0s), 02/06 VUs, 508 complete and 0 interrupted iterations
media_health   [  76% ] 02/06 VUs  34.0s/45s  15.00 iters/s

running (0m35.0s), 02/06 VUs, 523 complete and 0 interrupted iterations
media_health   [  78% ] 02/06 VUs  35.0s/45s  15.00 iters/s

running (0m36.0s), 02/06 VUs, 538 complete and 0 interrupted iterations
media_health   [  80% ] 02/06 VUs  36.0s/45s  15.00 iters/s

running (0m37.0s), 01/06 VUs, 554 complete and 0 interrupted iterations
media_health   [  82% ] 01/06 VUs  37.0s/45s  15.00 iters/s

running (0m38.0s), 01/06 VUs, 569 complete and 0 interrupted iterations
media_health   [  84% ] 01/06 VUs  38.0s/45s  15.00 iters/s

running (0m39.0s), 02/06 VUs, 583 complete and 0 interrupted iterations
media_health   [  87% ] 02/06 VUs  39.0s/45s  15.00 iters/s

running (0m40.0s), 01/06 VUs, 599 complete and 0 interrupted iterations
media_health   [  89% ] 01/06 VUs  40.0s/45s  15.00 iters/s

running (0m41.0s), 01/06 VUs, 614 complete and 0 interrupted iterations
media_health   [  91% ] 01/06 VUs  41.0s/45s  15.00 iters/s

running (0m42.0s), 01/06 VUs, 629 complete and 0 interrupted iterations
media_health   [  93% ] 01/06 VUs  42.0s/45s  15.00 iters/s

running (0m43.0s), 01/06 VUs, 644 complete and 0 interrupted iterations
media_health   [  96% ] 01/06 VUs  43.0s/45s  15.00 iters/s

running (0m44.0s), 01/06 VUs, 659 complete and 0 interrupted iterations
media_health   [  98% ] 01/06 VUs  44.0s/45s  15.00 iters/s

running (0m45.0s), 01/06 VUs, 674 complete and 0 interrupted iterations
media_health   [ 100% ] 01/06 VUs  45.0s/45s  15.00 iters/s


  █ THRESHOLDS 

    errors
    ✓ 'rate<0.05' rate=0.00%

    http_req_duration
    ✓ 'p(95)<600' p(95)=52.97ms
    ✓ 'p(99)<2500' p(99)=161.13ms
    ✓ 'p(100)<10000' p(100)=302.8ms

    http_req_failed
    ✓ 'rate<0.05' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 675     14.98487/s
    checks_succeeded...: 100.00% 675 out of 675
    checks_failed......: 0.00%   0 out of 675

    ✓ media health

    CUSTOM
    errors.........................: 0.00%  0 out of 675

    HTTP
    http_req_duration..............: avg=23.11ms  min=7.86ms   med=15.45ms  max=302.8ms  p(90)=40.11ms  p(95)=52.97ms
      { expected_response:true }...: avg=23.11ms  min=7.86ms   med=15.45ms  max=302.8ms  p(90)=40.11ms  p(95)=52.97ms
    http_req_failed................: 0.00%  0 out of 675
    http_reqs......................: 675    14.98487/s

    EXECUTION
    iteration_duration.............: avg=124.23ms min=108.54ms med=116.42ms max=403.44ms p(90)=141.14ms p(95)=154.2ms
    iterations.....................: 675    14.98487/s
    vus............................: 1      min=1        max=3
    vus_max........................: 6      min=6        max=6

    NETWORK
    data_received..................: 118 kB 2.6 kB/s
    data_sent......................: 36 kB  796 B/s




running (0m45.0s), 00/06 VUs, 675 complete and 0 interrupted iterations
media_health ✓ [ 100% ] 00/06 VUs  45s  15.00 iters/s
```

## k6: notification-health

`k6-notification-health.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-notification-health.js
        output: -

     scenarios: (100.00%) 1 scenario, 40 max VUs, 1m15s max duration (incl. graceful stop):
              * notification_health: 15.00 iterations/s for 45s (maxVUs: 6-40, gracefulStop: 30s)


running (0m01.0s), 10/11 VUs, 0 complete and 0 interrupted iterations
notification_health   [   2% ] 10/11 VUs  01.0s/45s  15.00 iters/s

running (0m02.0s), 16/16 VUs, 4 complete and 0 interrupted iterations
notification_health   [   4% ] 16/16 VUs  02.0s/45s  15.00 iters/s

running (0m03.0s), 21/22 VUs, 8 complete and 0 interrupted iterations
notification_health   [   7% ] 21/22 VUs  03.0s/45s  15.00 iters/s

running (0m04.0s), 11/24 VUs, 31 complete and 0 interrupted iterations
notification_health   [   9% ] 11/24 VUs  04.0s/45s  15.00 iters/s

running (0m05.0s), 02/24 VUs, 55 complete and 0 interrupted iterations
notification_health   [  11% ] 02/24 VUs  05.0s/45s  15.00 iters/s

running (0m06.0s), 06/24 VUs, 66 complete and 0 interrupted iterations
notification_health   [  13% ] 06/24 VUs  06.0s/45s  15.00 iters/s

running (0m07.0s), 16/24 VUs, 71 complete and 0 interrupted iterations
notification_health   [  16% ] 16/24 VUs  07.0s/45s  15.00 iters/s

running (0m08.0s), 02/24 VUs, 100 complete and 0 interrupted iterations
notification_health   [  18% ] 02/24 VUs  08.0s/45s  15.00 iters/s

running (0m09.0s), 02/24 VUs, 115 complete and 0 interrupted iterations
notification_health   [  20% ] 02/24 VUs  09.0s/45s  15.00 iters/s

running (0m10.0s), 01/24 VUs, 131 complete and 0 interrupted iterations
notification_health   [  22% ] 01/24 VUs  10.0s/45s  15.00 iters/s

running (0m11.0s), 02/24 VUs, 145 complete and 0 interrupted iterations
notification_health   [  24% ] 02/24 VUs  11.0s/45s  15.00 iters/s

running (0m12.0s), 13/24 VUs, 149 complete and 0 interrupted iterations
notification_health   [  27% ] 13/24 VUs  12.0s/45s  15.00 iters/s

running (0m13.0s), 21/25 VUs, 155 complete and 0 interrupted iterations
notification_health   [  29% ] 21/25 VUs  13.0s/45s  15.00 iters/s

running (0m14.0s), 02/25 VUs, 189 complete and 0 interrupted iterations
notification_health   [  31% ] 02/25 VUs  14.0s/45s  15.00 iters/s

running (0m15.0s), 01/25 VUs, 205 complete and 0 interrupted iterations
notification_health   [  33% ] 01/25 VUs  15.0s/45s  15.00 iters/s

running (0m16.0s), 02/25 VUs, 219 complete and 0 interrupted iterations
notification_health   [  36% ] 02/25 VUs  16.0s/45s  15.00 iters/s

running (0m17.0s), 01/25 VUs, 235 complete and 0 interrupted iterations
notification_health   [  38% ] 01/25 VUs  17.0s/45s  15.00 iters/s

running (0m18.0s), 01/25 VUs, 250 complete and 0 interrupted iterations
notification_health   [  40% ] 01/25 VUs  18.0s/45s  15.00 iters/s

running (0m19.0s), 02/25 VUs, 264 complete and 0 interrupted iterations
notification_health   [  42% ] 02/25 VUs  19.0s/45s  15.00 iters/s

running (0m20.0s), 02/25 VUs, 279 complete and 0 interrupted iterations
notification_health   [  44% ] 02/25 VUs  20.0s/45s  15.00 iters/s

running (0m21.0s), 11/25 VUs, 285 complete and 0 interrupted iterations
notification_health   [  47% ] 11/25 VUs  21.0s/45s  15.00 iters/s

running (0m22.0s), 23/25 VUs, 288 complete and 0 interrupted iterations
notification_health   [  49% ] 23/25 VUs  22.0s/45s  15.00 iters/s

running (0m23.0s), 28/30 VUs, 293 complete and 0 interrupted iterations
notification_health   [  51% ] 28/30 VUs  23.0s/45s  15.00 iters/s

running (0m24.0s), 29/30 VUs, 307 complete and 0 interrupted iterations
notification_health   [  53% ] 29/30 VUs  24.0s/45s  15.00 iters/s

running (0m25.0s), 28/31 VUs, 322 complete and 0 interrupted iterations
notification_health   [  56% ] 28/31 VUs  25.0s/45s  15.00 iters/s

running (0m26.0s), 30/32 VUs, 334 complete and 0 interrupted iterations
notification_health   [  58% ] 30/32 VUs  26.0s/45s  15.00 iters/s

running (0m27.0s), 32/33 VUs, 346 complete and 0 interrupted iterations
notification_health   [  60% ] 32/33 VUs  27.0s/45s  15.00 iters/s

running (0m28.0s), 36/37 VUs, 353 complete and 0 interrupted iterations
notification_health   [  62% ] 36/37 VUs  28.0s/45s  15.00 iters/s
time="2026-03-23T16:30:09-04:00" level=warning msg="Insufficient VUs, reached 40 active VUs and cannot initialize more" executor=constant-arrival-rate scenario=notification_health

running (0m29.0s), 30/40 VUs, 369 complete and 0 interrupted iterations
notification_health   [  64% ] 30/40 VUs  29.0s/45s  15.00 iters/s

running (0m30.0s), 01/40 VUs, 413 complete and 0 interrupted iterations
notification_health   [  67% ] 01/40 VUs  30.0s/45s  15.00 iters/s

running (0m31.0s), 02/40 VUs, 427 complete and 0 interrupted iterations
notification_health   [  69% ] 02/40 VUs  31.0s/45s  15.00 iters/s

running (0m32.0s), 02/40 VUs, 442 complete and 0 interrupted iterations
notification_health   [  71% ] 02/40 VUs  32.0s/45s  15.00 iters/s

running (0m33.0s), 01/40 VUs, 458 complete and 0 interrupted iterations
notification_health   [  73% ] 01/40 VUs  33.0s/45s  15.00 iters/s

running (0m34.0s), 01/40 VUs, 473 complete and 0 interrupted iterations
notification_health   [  76% ] 01/40 VUs  34.0s/45s  15.00 iters/s

running (0m35.0s), 01/40 VUs, 488 complete and 0 interrupted iterations
notification_health   [  78% ] 01/40 VUs  35.0s/45s  15.00 iters/s

running (0m36.0s), 02/40 VUs, 502 complete and 0 interrupted iterations
notification_health   [  80% ] 02/40 VUs  36.0s/45s  15.00 iters/s

running (0m37.0s), 01/40 VUs, 518 complete and 0 interrupted iterations
notification_health   [  82% ] 01/40 VUs  37.0s/45s  15.00 iters/s

running (0m38.0s), 02/40 VUs, 532 complete and 0 interrupted iterations
notification_health   [  84% ] 02/40 VUs  38.0s/45s  15.00 iters/s

running (0m39.0s), 01/40 VUs, 548 complete and 0 interrupted iterations
notification_health   [  87% ] 01/40 VUs  39.0s/45s  15.00 iters/s

running (0m40.0s), 01/40 VUs, 563 complete and 0 interrupted iterations
notification_health   [  89% ] 01/40 VUs  40.0s/45s  15.00 iters/s

running (0m41.0s), 02/40 VUs, 577 complete and 0 interrupted iterations
notification_health   [  91% ] 02/40 VUs  41.0s/45s  15.00 iters/s

running (0m42.0s), 01/40 VUs, 593 complete and 0 interrupted iterations
notification_health   [  93% ] 01/40 VUs  42.0s/45s  15.00 iters/s

running (0m43.0s), 01/40 VUs, 608 complete and 0 interrupted iterations
notification_health   [  96% ] 01/40 VUs  43.0s/45s  15.00 iters/s

running (0m44.0s), 01/40 VUs, 623 complete and 0 interrupted iterations
notification_health   [  98% ] 01/40 VUs  44.0s/45s  15.00 iters/s

running (0m45.0s), 01/40 VUs, 638 complete and 0 interrupted iterations
notification_health   [ 100% ] 01/40 VUs  45.0s/45s  15.00 iters/s


  █ THRESHOLDS 

    errors
    ✓ 'rate<0.05' rate=2.34%

    http_req_duration
    ✗ 'p(95)<600' p(95)=3.13s
    ✗ 'p(99)<2500' p(99)=5.04s
    ✓ 'p(100)<10000' p(100)=5.19s

    http_req_failed
    ✓ 'rate<0.05' rate=2.34%


  █ TOTAL RESULTS 

    checks_total.......: 639    14.177676/s
    checks_succeeded...: 97.65% 624 out of 639
    checks_failed......: 2.34%  15 out of 639

    ✗ notification health
      ↳  97% — ✓ 624 / ✗ 15

    CUSTOM
    errors.........................: 2.34%  15 out of 639

    HTTP
    http_req_duration..............: avg=588.77ms min=8.54ms   med=74.41ms  max=5.19s p(90)=2.18s p(95)=3.13s
      { expected_response:true }...: avg=481.45ms min=8.54ms   med=69.44ms  max=4.7s  p(90)=1.58s p(95)=2.59s
    http_req_failed................: 2.34%  15 out of 639
    http_reqs......................: 639    14.177676/s

    EXECUTION
    dropped_iterations.............: 36     0.798742/s
    iteration_duration.............: avg=690.3ms  min=109.88ms med=174.73ms max=5.29s p(90)=2.28s p(95)=3.23s
    iterations.....................: 639    14.177676/s
    vus............................: 1      min=1         max=36
    vus_max........................: 40     min=11        max=40

    NETWORK
    data_received..................: 198 kB 4.4 kB/s
    data_sent......................: 95 kB  2.1 kB/s




running (0m45.1s), 00/40 VUs, 639 complete and 0 interrupted iterations
notification_health ✓ [ 100% ] 00/40 VUs  45s  15.00 iters/s
time="2026-03-23T16:30:26-04:00" level=error msg="thresholds on metrics 'http_req_duration' have been crossed"
(exit non-zero)
```

## k6: event-layer-adversarial

`k6-event-layer-adversarial.js`

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 

     execution: local
        script: /Users/tom/Off-Campus-Housing-Tracker/scripts/load/k6-event-layer-adversarial.js
        output: -

     scenarios: (100.00%) 1 scenario, 6 max VUs, 1m15s max duration (incl. graceful stop):
              * default: 6 looping VUs for 45s (gracefulStop: 30s)


running (0m01.0s), 6/6 VUs, 24 complete and 0 interrupted iterations
default   [   2% ] 6 VUs  01.0s/45s

running (0m02.0s), 6/6 VUs, 24 complete and 0 interrupted iterations
default   [   4% ] 6 VUs  02.0s/45s

running (0m03.0s), 6/6 VUs, 24 complete and 0 interrupted iterations
default   [   7% ] 6 VUs  03.0s/45s

running (0m04.0s), 6/6 VUs, 24 complete and 0 interrupted iterations
default   [   9% ] 6 VUs  04.0s/45s

running (0m05.0s), 6/6 VUs, 24 complete and 0 interrupted iterations
default   [  11% ] 6 VUs  05.0s/45s

running (0m06.0s), 6/6 VUs, 24 complete and 0 interrupted iterations
default   [  13% ] 6 VUs  06.0s/45s

running (0m07.0s), 6/6 VUs, 42 complete and 0 interrupted iterations
default   [  16% ] 6 VUs  07.0s/45s

running (0m08.0s), 6/6 VUs, 96 complete and 0 interrupted iterations
default   [  18% ] 6 VUs  08.0s/45s

running (0m09.0s), 6/6 VUs, 177 complete and 0 interrupted iterations
default   [  20% ] 6 VUs  09.0s/45s

running (0m10.0s), 6/6 VUs, 255 complete and 0 interrupted iterations
default   [  22% ] 6 VUs  10.0s/45s

running (0m11.0s), 6/6 VUs, 315 complete and 0 interrupted iterations
default   [  24% ] 6 VUs  11.0s/45s

running (0m12.0s), 6/6 VUs, 381 complete and 0 interrupted iterations
default   [  27% ] 6 VUs  12.0s/45s

running (0m13.0s), 6/6 VUs, 462 complete and 0 interrupted iterations
default   [  29% ] 6 VUs  13.0s/45s

running (0m14.0s), 6/6 VUs, 542 complete and 0 interrupted iterations
default   [  31% ] 6 VUs  14.0s/45s

running (0m15.0s), 6/6 VUs, 624 complete and 0 interrupted iterations
default   [  33% ] 6 VUs  15.0s/45s

running (0m16.0s), 6/6 VUs, 693 complete and 0 interrupted iterations
default   [  36% ] 6 VUs  16.0s/45s

running (0m17.0s), 6/6 VUs, 762 complete and 0 interrupted iterations
default   [  38% ] 6 VUs  17.0s/45s

running (0m18.0s), 6/6 VUs, 812 complete and 0 interrupted iterations
default   [  40% ] 6 VUs  18.0s/45s

running (0m19.0s), 6/6 VUs, 894 complete and 0 interrupted iterations
default   [  42% ] 6 VUs  19.0s/45s

running (0m20.0s), 6/6 VUs, 968 complete and 0 interrupted iterations
default   [  44% ] 6 VUs  20.0s/45s

running (0m21.0s), 6/6 VUs, 1017 complete and 0 interrupted iterations
default   [  47% ] 6 VUs  21.0s/45s

running (0m22.0s), 6/6 VUs, 1076 complete and 0 interrupted iterations
default   [  49% ] 6 VUs  22.0s/45s

running (0m23.0s), 6/6 VUs, 1102 complete and 0 interrupted iterations
default   [  51% ] 6 VUs  23.0s/45s

running (0m24.0s), 6/6 VUs, 1136 complete and 0 interrupted iterations
default   [  53% ] 6 VUs  24.0s/45s

running (0m25.0s), 6/6 VUs, 1196 complete and 0 interrupted iterations
default   [  56% ] 6 VUs  25.0s/45s

running (0m26.0s), 6/6 VUs, 1275 complete and 0 interrupted iterations
default   [  58% ] 6 VUs  26.0s/45s

running (0m27.0s), 6/6 VUs, 1320 complete and 0 interrupted iterations
default   [  60% ] 6 VUs  27.0s/45s

running (0m28.0s), 6/6 VUs, 1400 complete and 0 interrupted iterations
default   [  62% ] 6 VUs  28.0s/45s

running (0m29.0s), 6/6 VUs, 1480 complete and 0 interrupted iterations
default   [  64% ] 6 VUs  29.0s/45s

running (0m30.0s), 6/6 VUs, 1535 complete and 0 interrupted iterations
default   [  67% ] 6 VUs  30.0s/45s

running (0m31.0s), 6/6 VUs, 1603 complete and 0 interrupted iterations
default   [  69% ] 6 VUs  31.0s/45s

running (0m32.0s), 6/6 VUs, 1672 complete and 0 interrupted iterations
default   [  71% ] 6 VUs  32.0s/45s

running (0m33.0s), 6/6 VUs, 1747 complete and 0 interrupted iterations
default   [  73% ] 6 VUs  33.0s/45s

running (0m34.0s), 6/6 VUs, 1801 complete and 0 interrupted iterations
default   [  76% ] 6 VUs  34.0s/45s

running (0m35.0s), 6/6 VUs, 1856 complete and 0 interrupted iterations
default   [  78% ] 6 VUs  35.0s/45s

running (0m36.0s), 6/6 VUs, 1933 complete and 0 interrupted iterations
default   [  80% ] 6 VUs  36.0s/45s

running (0m37.0s), 6/6 VUs, 2012 complete and 0 interrupted iterations
default   [  82% ] 6 VUs  37.0s/45s

running (0m38.0s), 6/6 VUs, 2096 complete and 0 interrupted iterations
default   [  84% ] 6 VUs  38.0s/45s

running (0m39.0s), 6/6 VUs, 2165 complete and 0 interrupted iterations
default   [  87% ] 6 VUs  39.0s/45s

running (0m40.0s), 6/6 VUs, 2250 complete and 0 interrupted iterations
default   [  89% ] 6 VUs  40.0s/45s

running (0m41.0s), 6/6 VUs, 2332 complete and 0 interrupted iterations
default   [  91% ] 6 VUs  41.0s/45s

running (0m42.0s), 6/6 VUs, 2417 complete and 0 interrupted iterations
default   [  93% ] 6 VUs  42.0s/45s

running (0m43.0s), 6/6 VUs, 2494 complete and 0 interrupted iterations
default   [  96% ] 6 VUs  43.0s/45s

running (0m44.0s), 6/6 VUs, 2578 complete and 0 interrupted iterations
default   [  98% ] 6 VUs  44.0s/45s

running (0m45.0s), 6/6 VUs, 2642 complete and 0 interrupted iterations
default   [ 100% ] 6 VUs  45.0s/45s


  █ THRESHOLDS 

    event_layer_adversarial_accepted
    ✓ 'rate>0.70' rate=100.00%

    http_req_duration
    ✓ 'p(95)<2500' p(95)=108.87ms
    ✓ 'p(99)<6000' p(99)=294.38ms
    ✓ 'p(100)<15000' p(100)=6.1s

    http_req_failed
    ✓ 'rate<0.15' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 2648    58.691107/s
    checks_succeeded...: 100.00% 2648 out of 2648
    checks_failed......: 0.00%   0 out of 2648

    ✓ gw
    ✓ msg
    ✓ book
    ✓ long_q
    ✓ bad_json

    CUSTOM
    event_layer_adversarial_accepted...: 100.00% 878 out of 878

    HTTP
    http_req_duration..................: avg=40.8ms   min=1.52ms  med=12.37ms max=6.1s  p(90)=54.65ms  p(95)=108.87ms
      { expected_response:true }.......: avg=40.8ms   min=1.52ms  med=12.37ms max=6.1s  p(90)=54.65ms  p(95)=108.87ms
    http_req_failed....................: 0.00%   0 out of 2648
    http_reqs..........................: 2648    58.691107/s

    EXECUTION
    iteration_duration.................: avg=102.07ms min=25.68ms med=79.96ms max=6.16s p(90)=128.36ms p(95)=175.66ms
    iterations.........................: 2648    58.691107/s
    vus................................: 6       min=6          max=6
    vus_max............................: 6       min=6          max=6

    NETWORK
    data_received......................: 289 kB  6.4 kB/s
    data_sent..........................: 1.7 MB  38 kB/s




running (0m45.1s), 0/6 VUs, 2648 complete and 0 interrupted iterations
default ✓ [ 100% ] 6 VUs  45s
```

---
End of k6 section.
