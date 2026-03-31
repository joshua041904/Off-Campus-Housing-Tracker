import { Router, type Request, type Response } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { cached, makePostKey, makePostsListKey, makeCommentsKey } from '../lib/cache.js'
import { pool } from '../lib/db.js'
import { kafka } from '@common/utils/kafka'
import { buildMetadata, sendMessagingEvent } from '../kafkaMessagingEvents.js'

let kafkaProducer: any = null
async function getKafkaProducer() {
  if (!kafkaProducer) {
    kafkaProducer = kafka.producer()
    await Promise.race([
      kafkaProducer.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Kafka connection timeout')), 5000),
      ),
    ])
  }
  return kafkaProducer
}

export default function forumRouter(redis: Redis | null, cpuCores: number) {
  const router: Router = Router()

  // GET /forum/posts - List posts (paginated, filterable by flair)
  router.get('/posts', async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const flair = req.query.flair as string | undefined
    const offset = (page - 1) * limit

    const cacheKey = makePostsListKey(page, limit, flair)
    const result = await cached(
      redis,
      cacheKey,
      60_000, // 1 minute cache
      async () => {
        try {
          const query = `
            SELECT 
              id, user_id, title, content, flair, upload_type, upvotes, downvotes,
              comment_count, is_pinned, is_locked, created_at, updated_at
            FROM forum.posts
            WHERE ($1::VARCHAR IS NULL OR flair = $1)
            ORDER BY is_pinned DESC, created_at DESC
            LIMIT $2 OFFSET $3
          `
          const { rows } = await pool.query(query, [flair || null, limit, offset])

          // Get total count
          const countQuery = `
            SELECT COUNT(*) as total
            FROM forum.posts
            WHERE ($1::VARCHAR IS NULL OR flair = $1)
          `
          const { rows: countRows } = await pool.query(countQuery, [flair || null])
          const total = parseInt(countRows[0].total, 10)

          return {
            posts: rows,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          }
        } catch (err) {
          console.error('[messaging] Error fetching posts:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /forum/posts - Create post
  router.post('/posts', async (req: AuthedRequest, res: Response) => {
    const { title, content, flair, upload_type } = req.body
    const userId = req.userId

    if (!title || !content || !flair) {
      return res.status(400).json({ error: 'title, content, and flair required' })
    }

    // Validate upload_type
    const validUploadTypes = ['text', 'image', 'video', 'link', 'poll']
    const postUploadType = upload_type && validUploadTypes.includes(upload_type) ? upload_type : 'text'

    try {
      // Insert post into database
      const insertQuery = `
        INSERT INTO forum.posts (user_id, title, content, flair, upload_type)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, user_id, title, content, flair, upload_type, upvotes, downvotes,
                  comment_count, is_pinned, is_locked, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [userId, title, content, flair, postUploadType])
      const post = rows[0]

      const producer = await getKafkaProducer()
      const createdAt =
        post.created_at instanceof Date ? post.created_at.toISOString() : String(post.created_at)
      await sendMessagingEvent(producer, post.id, {
        metadata: buildMetadata({
          event_type: 'PostCreated',
          aggregate_id: post.id,
          aggregate_type: 'post',
        }),
        post_id: post.id,
        user_id: userId,
        title,
        content,
        flair,
        created_at: createdAt,
      })

      res.status(201).json(post)
    } catch (err: any) {
      console.error('[messaging] Error creating post:', err)
      res.status(500).json({ error: 'Failed to create post' })
    }
  })

  // POST /forum/posts/:postId/attachments - Add attachment to post (MUST be before /posts/:postId)
  router.post('/posts/:postId/attachments', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const userId = req.userId
    const { file_url, file_path, thumbnail_url, file_name, file_size, mime_type, file_type, width, height, duration, display_order } = req.body

    if (!file_url || !file_type) {
      return res.status(400).json({ error: 'file_url and file_type required' })
    }

    // Validate file_type
    if (!['image', 'video', 'audio', 'document', 'other'].includes(file_type)) {
      return res.status(400).json({ error: 'file_type must be one of: image, video, audio, document, other' })
    }

    try {
      // Verify user owns the post
      const postCheck = await pool.query(
        'SELECT user_id FROM forum.posts WHERE id = $1',
        [postId]
      )
      if (postCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' })
      }
      if (postCheck.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only add attachments to your own posts' })
      }

      // Insert attachment
      const insertQuery = `
        INSERT INTO forum.post_attachments (
          post_id, file_url, file_path, thumbnail_url, file_name, file_size,
          mime_type, file_type, width, height, duration, display_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, post_id, file_url, file_path, thumbnail_url, file_name,
                  file_size, mime_type, file_type, width, height, duration,
                  display_order, created_at
      `
      const { rows } = await pool.query(insertQuery, [
        postId, file_url, file_path || null, thumbnail_url || null,
        file_name || null, file_size || null, mime_type || null, file_type,
        width || null, height || null, duration || null, display_order || 0
      ])

      res.status(201).json(rows[0])
    } catch (err: any) {
      console.error('[messaging] Error adding post attachment:', err)
      res.status(500).json({ error: 'Failed to add attachment' })
    }
  })

  // GET /forum/posts/:postId/attachments - Get attachments for post (MUST be before /posts/:postId)
  router.get('/posts/:postId/attachments', async (req: Request, res: Response) => {
    const { postId } = req.params

    try {
      const query = `
        SELECT id, post_id, file_url, file_path, thumbnail_url, file_name,
               file_size, mime_type, file_type, width, height, duration,
               display_order, created_at
        FROM forum.post_attachments
        WHERE post_id = $1
        ORDER BY display_order ASC, created_at ASC
      `
      const { rows } = await pool.query(query, [postId])

      res.json({ attachments: rows })
    } catch (err) {
      console.error('[messaging] Error fetching post attachments:', err)
      res.status(500).json({ error: 'Failed to fetch attachments' })
    }
  })

  // GET /forum/posts/:postId - Get post details
  router.get('/posts/:postId', async (req: Request, res: Response) => {
    const { postId } = req.params

    const cacheKey = makePostKey(postId)
    const result = await cached(
      redis,
      cacheKey,
      120_000, // 2 minute cache
      async () => {
        try {
          const query = `
            SELECT 
              id, user_id, title, content, flair, upload_type, upvotes, downvotes,
              comment_count, is_pinned, is_locked, created_at, updated_at
            FROM forum.posts
            WHERE id = $1
          `
          const { rows } = await pool.query(query, [postId])

          if (rows.length === 0) {
            throw new Error('Post not found')
          }

          return rows[0]
        } catch (err) {
          console.error('[messaging] Error fetching post:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // PUT /forum/posts/:postId - Update post (author only)
  router.put('/posts/:postId', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const { title, content, flair, upload_type } = req.body
    const userId = req.userId

    try {
      // Verify author owns the post
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.posts WHERE id = $1',
        [postId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only edit your own posts' })
      }

      // Validate upload_type if provided
      let validUploadType = null
      if (upload_type) {
        const validUploadTypes = ['text', 'image', 'video', 'link', 'poll']
        if (validUploadTypes.includes(upload_type)) {
          validUploadType = upload_type
        }
      }

      const updateQuery = `
        UPDATE forum.posts
        SET title = COALESCE($1, title),
            content = COALESCE($2, content),
            flair = COALESCE($3, flair),
            upload_type = COALESCE($4, upload_type),
            updated_at = now()
        WHERE id = $5
        RETURNING id, user_id, title, content, flair, upload_type, upvotes, downvotes,
                  comment_count, is_pinned, is_locked, created_at, updated_at
      `
      const { rows } = await pool.query(updateQuery, [title, content, flair, validUploadType, postId])

      res.json(rows[0])
    } catch (err) {
      console.error('[messaging] Error updating post:', err)
      res.status(500).json({ error: 'Failed to update post' })
    }
  })

  // DELETE /forum/posts/:postId - Delete post (author or admin)
  router.delete('/posts/:postId', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const userId = req.userId

    try {
      // Verify author owns the post (or is admin - implement admin check if needed)
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.posts WHERE id = $1',
        [postId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only delete your own posts' })
      }

      await pool.query('DELETE FROM forum.posts WHERE id = $1', [postId])
      res.status(204).end()
    } catch (err) {
      console.error('[messaging] Error deleting post:', err)
      res.status(500).json({ error: 'Failed to delete post' })
    }
  })

  // POST /forum/posts/:postId/vote - Upvote/downvote post
  router.post('/posts/:postId/vote', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const { vote } = req.body // 'up' or 'down'
    const userId = req.userId

    if (!vote || !['up', 'down'].includes(vote)) {
      return res.status(400).json({ error: 'vote must be "up" or "down"' })
    }

    try {
      // Upsert vote (ON CONFLICT updates existing vote)
      await pool.query(
        `INSERT INTO forum.post_votes (post_id, user_id, vote_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, user_id) 
         DO UPDATE SET vote_type = $3, created_at = now()`,
        [postId, userId, vote]
      )

      // Get updated vote counts
      const { rows } = await pool.query(
        'SELECT upvotes, downvotes FROM forum.posts WHERE id = $1',
        [postId]
      )

      res.json({
        post_id: postId,
        user_id: userId,
        vote,
        upvotes: rows[0]?.upvotes || 0,
        downvotes: rows[0]?.downvotes || 0,
      })
    } catch (err) {
      console.error('[messaging] Error voting on post:', err)
      res.status(500).json({ error: 'Failed to vote on post' })
    }
  })

  // GET /forum/posts/:postId/comments - Get comments for post
  router.get('/posts/:postId/comments', async (req: Request, res: Response) => {
    const { postId } = req.params

    const cacheKey = makeCommentsKey(postId)
    const result = await cached(
      redis,
      cacheKey,
      30_000, // 30 second cache (comments change frequently)
      async () => {
        try {
          // Get all comments for this post (nested structure via parent_id)
          const query = `
            SELECT 
              id, post_id, user_id, parent_id, content, upvotes, downvotes,
              created_at, updated_at
            FROM forum.comments
            WHERE post_id = $1
            ORDER BY created_at ASC
          `
          const { rows } = await pool.query(query, [postId])

          // Build nested structure
          const commentMap = new Map()
          const rootComments: any[] = []

          // First pass: create map of all comments
          rows.forEach((comment: any) => {
            commentMap.set(comment.id, { ...comment, replies: [] })
          })

          // Second pass: build tree
          rows.forEach((comment: any) => {
            const commentNode = commentMap.get(comment.id)
            if (comment.parent_id) {
              const parent = commentMap.get(comment.parent_id)
              if (parent) {
                parent.replies.push(commentNode)
              } else {
                // Orphan comment (parent deleted), treat as root
                rootComments.push(commentNode)
              }
            } else {
              rootComments.push(commentNode)
            }
          })

          return {
            post_id: postId,
            comments: rootComments,
          }
        } catch (err) {
          console.error('[messaging] Error fetching comments:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /forum/posts/:postId/comments - Add comment
  router.post('/posts/:postId/comments', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const { content, parent_id } = req.body
    const userId = req.userId

    if (!content) {
      return res.status(400).json({ error: 'content required' })
    }

    try {
      // Insert comment
      const insertQuery = `
        INSERT INTO forum.comments (post_id, user_id, parent_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, post_id, user_id, parent_id, content, upvotes, downvotes,
                  created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [postId, userId, parent_id || null, content])
      const comment = rows[0]

      const producer = await getKafkaProducer()
      const createdAt =
        comment.created_at instanceof Date
          ? comment.created_at.toISOString()
          : String(comment.created_at)
      await sendMessagingEvent(producer, postId, {
        metadata: buildMetadata({
          event_type: 'CommentCreated',
          aggregate_id: comment.id,
          aggregate_type: 'comment',
        }),
        comment_id: comment.id,
        post_id: postId,
        user_id: userId,
        parent_id: parent_id || '',
        content,
        created_at: createdAt,
      })

      res.status(201).json(comment)
    } catch (err: any) {
      console.error('[messaging] Error creating comment:', err)
      res.status(500).json({ error: 'Failed to create comment' })
    }
  })

  // PUT /forum/comments/:commentId - Update comment (author only)
  router.put('/comments/:commentId', async (req: AuthedRequest, res: Response) => {
    const { commentId } = req.params
    const { content } = req.body
    const userId = req.userId

    if (!content) {
      return res.status(400).json({ error: 'content required' })
    }

    try {
      // Verify author owns the comment
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.comments WHERE id = $1',
        [commentId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Comment not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only edit your own comments' })
      }

      const updateQuery = `
        UPDATE forum.comments
        SET content = $1, updated_at = now()
        WHERE id = $2
        RETURNING id, post_id, user_id, parent_id, content, upvotes, downvotes,
                  created_at, updated_at
      `
      const { rows } = await pool.query(updateQuery, [content, commentId])

      res.json(rows[0])
    } catch (err) {
      console.error('[messaging] Error updating comment:', err)
      res.status(500).json({ error: 'Failed to update comment' })
    }
  })

  // DELETE /forum/comments/:commentId - Delete comment (author or admin)
  router.delete('/comments/:commentId', async (req: AuthedRequest, res: Response) => {
    const { commentId } = req.params
    const userId = req.userId

    try {
      // Verify author owns the comment
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.comments WHERE id = $1',
        [commentId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Comment not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only delete your own comments' })
      }

      await pool.query('DELETE FROM forum.comments WHERE id = $1', [commentId])
      res.status(204).end()
    } catch (err) {
      console.error('[messaging] Error deleting comment:', err)
      res.status(500).json({ error: 'Failed to delete comment' })
    }
  })

  // POST /forum/comments/:commentId/vote - Vote on comment
  router.post('/comments/:commentId/vote', async (req: AuthedRequest, res: Response) => {
    const { commentId } = req.params
    const { vote } = req.body
    const userId = req.userId

    if (!vote || !['up', 'down'].includes(vote)) {
      return res.status(400).json({ error: 'vote must be "up" or "down"' })
    }

    try {
      // Upsert vote
      await pool.query(
        `INSERT INTO forum.comment_votes (comment_id, user_id, vote_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (comment_id, user_id) 
         DO UPDATE SET vote_type = $3, created_at = now()`,
        [commentId, userId, vote]
      )

      // Get updated vote counts
      const { rows } = await pool.query(
        'SELECT upvotes, downvotes FROM forum.comments WHERE id = $1',
        [commentId]
      )

      res.json({
        comment_id: commentId,
        user_id: userId,
        vote,
        upvotes: rows[0]?.upvotes || 0,
        downvotes: rows[0]?.downvotes || 0,
      })
    } catch (err) {
      console.error('[messaging] Error voting on comment:', err)
      res.status(500).json({ error: 'Failed to vote on comment'       })
    }
  })


  // POST /forum/comments/:commentId/attachments - Add attachment to comment (MUST be before /comments/:commentId)
  router.post('/comments/:commentId/attachments', async (req: AuthedRequest, res: Response) => {
    const { commentId } = req.params
    const userId = req.userId
    const { file_url, file_path, thumbnail_url, file_name, file_size, mime_type, file_type, width, height, duration, display_order } = req.body

    if (!file_url || !file_type) {
      return res.status(400).json({ error: 'file_url and file_type required' })
    }

    // Validate file_type
    if (!['image', 'video', 'audio', 'document', 'other'].includes(file_type)) {
      return res.status(400).json({ error: 'file_type must be one of: image, video, audio, document, other' })
    }

    try {
      // Verify user owns the comment
      const commentCheck = await pool.query(
        'SELECT user_id FROM forum.comments WHERE id = $1',
        [commentId]
      )
      if (commentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Comment not found' })
      }
      if (commentCheck.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only add attachments to your own comments' })
      }

      // Insert attachment
      const insertQuery = `
        INSERT INTO forum.comment_attachments (
          comment_id, file_url, file_path, thumbnail_url, file_name, file_size,
          mime_type, file_type, width, height, duration, display_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, comment_id, file_url, file_path, thumbnail_url, file_name,
                  file_size, mime_type, file_type, width, height, duration,
                  display_order, created_at
      `
      const { rows } = await pool.query(insertQuery, [
        commentId, file_url, file_path || null, thumbnail_url || null,
        file_name || null, file_size || null, mime_type || null, file_type,
        width || null, height || null, duration || null, display_order || 0
      ])

      res.status(201).json(rows[0])
    } catch (err: any) {
      console.error('[messaging] Error adding comment attachment:', err)
      res.status(500).json({ error: 'Failed to add attachment' })
    }
  })

  // GET /forum/comments/:commentId/attachments - Get attachments for comment
  router.get('/comments/:commentId/attachments', async (req: Request, res: Response) => {
    const { commentId } = req.params

    try {
      const query = `
        SELECT id, comment_id, file_url, file_path, thumbnail_url, file_name,
               file_size, mime_type, file_type, width, height, duration,
               display_order, created_at
        FROM forum.comment_attachments
        WHERE comment_id = $1
        ORDER BY display_order ASC, created_at ASC
      `
      const { rows } = await pool.query(query, [commentId])

      res.json({ attachments: rows })
    } catch (err) {
      console.error('[messaging] Error fetching comment attachments:', err)
      res.status(500).json({ error: 'Failed to fetch attachments' })
    }
  })

  return router
}
