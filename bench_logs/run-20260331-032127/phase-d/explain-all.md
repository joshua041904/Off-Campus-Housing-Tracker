# EXPLAIN ANALYZE — all housing databases

Generated: 2026-03-31T07:53:15Z
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
 Limit  (cost=0.28..8.29 rows=1 width=56) (actual time=0.757..0.758 rows=0 loops=1)
   Output: id, email
   Buffers: shared hit=5
   ->  Index Scan using idx_users_email on auth.users  (cost=0.28..8.29 rows=1 width=56) (actual time=0.756..0.756 rows=0 loops=1)
         Output: id, email
         Index Cond: (users.email = '__explain_probe_nonexistent__@example.com'::citext)
         Buffers: shared hit=5
 Planning:
   Buffers: shared hit=110
 Planning Time: 4.124 ms
 Execution Time: 5.385 ms
(11 rows)

```

## listings (port 5442, database `listings`)

```
                                                                   QUERY PLAN                                                                   
------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=14.57..14.57 rows=1 width=134) (actual time=1.332..1.333 rows=6 loops=1)
   Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
   Buffers: shared hit=7
   ->  Sort  (cost=14.57..14.57 rows=1 width=134) (actual time=1.331..1.332 rows=6 loops=1)
         Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
         Sort Key: listings.created_at DESC
         Sort Method: quicksort  Memory: 26kB
         Buffers: shared hit=7
         ->  Seq Scan on listings.listings  (cost=0.00..14.56 rows=1 width=134) (actual time=1.279..1.284 rows=6 loops=1)
               Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, (status)::text, created_at
               Filter: ((listings.deleted_at IS NULL) AND ((listings.status)::text = 'active'::text))
               Buffers: shared hit=4
 Planning:
   Buffers: shared hit=428
 Planning Time: 4.170 ms
 Execution Time: 1.411 ms
(16 rows)

                                                                                                  QUERY PLAN                                                                                                   
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=15.87..15.87 rows=1 width=134)
   Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
   ->  Sort  (cost=15.87..15.87 rows=1 width=134)
         Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, ((status)::text), created_at
         Sort Key: listings.created_at DESC
         ->  Seq Scan on listings.listings  (cost=0.00..15.86 rows=1 width=134)
               Output: id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, (status)::text, created_at
               Filter: ((listings.deleted_at IS NULL) AND ((listings.title ~~* '%explain-probe%'::text) OR (listings.description ~~* '%explain-probe%'::text)) AND ((listings.status)::text = 'active'::text))
 Planning:
   Buffers: shared hit=1
(10 rows)

```

## booking (port 5443, database `bookings`)

```
                                                       QUERY PLAN                                                        
-------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=3.64..3.75 rows=44 width=76) (actual time=1.424..1.436 rows=48 loops=1)
   Output: id, listing_id, tenant_id, landlord_id, status, created_at
   Buffers: shared hit=5
   ->  Sort  (cost=3.64..3.75 rows=44 width=76) (actual time=1.422..1.428 rows=48 loops=1)
         Output: id, listing_id, tenant_id, landlord_id, status, created_at
         Sort Key: bookings.created_at DESC
         Sort Method: quicksort  Memory: 31kB
         Buffers: shared hit=5
         ->  Seq Scan on booking.bookings  (cost=0.00..2.44 rows=44 width=76) (actual time=0.028..0.569 rows=48 loops=1)
               Output: id, listing_id, tenant_id, landlord_id, status, created_at
               Buffers: shared hit=2
 Planning:
   Buffers: shared hit=252
 Planning Time: 15.744 ms
 Execution Time: 1.545 ms
(15 rows)

```

## messaging (port 5444, database `messaging`)

```
                                                         QUERY PLAN                                                         
----------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=6.49..6.62 rows=50 width=78) (actual time=1.753..1.758 rows=50 loops=1)
   Output: id, conversation_id, sender_id, body, created_at
   Buffers: shared hit=5 dirtied=1
   ->  Sort  (cost=6.49..6.75 rows=104 width=78) (actual time=1.751..1.754 rows=50 loops=1)
         Output: id, conversation_id, sender_id, body, created_at
         Sort Key: messages.created_at DESC
         Sort Method: quicksort  Memory: 38kB
         Buffers: shared hit=5 dirtied=1
         ->  Seq Scan on messaging.messages  (cost=0.00..3.04 rows=104 width=78) (actual time=0.765..1.603 rows=98 loops=1)
               Output: id, conversation_id, sender_id, body, created_at
               Filter: (messages.deleted_at IS NULL)
               Buffers: shared hit=2 dirtied=1
 Planning:
   Buffers: shared hit=121
 Planning Time: 8.782 ms
 Execution Time: 1.873 ms
(16 rows)

                                                                            QUERY PLAN                                                                            
------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=4.13..11.24 rows=3 width=40) (actual time=0.319..0.319 rows=0 loops=1)
   Output: conversation_id, user_id, joined_at
   Buffers: shared hit=2
   ->  Bitmap Heap Scan on messaging.conversation_participants  (cost=4.13..11.24 rows=3 width=40) (actual time=0.318..0.318 rows=0 loops=1)
         Output: conversation_id, user_id, joined_at
         Recheck Cond: ((conversation_participants.user_id = '00000000-0000-0000-0000-000000000001'::uuid) AND (NOT conversation_participants.deleted))
         Buffers: shared hit=2
         ->  Bitmap Index Scan on idx_conversation_participants_user_archived_deleted  (cost=0.00..4.13 rows=3 width=0) (actual time=0.316..0.316 rows=0 loops=1)
               Index Cond: (conversation_participants.user_id = '00000000-0000-0000-0000-000000000001'::uuid)
               Buffers: shared hit=2
 Planning:
   Buffers: shared hit=72
 Planning Time: 0.785 ms
 Execution Time: 0.359 ms
(14 rows)

```

## notification (port 5445, database `notification`)

```
                                                             QUERY PLAN                                                             
------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=32.91..33.03 rows=50 width=76) (actual time=0.160..0.162 rows=8 loops=1)
   Output: id, user_id, event_type, status, created_at
   Buffers: shared hit=4 dirtied=1
   ->  Sort  (cost=32.91..34.23 rows=530 width=76) (actual time=0.159..0.160 rows=8 loops=1)
         Output: id, user_id, event_type, status, created_at
         Sort Key: notifications.created_at DESC
         Sort Method: quicksort  Memory: 26kB
         Buffers: shared hit=4 dirtied=1
         ->  Seq Scan on notification.notifications  (cost=0.00..15.30 rows=530 width=76) (actual time=0.091..0.093 rows=8 loops=1)
               Output: id, user_id, event_type, status, created_at
               Buffers: shared hit=1 dirtied=1
 Planning:
   Buffers: shared hit=160
 Planning Time: 6.410 ms
 Execution Time: 0.216 ms
(15 rows)

```

## trust (port 5446, database `trust`)

```
                                                         QUERY PLAN                                                          
-----------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=29.02..29.14 rows=50 width=60) (actual time=0.073..0.074 rows=4 loops=1)
   Output: id, listing_id, reporter_id, status, created_at
   Buffers: shared hit=4
   ->  Sort  (cost=29.02..30.12 rows=440 width=60) (actual time=0.071..0.072 rows=4 loops=1)
         Output: id, listing_id, reporter_id, status, created_at
         Sort Key: listing_flags.created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=4
         ->  Seq Scan on trust.listing_flags  (cost=0.00..14.40 rows=440 width=60) (actual time=0.023..0.024 rows=4 loops=1)
               Output: id, listing_id, reporter_id, status, created_at
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=151
 Planning Time: 10.620 ms
 Execution Time: 0.116 ms
(15 rows)

```

## analytics (port 5447, database `analytics`)

```
                                                                 QUERY PLAN                                                                  
---------------------------------------------------------------------------------------------------------------------------------------------
 Index Scan using daily_metrics_pkey on analytics.daily_metrics  (cost=0.15..8.17 rows=1 width=28) (actual time=0.043..0.043 rows=0 loops=1)
   Output: date, new_users, new_listings, new_bookings, completed_bookings, messages_sent, listings_flagged
   Index Cond: (daily_metrics.date = CURRENT_DATE)
   Buffers: shared hit=1
 Planning:
   Buffers: shared hit=77
 Planning Time: 7.595 ms
 Execution Time: 0.358 ms
(8 rows)

                                                     QUERY PLAN                                                     
--------------------------------------------------------------------------------------------------------------------
 HashAggregate  (cost=17.20..19.20 rows=200 width=40) (actual time=0.007..0.008 rows=0 loops=1)
   Output: event_type, count(*)
   Group Key: events.event_type
   Batches: 1  Memory Usage: 40kB
   ->  Seq Scan on analytics.events  (cost=0.00..14.80 rows=480 width=32) (actual time=0.005..0.006 rows=0 loops=1)
         Output: id, event_type, event_version, payload, source_service, created_at, event_id
 Planning:
   Buffers: shared hit=122
 Planning Time: 3.755 ms
 Execution Time: 0.849 ms
(10 rows)

```

## media (port 5448, database `media`)

```
                                                        QUERY PLAN                                                         
---------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=4.47..4.59 rows=50 width=131) (actual time=0.171..0.177 rows=50 loops=1)
   Output: id, user_id, object_key, status, created_at
   Buffers: shared hit=5
   ->  Sort  (cost=4.47..4.62 rows=62 width=131) (actual time=0.170..0.172 rows=50 loops=1)
         Output: id, user_id, object_key, status, created_at
         Sort Key: media_files.created_at DESC
         Sort Method: quicksort  Memory: 41kB
         Buffers: shared hit=5
         ->  Seq Scan on media.media_files  (cost=0.00..2.62 rows=62 width=131) (actual time=0.016..0.028 rows=64 loops=1)
               Output: id, user_id, object_key, status, created_at
               Buffers: shared hit=2
 Planning:
   Buffers: shared hit=154
 Planning Time: 7.358 ms
 Execution Time: 1.026 ms
(15 rows)

```

---
End of EXPLAIN section.
