import type { PoolClient } from 'pg'

export type ForumVote = 'up' | 'down'

export type PostVoteResult = {
  post_id: string
  user_id: string
  upvotes: number
  downvotes: number
  user_vote: ForumVote | null
}

export type CommentVoteResult = {
  comment_id: string
  post_id: string
  user_id: string
  upvotes: number
  downvotes: number
  user_vote: ForumVote | null
}

/** Reddit-style: same vote again removes vote; switching flips; counts match post_votes / comment_votes. */
export async function applyPostVote(
  client: PoolClient,
  postId: string,
  userId: string,
  vote: ForumVote,
): Promise<PostVoteResult> {
  const cur = await client.query<{ vote_type: string }>(
    `SELECT vote_type FROM forum.post_votes WHERE post_id = $1::uuid AND user_id = $2::uuid`,
    [postId, userId],
  )
  const existing = cur.rows[0]?.vote_type as ForumVote | undefined
  if (existing === vote) {
    await client.query(`DELETE FROM forum.post_votes WHERE post_id = $1::uuid AND user_id = $2::uuid`, [
      postId,
      userId,
    ])
  } else {
    await client.query(
      `INSERT INTO forum.post_votes (post_id, user_id, vote_type)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (post_id, user_id) DO UPDATE SET vote_type = EXCLUDED.vote_type, created_at = now()`,
      [postId, userId, vote],
    )
  }

  await client.query(
    `UPDATE forum.posts SET
       upvotes = (SELECT COUNT(*)::int FROM forum.post_votes WHERE post_id = $1::uuid AND vote_type = 'up'),
       downvotes = (SELECT COUNT(*)::int FROM forum.post_votes WHERE post_id = $1::uuid AND vote_type = 'down'),
       updated_at = now()
     WHERE id = $1::uuid`,
    [postId],
  )

  const { rows } = await client.query<{
    upvotes: string | number
    downvotes: string | number
    user_vote: string | null
  }>(
    `SELECT p.upvotes, p.downvotes,
            (SELECT v.vote_type FROM forum.post_votes v WHERE v.post_id = p.id AND v.user_id = $2::uuid) AS user_vote
     FROM forum.posts p WHERE p.id = $1::uuid`,
    [postId, userId],
  )
  const row = rows[0]
  const uv = row?.user_vote === 'up' || row?.user_vote === 'down' ? (row.user_vote as ForumVote) : null
  return {
    post_id: postId,
    user_id: userId,
    upvotes: Number(row?.upvotes ?? 0),
    downvotes: Number(row?.downvotes ?? 0),
    user_vote: uv,
  }
}

export async function applyCommentVote(
  client: PoolClient,
  commentId: string,
  userId: string,
  vote: ForumVote,
): Promise<CommentVoteResult> {
  const postR = await client.query<{ post_id: string }>(
    `SELECT post_id FROM forum.comments WHERE id = $1::uuid`,
    [commentId],
  )
  const postId = postR.rows[0]?.post_id
  if (!postId) {
    throw new Error('COMMENT_NOT_FOUND')
  }

  const cur = await client.query<{ vote_type: string }>(
    `SELECT vote_type FROM forum.comment_votes WHERE comment_id = $1::uuid AND user_id = $2::uuid`,
    [commentId, userId],
  )
  const existing = cur.rows[0]?.vote_type as ForumVote | undefined
  if (existing === vote) {
    await client.query(
      `DELETE FROM forum.comment_votes WHERE comment_id = $1::uuid AND user_id = $2::uuid`,
      [commentId, userId],
    )
  } else {
    await client.query(
      `INSERT INTO forum.comment_votes (comment_id, user_id, vote_type)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (comment_id, user_id) DO UPDATE SET vote_type = EXCLUDED.vote_type, created_at = now()`,
      [commentId, userId, vote],
    )
  }

  await client.query(
    `UPDATE forum.comments SET
       upvotes = (SELECT COUNT(*)::int FROM forum.comment_votes WHERE comment_id = $1::uuid AND vote_type = 'up'),
       downvotes = (SELECT COUNT(*)::int FROM forum.comment_votes WHERE comment_id = $1::uuid AND vote_type = 'down'),
       updated_at = now()
     WHERE id = $1::uuid`,
    [commentId],
  )

  const { rows } = await client.query<{
    upvotes: string | number
    downvotes: string | number
    user_vote: string | null
  }>(
    `SELECT c.upvotes, c.downvotes,
            (SELECT v.vote_type FROM forum.comment_votes v WHERE v.comment_id = c.id AND v.user_id = $2::uuid) AS user_vote
     FROM forum.comments c WHERE c.id = $1::uuid`,
    [commentId, userId],
  )
  const row = rows[0]
  const uv = row?.user_vote === 'up' || row?.user_vote === 'down' ? (row.user_vote as ForumVote) : null
  return {
    comment_id: commentId,
    post_id: postId,
    user_id: userId,
    upvotes: Number(row?.upvotes ?? 0),
    downvotes: Number(row?.downvotes ?? 0),
    user_vote: uv,
  }
}
