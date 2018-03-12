import GraphemeBreaker from 'grapheme-breaker'
import _ from 'lodash'

import { extractHashtags } from '../support/hashtags'
import { PubSub as pubSub } from '../models'
import { getRoomsOfPost } from '../pubsub-listener'


export function addModel(dbAdapter) {
  /**
   * @constructor
   */
  const Post = function (params) {
    this.id               = params.id
    this.body             = params.body
    this.attachments      = params.attachments
    this.userId           = params.userId
    this.timelineIds      = params.timelineIds
    this.currentUser      = params.currentUser
    this.commentsDisabled = params.commentsDisabled
    this.feedIntIds       = params.feedIntIds || []
    this.destinationFeedIds = params.destinationFeedIds || []
    this.commentsCount    = params.commentsCount
    this.likesCount       = params.likesCount
    this.isPrivate        = params.isPrivate || '0';
    this.isProtected      = params.isProtected || '0';
    this.isPropagable     = params.isPropagable || '0';

    if (params.friendfeedUrl) {
      this.friendfeedUrl = params.friendfeedUrl;
    }

    if (parseInt(params.createdAt, 10)) {
      this.createdAt = params.createdAt
    }

    if (parseInt(params.updatedAt, 10)) {
      this.updatedAt = params.updatedAt
    }

    if (parseInt(params.bumpedAt, 10)) {
      this.bumpedAt = params.bumpedAt;
    }

    if (params.maxComments != 'all') {
      this.maxComments = parseInt(params.maxComments, 10) || 2
    } else {
      this.maxComments = params.maxComments
    }

    if (params.maxLikes !== 'all') {
      this.maxLikes = parseInt(params.maxLikes, 10) || 3
    } else {
      this.maxLikes = params.maxLikes
    }
  }

  Reflect.defineProperty(Post.prototype, 'body', {
    get: function () { return this.body_ },
    set: function (newValue) {
      newValue ? this.body_ = newValue.trim() : this.body_ = ''
    }
  })

  Post.prototype.validate = function () {
    const valid = this.body
               && this.body.length > 0
               && this.userId
               && this.userId.length > 0

    if (!valid) {
      throw new Error('Post text must not be empty')
    }

    const len = GraphemeBreaker.countBreaks(this.body)

    if (len > 1500) {
      throw new Error('Maximum post-length is 1500 graphemes')
    }
  }

  Post.prototype.create = async function () {
    await this.validate();

    const payload = {
      'body':             this.body,
      'userId':           this.userId,
      'commentsDisabled': this.commentsDisabled,
    }
    const destFeeds = await dbAdapter.getTimelinesByIds(this.timelineIds);
    this.feedIntIds = destFeeds.map((f) => f.intId);
    this.destinationFeedIds = this.feedIntIds.slice();
    // save post to the database
    this.id = await dbAdapter.createPost(payload, this.feedIntIds);

    const newPost = await dbAdapter.getPostById(this.id);
    const fieldsToUpdate = [
      'isPrivate',
      'isProtected',
      'isPropagable',
      'createdAt',
      'updatedAt',
      'bumpedAt',
    ];
    for (const f of fieldsToUpdate) {
      this[f] = newPost[f];
    }

    await Promise.all([
      this.linkAttachments(),
      this.processHashtagsOnCreate(),
    ]);

    // Realtime
    const rtUpdates = destFeeds
      .filter((f) => f.isDirects())
      .map((f) => pubSub.updateUnreadDirects(f.userId));
    rtUpdates.push(pubSub.newPost(this.id));

    // Update groups last activity
    const { updatedAt } = this;
    const groupsUpdates = destFeeds
      // All 'Posts' feeds except of author's are belongs to groups
      .filter((f) => f.isPosts() && f.userId !== this.userId)
      .map((f) => dbAdapter.updateUser(f.userId, { updatedAt }))

    await Promise.all([
      ...rtUpdates,
      ...groupsUpdates,
      dbAdapter.statsPostCreated(this.userId),
    ]);

    return this;
  }

  Post.prototype.update = async function (params) {
    // Reflect post changes and validate
    this.updatedAt = new Date().getTime()
    this.body = params.body
    await this.validate()

    // Calculate changes in attachments
    const oldAttachments = await this.getAttachmentIds() || []
    const newAttachments = params.attachments || []
    const removedAttachments = oldAttachments.filter((i) => !newAttachments.includes(i))

    // Update post body in DB
    const payload = {
      'body':      this.body,
      'updatedAt': this.updatedAt.toString()
    }
    await dbAdapter.updatePost(this.id, payload)

    // Update post attachments in DB
    await Promise.all([
      this.linkAttachments(newAttachments),
      this.unlinkAttachments(removedAttachments)
    ])

    await this.processHashtagsOnUpdate()

    // Finally, publish changes
    await pubSub.updatePost(this.id)

    return this
  }

  Post.prototype.setCommentsDisabled = async function (newValue) {
    // Reflect post changes
    this.commentsDisabled = newValue

    // Update post body in DB
    const payload = { 'commentsDisabled': this.commentsDisabled }
    await dbAdapter.updatePost(this.id, payload)

    // Finally, publish changes
    await pubSub.updatePost(this.id)

    return this
  }

  Post.prototype.destroy = async function () {
    const [
      realtimeRooms,
      comments,
    ] = await Promise.all([
      getRoomsOfPost(this),
      this.getComments(),
      dbAdapter.statsPostDeleted(this.userId, this.id),  // needs data in DB
    ]);

    // remove all comments
    await Promise.all(comments.map((comment) => comment.destroy()))

    await dbAdapter.withdrawPostFromFeeds(this.feedIntIds, this.id)
    await dbAdapter.deletePost(this.id)

    await pubSub.destroyPost(this.id, realtimeRooms)
  }

  Post.prototype.getCreatedBy = function () {
    return dbAdapter.getUserById(this.userId)
  }

  Post.prototype.getSubscribedTimelineIds = async function (groupOnly) {
    if (typeof groupOnly === 'undefined') {
      groupOnly = false;
    }

    const feed = await dbAdapter.getFeedOwnerById(this.userId)

    const feeds = [feed.getRiverOfNewsTimelineId()]
    if (!groupOnly) {
      feeds.push(feed.getPostsTimelineId());
    }

    let timelineIds = await Promise.all(feeds)
    const newTimelineIds = await this.getTimelineIds()

    timelineIds = timelineIds.concat(newTimelineIds)
    return _.uniq(timelineIds)
  }

  Post.prototype.getSubscribedTimelines = async function () {
    const timelineIds = await this.getSubscribedTimelineIds()
    this.subscribedTimelines = await dbAdapter.getTimelinesByIds(timelineIds)

    return this.subscribedTimelines
  }

  Post.prototype.getTimelineIds = async function () {
    const timelineIds = await dbAdapter.getPostUsagesInTimelines(this.id)
    this.timelineIds = timelineIds || []
    return this.timelineIds
  }

  Post.prototype.getTimelines = async function () {
    this.timelines = await dbAdapter.getTimelinesByIntIds(this.feedIntIds)

    return this.timelines
  }

  Post.prototype.getPostedToIds = async function () {
    const timelineIds = await dbAdapter.getTimelinesUUIDsByIntIds(this.destinationFeedIds)
    this.timelineIds = timelineIds || []
    return this.timelineIds
  }

  Post.prototype.getPostedTo = async function () {
    this.postedTo = await dbAdapter.getTimelinesByIntIds(this.destinationFeedIds)

    return this.postedTo
  }

  /**
   * Returns all RiverOfNews timelines this post belongs to.
   * Timelines are calculated dynamically.
   *
   * @return {Timeline[]}
   */
  Post.prototype.getRiverOfNewsTimelines = async function () {
    const postFeeds = await this.getTimelines();
    const activities = postFeeds.filter((f) => f.isLikes() || f.isComments());
    const destinations = postFeeds.filter((f) => f.isPosts() || f.isDirects());

    /**
     * 'RiverOfNews' feeds of:
     * - post author
     * - users subscribed to post destinations feeds ('Posts')
     * - owners of post destinations feeds ('Posts' and 'Directs')
     * - (if post is propagable) users subscribed to post activity feeds ('Likes' and 'Comments').
     */
    const riverOfNewsSourceIds = [...destinations, ...(this.isPropagable === '1' ? activities : [])].map((f) => f.id);
    const riverOfNewsOwnerIds = await dbAdapter.getUsersSubscribedToTimelines(riverOfNewsSourceIds);
    const destinationOwnerIds = destinations.map((f) => f.userId);
    return await dbAdapter.getUsersNamedTimelines(
      _.uniq([
        ...riverOfNewsOwnerIds,
        ...destinationOwnerIds,
        this.userId,
      ]),
      'RiverOfNews',
    );
  };

  /**
   * Returns all MyDiscussions timelines this post belongs to.
   * Timelines are calculated dynamically.
   *
   * @return {Timeline[]}
   */
  Post.prototype.getMyDiscussionsTimelines = async function () {
    const postFeeds = await this.getTimelines();
    const activities = postFeeds.filter((f) => f.isLikes() || f.isComments());

    /**
     * 'MyDiscussions' feeds of post author and users who did
     * some activity (likes, comments) on post.
     */
    const myDiscussionsOwnerIds = activities.map((f) => f.userId);
    myDiscussionsOwnerIds.push(this.userId);
    return await dbAdapter.getUsersNamedTimelines(_.uniq(myDiscussionsOwnerIds), 'MyDiscussions');
  };

  Post.prototype.getGenericFriendOfFriendTimelineIntIds = async function (user, type) {
    const timelineIntIds = []

    const userTimelineIntId = await user[`get${type}TimelineIntId`]()
    timelineIntIds.push(userTimelineIntId)

    const timelines = await dbAdapter.getTimelinesByIntIds(this.destinationFeedIds)
    const timelineOwners = await dbAdapter.getFeedOwnersByIds(timelines.map((tl) => tl.userId))

    // Adds the specified post to River of News if and only if
    // that post has been published to user's Post timeline,
    // otherwise this post will stay in group(s) timelines
    let groupOnly = true

    if (_.some(timelineOwners.map((owner) => owner.isUser()))) {
      groupOnly = false

      const timeline = await dbAdapter.getTimelineByIntId(userTimelineIntId)
      const subscribersIds = await timeline.getSubscriberIds()
      const subscribersRiversOfNewsIntIds = await dbAdapter.getUsersNamedFeedsIntIds(subscribersIds, ['RiverOfNews'])
      timelineIntIds.push(subscribersRiversOfNewsIntIds)
    }

    const postAuthor = await dbAdapter.getFeedOwnerById(this.userId)
    timelineIntIds.push(await postAuthor.getRiverOfNewsTimelineIntId())

    if (!groupOnly) {
      timelineIntIds.push(await postAuthor.getPostsTimelineIntId())
    }

    timelineIntIds.push(await user.getRiverOfNewsTimelineIntId())
    timelineIntIds.push(this.feedIntIds)

    return _.uniq(_.flatten(timelineIntIds))
  }

  Post.prototype.getLikesFriendOfFriendTimelineIntIds = function (user) {
    return this.getGenericFriendOfFriendTimelineIntIds(user, 'Likes')
  }

  Post.prototype.getCommentsFriendOfFriendTimelineIntIds = function (user) {
    return this.getGenericFriendOfFriendTimelineIntIds(user, 'Comments')
  }

  Post.prototype.hide = async function (userId) {
    const theUser = await dbAdapter.getUserById(userId)
    const hidesTimelineId = await theUser.getHidesTimelineIntId()

    await dbAdapter.insertPostIntoFeeds([hidesTimelineId], this.id)

    await pubSub.hidePost(theUser.id, this.id)
  }

  Post.prototype.unhide = async function (userId) {
    const theUser = await dbAdapter.getUserById(userId)
    const hidesTimelineId = await theUser.getHidesTimelineIntId()

    await dbAdapter.withdrawPostFromFeeds([hidesTimelineId], this.id)

    await pubSub.unhidePost(theUser.id, this.id)
  }

  Post.prototype.addComment = async function (comment) {
    const user = await dbAdapter.getUserById(comment.userId)

    let timelineIntIds = this.destinationFeedIds.slice()

    // only subscribers are allowed to read direct posts
    if (!await this.isStrictlyDirect()) {
      const moreTimelineIntIds = await this.getCommentsFriendOfFriendTimelineIntIds(user)
      timelineIntIds.push(...moreTimelineIntIds)

      timelineIntIds = _.uniq(timelineIntIds)
    }

    let timelines = await dbAdapter.getTimelinesByIntIds(timelineIntIds)

    // no need to post updates to rivers of banned users
    const bannedIds = await user.getBanIds()
    timelines = timelines.filter((timeline) => !(timeline.userId in bannedIds))

    await this.publishChangesToFeeds(timelines, false)

    return timelines
  }

  Post.prototype.publishChangesToFeeds = async function (timelines, isLikeAction = false) {
    const feedsIntIds = timelines.map((t) => t.intId)
    const insertIntoFeedIds = _.difference(feedsIntIds, this.feedIntIds)
    const timelineOwnersIds = timelines.map((t) => t.userId)

    if (insertIntoFeedIds.length > 0) {
      await dbAdapter.insertPostIntoFeeds(insertIntoFeedIds, this.id)
    }

    if (isLikeAction) {
      return
    }

    const now = new Date();

    const promises = [
      dbAdapter.setPostBumpedAt(this.id, now.getTime()),
      dbAdapter.setUpdatedAtInGroupsByIds(timelineOwnersIds, now.getTime())
    ];

    await Promise.all(promises);
  }

  Post.prototype.getOmittedComments = async function () {
    let length = this.commentsCount
    if (length == null) {
      length = await dbAdapter.getPostCommentsCount(this.id)
    }

    if (length > this.maxComments && length > 3 && this.maxComments != 'all') {
      this.omittedComments = length - this.maxComments
      return this.omittedComments
    }

    return 0
  }

  Post.prototype.getPostComments = async function () {
    const comments = await dbAdapter.getAllPostCommentsWithoutBannedUsers(this.id, this.currentUser)
    const commentsIds = comments.map((cmt) => {
      return cmt.id
    })

    const { length } = comments;
    let visibleCommentsIds = commentsIds
    let visibleComments = comments
    if (length > this.maxComments && length > 3 && this.maxComments != 'all') {
      const firstNCommentIds = commentsIds.slice(0, this.maxComments - 1)
      const firstNComments   = comments.slice(0, this.maxComments - 1)
      const lastCommentId = _.last(commentsIds)
      const lastComment   = _.last(comments)

      this.omittedComments = length - this.maxComments
      visibleCommentsIds = firstNCommentIds.concat(lastCommentId)
      visibleComments = firstNComments.concat(lastComment)
    }

    this.commentIds = visibleCommentsIds
    return visibleComments
  }

  Post.prototype.getComments = async function () {
    this.comments = await this.getPostComments()

    return this.comments
  }

  Post.prototype.linkAttachments = async function (attachmentList) {
    const attachmentIds = attachmentList || this.attachments || []
    const attachments = await dbAdapter.getAttachmentsByIds(attachmentIds)

    const attachmentPromises = attachments.filter((attachment) => {
      // Filter out invalid attachments
      return attachment.fileSize !== undefined
    }).map((attachment, ord) => {
      if (this.attachments) {
        const pos = this.attachments.indexOf(attachment.id)

        if (pos === -1) {
          this.attachments.push(attachment)
        } else {
          this.attachments[pos] = attachment
        }
      }

      // Update connections in DB

      return dbAdapter.linkAttachmentToPost(attachment.id, this.id, ord)
    })

    await Promise.all(attachmentPromises)
  }

  Post.prototype.unlinkAttachments = async function (attachmentList) {
    const attachmentIds = attachmentList || []
    const attachments = await dbAdapter.getAttachmentsByIds(attachmentIds)

    const attachmentPromises = attachments.map((attachment) => {
      // should we modify `this.attachments` here?

      // Update connections in DB
      return dbAdapter.unlinkAttachmentFromPost(attachment.id, this.id)
    })

    await Promise.all(attachmentPromises)
  }

  Post.prototype.getAttachmentIds = async function () {
    this.attachmentIds = await dbAdapter.getPostAttachments(this.id)
    return this.attachmentIds
  }

  Post.prototype.getAttachments = async function () {
    this.attachments = await dbAdapter.getAttachmentsOfPost(this.id)

    return this.attachments
  }

  Post.prototype.getLikeIds = async function () {
    const omittedLikesCount = await this.getOmittedLikes()
    let likedUsersIds = await dbAdapter.getPostLikersIdsWithoutBannedUsers(this.id, this.currentUser)

    likedUsersIds = likedUsersIds.sort((a, b) => {
      if (a == this.currentUser) {
        return -1;
      }

      if (b == this.currentUser) {
        return 1;
      }

      return 0
    })
    likedUsersIds.splice(likedUsersIds.length - omittedLikesCount, omittedLikesCount)
    return likedUsersIds
  }

  Post.prototype.getOmittedLikes = async function () {
    let length = this.likesCount
    if (length == null) {
      length = await dbAdapter.getPostLikesCount(this.id)
    }

    if (this.maxLikes !== 'all') {
      const threshold = this.maxLikes + 1

      if (length > threshold) {
        return length - this.maxLikes
      }
    }

    return 0
  }

  Post.prototype.getLikes = async function () {
    const userIds = await this.getLikeIds()

    const users = await dbAdapter.getUsersByIds(userIds)

    // filter non-existant likers
    this.likes = users.filter(Boolean)

    return this.likes
  }

  Post.prototype.isPrivate = async function () {
    const timelines = await this.getPostedTo()

    const arr = timelines.map(async (timeline) => {
      if (timeline.isDirects()) {
        return true;
      }

      const owner = await dbAdapter.getUserById(timeline.userId)

      return (owner.isPrivate === '1')
    })

    // one public timeline is enough
    return _.every(await Promise.all(arr))
  }

  Post.prototype.isStrictlyDirect = async function () {
    const timelines = await this.getPostedTo()
    const flags = timelines.map((timeline) => timeline.isDirects())

    // one non-direct timeline is enough
    return _.every(flags)
  }

  /**
   * Adds like to post. This method does not performs any access check.
   * It returns true on success and false if this post was already
   * liked by this user.
   *
   * @param {User} user
   * @returns {boolean}
   */
  Post.prototype.addLike = async function (user) {
    const success = await dbAdapter.likePost(this.id, user.id);
    if (!success) {
      return false;
    }

    const [
      likesTimeline,
      ,
    ] = await Promise.all([
      user.getLikesTimeline(),
      dbAdapter.statsLikeCreated(user.id),
    ]);

    if (this.isPropagable === '1') {
      // Local bumps
      const prevRONs = await this.getRiverOfNewsTimelines();
      const prevRONsOwners = _.map(prevRONs, 'userId');
      const usersSubscribedToLikeFeed = await dbAdapter.getUsersSubscribedToTimelines([likesTimeline.id]);
      usersSubscribedToLikeFeed.push(user.id); // user always implicitly subscribed to their feeds
      const newRONsOwners = _.difference(usersSubscribedToLikeFeed, prevRONsOwners);
      await dbAdapter.setLocalBumpForUsers(this.id, newRONsOwners);
    }

    await dbAdapter.insertPostIntoFeeds([likesTimeline.intId], this.id);

    // Send realtime notifications
    await pubSub.newLike(this, user.id);

    return true;
  };

  /**
   * Removes like from post. This method does not performs any access check.
   * It returns true on success and false if this post was not already
   * liked by this user.
   *
   * @param {User} user
   * @returns {boolean}
   */
  Post.prototype.removeLike = async function (user) {
    const success = await dbAdapter.unlikePost(this.id, user.id);
    if (!success) {
      return false;
    }
    const [
      realtimeRooms,
      timelineId,
      ,
    ] = await Promise.all([
      getRoomsOfPost(this),
      user.getLikesTimelineIntId(),
      dbAdapter.statsLikeDeleted(user.id),
    ]);
    await dbAdapter.withdrawPostFromFeeds([timelineId], this.id);

    // Send realtime notifications
    await pubSub.removeLike(this.id, user.id, realtimeRooms);

    return true;
  }

  Post.prototype.isBannedFor = async function (userId) {
    const user = await dbAdapter.getUserById(userId)
    const banIds = await user.getBanIds()

    return banIds.includes(this.userId)
  }

  Post.prototype.isHiddenIn = async function (timeline) {
    // hides are applicable only to river
    if (!(timeline.isRiverOfNews() || timeline.isHides())) {
      return false;
    }

    const owner = await timeline.getUser()
    const hidesTimelineIntId = await owner.getHidesTimelineIntId()

    return dbAdapter.isPostPresentInTimeline(hidesTimelineIntId, this.id)
  }

  /**
   * isVisibleFor checks visibility of the post for the given viewer
   * or for anonymous if viewer is null.
   *
   *  Viewer CAN NOT see post if:
   * - viwer is anonymous and post is not public or
   * - viewer is authorized and
   *   - post author banned viewer or was banned by viewer or
   *   - post is private and viewer cannot read any of post's destination feeds
   *
   * @param {User|null} viewer
   * @returns {boolean}
   */
  Post.prototype.isVisibleFor = async function (viewer) {
    // Check if viewer is anonymous and post is not public
    if (!viewer) {
      return this.isProtected === '0';
    }

    // Check if post author banned viewer or was banned by viewer
    const bannedUserIds = await dbAdapter.getUsersBansOrWasBannedBy(viewer.id);
    if (bannedUserIds.includes(this.userId)) {
      return false;
    }

    // Check if post is private and viewer cannot read any of post's destination feeds
    if (this.isPrivate === '1') {
      const privateFeedIds = await dbAdapter.getVisiblePrivateFeedIntIds(viewer.id);
      if (_.isEmpty(_.intersection(this.destinationFeedIds, privateFeedIds))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Filter users that can not see this post
   *
   * Viewer CAN NOT see post if:
   * - viwer is anonymous and post is not public or
   * - viewer is authorized and
   *   - post author banned viewer or was banned by viewer or
   *   - post is private and viewer cannot read any of post's destination feeds
   *
   * @param {User[]} users
   * @returns {User[]}
   */
  Post.prototype.onlyUsersCanSeePost = async function (users) {
    if (users.length === 0) {
      return [];
    }

    if (this.isProtected === '1') {
      // Anonymous can not see this post
      users = users.filter((u) => !!u.id); // users without id are anonymous
    }

    const authorBans = await dbAdapter.getUsersBansOrWasBannedBy(this.userId);
    // Author's banned and banners can not see this post
    users = users.filter((u) => !authorBans.includes(u.id));

    if (this.isPrivate === '1') {
      const allowedUserIds = await dbAdapter.getUsersWhoCanSeePrivateFeeds(this.destinationFeedIds);
      users = users.filter((u) => allowedUserIds.includes(u.id));
    }

    return users;
  }

  Post.prototype.processHashtagsOnCreate = async function () {
    const postTags = _.uniq(extractHashtags(this.body.toLowerCase()))

    if (!postTags || postTags.length == 0) {
      return
    }
    await dbAdapter.linkPostHashtagsByNames(postTags, this.id)
  }

  Post.prototype.processHashtagsOnUpdate = async function () {
    const linkedPostHashtags = await dbAdapter.getPostHashtags(this.id)

    const presentTags    = _.sortBy(linkedPostHashtags.map((t) => t.name))
    const newTags        = _.sortBy(_.uniq(extractHashtags(this.body.toLowerCase())))
    const notChangedTags = _.intersection(presentTags, newTags)
    const tagsToUnlink   = _.difference(presentTags, notChangedTags)
    const tagsToLink     = _.difference(newTags, notChangedTags)

    if (presentTags != newTags) {
      if (tagsToUnlink.length > 0) {
        await dbAdapter.unlinkPostHashtagsByNames(tagsToUnlink, this.id)
      }
      if (tagsToLink.length > 0) {
        await dbAdapter.linkPostHashtagsByNames(tagsToLink, this.id)
      }
    }
  }

  return Post
}
