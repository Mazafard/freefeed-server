export const alwaysAllowedRoutes = [
  'GET /v1/users/me',
  'POST /v2/app-tokens/:tokenId/reissue',
];

export const appTokensScopes = [
  {
    name:   'read-my-info',
    title:  'Read my user information',
    routes: [
      'GET /v2/users/whoami',
      'GET /v2/managedGroups',
      'GET /v2/users/blockedByMe',
    ]
  },
  {
    name:   'read-feeds',
    title:  'Read feeds, including my feeds and direct messages',
    routes: [
      'GET /v2/timelines/home',
      'GET /v2/timelines/filter/discussions',
      'GET /v2/timelines/filter/directs',
      'GET /v2/timelines/filter/saves',
      'GET /v2/users/getUnreadDirectsNumber',
      'GET /v2/timelines/:username',
      'GET /v2/timelines/:username/likes',
      'GET /v2/timelines/:username/comments',
      'GET /v2/search',
      'GET /v2/summary/:days',
      'GET /v2/summary/:username/:days',
      'GET /v2/bestof',
      'GET /v2/timelines-rss/:username',
      'GET /v2/posts/:postId',
      'GET /v2/archives/post-by-old-name/:name',
      'GET /v2/allGroups',
      'GET /v2/comments/:commentId/likes',
    ]
  },
  {
    name:   'read-users-info',
    title:  'Read users\' information',
    routes: [
      'GET /v1/users/:username',
      'GET /v1/users/:username/subscribers',
      'GET /v1/users/:username/subscriptions',
    ]
  },
  {
    name:   'read-realtime',
    title:  'Read realtime messages',
    routes: [
      'WS *',
    ]
  },
  {
    name:   'manage-notifications',
    title:  'Manage notifications',
    routes: [
      'GET /v2/notifications',
      'POST /v2/users/markAllNotificationsAsRead',
      'GET /v2/users/getUnreadNotificationsNumber',
    ]
  },
  {
    name:   'manage-posts',
    title:  'Manage (read, write and delete) posts, comments, and likes',
    routes: [
      'GET /v2/posts/:postId',
      'GET /v2/users/markAllDirectsAsRead',
      'GET /v2/comments/:commentId/likes',
      'POST /v1/attachments',
      'POST /v1/bookmarklet',
      'POST /v1/posts',
      'PUT /v1/posts/:postId',
      'POST /v1/posts/:postId/disableComments',
      'POST /v1/posts/:postId/enableComments',
      'DELETE /v1/posts/:postId',
      'POST /v1/comments',
      'PUT /v1/comments/:commentId',
      'DELETE /v1/comments/:commentId',
      'POST /v1/posts/:postId/like',
      'POST /v1/posts/:postId/unlike',
      'POST /v2/comments/:commentId/like',
      'POST /v2/comments/:commentId/unlike',
    ]
  },
  {
    name:   'manage-my-feeds',
    title:  'Manage my subscriptions, hides, bans, and saves',
    routes: [
      'POST /v1/users/:userId/subscribe',
      'POST /v1/users/:userId/unsubscribe',
      'POST /v1/posts/:postId/hide',
      'POST /v1/posts/:postId/unhide',
      'POST /v1/users/:userId/ban',
      'POST /v1/users/:userId/unban',
      'POST /v1/posts/:postId/save',
      'DELETE /v1/posts/:postId/save',
      'POST /v1/users/:userId/sendRequest',
      'POST /v2/requests/:followedUserName/revoke',
    ]
  },
  {
    name:   'manage-profile',
    title:  'Manage my and my groups profiles',
    routes: [
      'POST /v1/groups/:groupName/updateProfilePicture',
      'POST /v1/users/updateProfilePicture',
      'PUT /v1/users/:userId',
    ]
  },
  {
    name:   'manage-groups',
    title:  'Manage groups',
    routes: [
      'POST /v1/groups',
      'POST /v1/groups/:groupName/subscribers/:adminName/admin',
      'POST /v1/groups/:groupName/subscribers/:adminName/unadmin',
      'POST /v1/groups/:groupName/sendRequest',
      'POST /v1/groups/:groupName/acceptRequest/:userName',
      'POST /v1/groups/:groupName/rejectRequest/:userName',
      'POST /v1/groups/:groupName/unsubscribeFromGroup/:userName',
    ]
  },
  {
    name:   'manage-subscription-requests',
    title:  'Manage subscription requests',
    routes: [
      'POST /v1/users/acceptRequest/:username',
      'POST /v1/users/rejectRequest/:username',
      'POST /v1/users/:username/unsubscribeFromMe',
    ]
  },
];