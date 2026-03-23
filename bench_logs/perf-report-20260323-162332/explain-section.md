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
