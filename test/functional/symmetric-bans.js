/* eslint-env node, mocha */
/* global $database */

import expect from 'unexpected';

import { dbAdapter, Comment, PubSub } from '../../app/models';
import cleanDB from '../dbCleaner';
import { getSingleton } from '../../app/app';
import { PubSubAdapter, eventNames } from '../../app/support/PubSubAdapter';

import {
  banUser,
  createAndReturnPost,
  createTestUsers,
  performJSONRequest,
  authHeaders,
  updateUserAsync,
  like,
  likeComment,
} from './functional_test_helper';
import Session from './realtime-session';

describe('Symmetric bans', () => {
  beforeEach(() => cleanDB(dbAdapter.database));
  describe('Luna bans Mars, Venus wrote post', () => {
    let luna;
    let mars;
    let venus;
    let post;
    beforeEach(async () => {
      [luna, mars, venus] = await createTestUsers(['luna', 'mars', 'venus']);
      post = await createAndReturnPost(venus, 'Post body');
      await banUser(luna, mars);
    });

    describe('Comments visibility', () => {
      describe('Luna and Mars both commented the Venus post', () => {
        beforeEach(async () => {
          await createComment(luna, post.id, 'Comment from Luna');
          await createComment(mars, post.id, 'Comment from Mars');
        });

        it('should show all comments to Venus', async () => {
          const resp = await fetchPost(post.id, venus);
          expect(resp.comments, 'to satisfy', [
            { body: 'Comment from Luna', createdBy: luna.user.id },
            { body: 'Comment from Mars', createdBy: mars.user.id },
          ]);
        });

        it(`should not show Mars' comments to Luna`, async () => {
          const resp = await fetchPost(post.id, luna);
          expect(resp.comments, 'to satisfy', [
            { body: 'Comment from Luna', createdBy: luna.user.id },
          ]);
        });

        it(`should not show Luna's comments to Mars`, async () => {
          const resp = await fetchPost(post.id, mars);
          expect(resp.comments, 'to satisfy', [
            { body: 'Comment from Mars', createdBy: mars.user.id },
          ]);
        });

        describe('Luna and Mars wants to see all hidden comments', () => {
          beforeEach(() =>
            Promise.all([
              updateUserAsync(luna, { preferences: { hideCommentsOfTypes: [] } }),
              updateUserAsync(mars, { preferences: { hideCommentsOfTypes: [] } }),
            ]),
          );

          it(`should show Mars' comments to Luna as placeholder`, async () => {
            const resp = await fetchPost(post.id, luna);
            expect(resp.comments, 'to satisfy', [
              { body: 'Comment from Luna', createdBy: luna.user.id },
              {
                body: Comment.hiddenBody(Comment.HIDDEN_AUTHOR_BANNED),
                createdBy: null,
                hideType: Comment.HIDDEN_AUTHOR_BANNED,
              },
            ]);
          });

          it(`should show Luna's comments to Mars with _hideType`, async () => {
            const resp = await fetchPost(post.id, mars);
            expect(resp.comments, 'to satisfy', [
              {
                body: 'Comment from Luna',
                createdBy: luna.user.id,
                hideType: Comment.VISIBLE,
                _hideType: Comment.HIDDEN_VIEWER_BANNED,
              },
              { body: 'Comment from Mars', createdBy: mars.user.id },
            ]);
          });
        });

        describe('Luna and Mars wants to see all comments except of HIDDEN_AUTHOR_BANNED', () => {
          beforeEach(() =>
            Promise.all([
              updateUserAsync(luna, {
                preferences: { hideCommentsOfTypes: [Comment.HIDDEN_AUTHOR_BANNED] },
              }),
              updateUserAsync(mars, {
                preferences: { hideCommentsOfTypes: [Comment.HIDDEN_AUTHOR_BANNED] },
              }),
            ]),
          );

          it(`should not show Mars' comments to Luna`, async () => {
            const resp = await fetchPost(post.id, luna);
            expect(resp.comments, 'to satisfy', [
              { body: 'Comment from Luna', createdBy: luna.user.id },
            ]);
          });

          it(`should show Luna's comments to Mars with _hideType`, async () => {
            const resp = await fetchPost(post.id, mars);
            expect(resp.comments, 'to satisfy', [
              {
                body: 'Comment from Luna',
                createdBy: luna.user.id,
                hideType: Comment.VISIBLE,
                _hideType: Comment.HIDDEN_VIEWER_BANNED,
              },
              { body: 'Comment from Mars', createdBy: mars.user.id },
            ]);
          });
        });

        describe('Luna and Mars wants to see all comments except of HIDDEN_VIEWER_BANNED', () => {
          beforeEach(() =>
            Promise.all([
              updateUserAsync(luna, {
                preferences: { hideCommentsOfTypes: [Comment.HIDDEN_VIEWER_BANNED] },
              }),
              updateUserAsync(mars, {
                preferences: { hideCommentsOfTypes: [Comment.HIDDEN_VIEWER_BANNED] },
              }),
            ]),
          );

          it(`should show Mars' comments to Luna as placeholder`, async () => {
            const resp = await fetchPost(post.id, luna);
            expect(resp.comments, 'to satisfy', [
              { body: 'Comment from Luna', createdBy: luna.user.id },
              {
                body: Comment.hiddenBody(Comment.HIDDEN_AUTHOR_BANNED),
                createdBy: null,
                hideType: Comment.HIDDEN_AUTHOR_BANNED,
              },
            ]);
          });

          it(`should not show Luna's comments to Mars`, async () => {
            const resp = await fetchPost(post.id, mars);
            expect(resp.comments, 'to satisfy', [
              { body: 'Comment from Mars', createdBy: mars.user.id },
            ]);
          });
        });
      });
    });

    describe('Likes visibility', () => {
      describe('Luna and Mars both liked the Venus post', () => {
        beforeEach(async () => {
          await like(post.id, luna.authToken);
          await like(post.id, mars.authToken);
        });

        it('should show both likes to Venus', async () => {
          const resp = await fetchPost(post.id, venus);
          expect(resp.posts.likes, 'to equal', [mars.user.id, luna.user.id]);
        });

        it(`should show only Luna's like to Luna`, async () => {
          const resp = await fetchPost(post.id, luna);
          expect(resp.posts.likes, 'to equal', [luna.user.id]);
        });

        it(`should show only Mars' like to Mars`, async () => {
          const resp = await fetchPost(post.id, mars);
          expect(resp.posts.likes, 'to equal', [mars.user.id]);
        });
      });
    });

    describe('Comment likes visibility', () => {
      describe('Luna and Mars both liked the Venus comment', () => {
        let comment;
        beforeEach(async () => {
          ({ comments: comment } = await createComment(venus, post.id, 'Venus comment'));
          await likeComment(comment.id, luna);
          await likeComment(comment.id, mars);
        });

        it('should show both comment likes to Venus', async () => {
          const resp = await fetchPost(post.id, venus);
          expect(resp.comments, 'to satisfy', [{ likes: 2, hasOwnLike: false }]);

          const { likes } = await getCommentLikes(comment.id, venus);
          expect(likes, 'to satisfy', [{ userId: mars.user.id }, { userId: luna.user.id }]);
        });

        it(`should show only Luna's comment like to Luna`, async () => {
          const resp = await fetchPost(post.id, luna);
          expect(resp.comments, 'to satisfy', [{ likes: 1, hasOwnLike: true }]);

          const { likes } = await getCommentLikes(comment.id, luna);
          expect(likes, 'to satisfy', [{ userId: luna.user.id }]);
        });

        it(`should show only Mars' comment like to Mars`, async () => {
          const resp = await fetchPost(post.id, mars);
          expect(resp.comments, 'to satisfy', [{ likes: 1, hasOwnLike: true }]);

          const { likes } = await getCommentLikes(comment.id, mars);
          expect(likes, 'to satisfy', [{ userId: mars.user.id }]);
        });
      });
    });

    describe('Realtime', () => {
      let port;
      before(async () => {
        const app = await getSingleton();
        port = process.env.PEPYATKA_SERVER_PORT || app.context.config.port;
        const pubsubAdapter = new PubSubAdapter($database);
        PubSub.setPublisher(pubsubAdapter);
      });

      let lunaSession, marsSession;
      beforeEach(async () => {
        [lunaSession, marsSession] = await Promise.all([
          Session.create(port, 'Luna session'),
          Session.create(port, 'Mars session'),
        ]);

        await Promise.all([
          lunaSession.sendAsync('auth', { authToken: luna.authToken }),
          marsSession.sendAsync('auth', { authToken: mars.authToken }),
        ]);

        await Promise.all([
          lunaSession.sendAsync('subscribe', { post: [post.id] }),
          marsSession.sendAsync('subscribe', { post: [post.id] }),
        ]);
      });

      afterEach(() => [lunaSession, marsSession].forEach((s) => s.disconnect()));

      describe('Comment creation (Luna and Mars wants to see all hidden comments)', () => {
        beforeEach(() =>
          Promise.all([
            updateUserAsync(luna, { preferences: { hideCommentsOfTypes: [] } }),
            updateUserAsync(mars, { preferences: { hideCommentsOfTypes: [] } }),
          ]),
        );

        it(`should deliver "${eventNames.COMMENT_CREATED}" to Luna when Mars creates comment`, async () => {
          const test = lunaSession.receiveWhile(eventNames.COMMENT_CREATED, () =>
            createComment(mars, post.id, 'Comment from Mars'),
          );
          await expect(test, 'when fulfilled', 'to satisfy', {
            comments: {
              hideType: Comment.HIDDEN_AUTHOR_BANNED,
              body: Comment.hiddenBody(Comment.HIDDEN_AUTHOR_BANNED),
              createdBy: null,
            },
          });
        });

        it(`should deliver "${eventNames.COMMENT_CREATED}" to Mars when Luna creates comment`, async () => {
          const test = marsSession.receiveWhile(eventNames.COMMENT_CREATED, () =>
            createComment(luna, post.id, 'Comment from Luna'),
          );
          await expect(test, 'when fulfilled', 'to satisfy', {
            comments: {
              hideType: Comment.VISIBLE,
              _hideType: Comment.HIDDEN_VIEWER_BANNED,
              body: 'Comment from Luna',
              createdBy: luna.user.id,
            },
          });
        });
      });
    });
  });
});

function fetchPost(postId, userCtx) {
  return performJSONRequest('GET', `/v2/posts/${postId}`, null, authHeaders(userCtx));
}

function createComment(userCtx, postId, body) {
  return performJSONRequest(
    'POST',
    `/v2/comments`,
    { comment: { body, postId } },
    authHeaders(userCtx),
  );
}

function getCommentLikes(commentId, userCtx) {
  return performJSONRequest('GET', `/v2/comments/${commentId}/likes`, null, authHeaders(userCtx));
}
