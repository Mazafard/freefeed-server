import XRegExp from 'xregexp';


export const IN_POSTS = 1,
  IN_COMMENTS = 2,
  IN_ALL = IN_POSTS | IN_COMMENTS;

export class Pipe {}

export class ScopeStart {
  scope = 0;

  constructor(scope) {
    this.scope = scope;
  }
}

export class Condition {
  exclude = false;
  condition = '';
  args = [];

  constructor(exclude, condition, args) {
    this.exclude = exclude;
    this.condition = condition;
    this.args = args;
  }
}

export class Text {
  exclude = false;
  phrase = false;
  text = '';

  constructor(exclude, phrase, text) {
    this.exclude = exclude;
    this.phrase = phrase;
    this.text = text;
  }
}

export class AnyText {
  texts = [];

  constructor(texts) {
    this.texts = texts;
  }
}

export class InScope {
  scope = 0;
  anyTexts = [];

  constructor(scope, anyTexts) {
    this.scope = scope;
    this.anyTexts = anyTexts;
  }
}

export const scopeStarts = [
  [/^in-?body$/, IN_POSTS],
  [/^in-?comments?$/, IN_COMMENTS],
];

export const listConditions = [
  // Feeds
  [/^(in|groups?)$/, 'in'],
  [/^in-?my$/, 'in-my'],
  [/^commented-?by$/, 'commented-by'],
  [/^liked-?by$/, 'liked-by'],
  // Comments
  // [/^cliked-?by$/, 'cliked-by'],
  // Authorship
  [/^from$/, 'from'],
  [/^comments?-?from$/, 'comments-from'],
  [/^posts?-?from$/, 'posts-from'],
];

// A simple trimmer, trims punctuation, separators and some symbols.
const trimTextRe = new XRegExp(
  `^[\\pP\\pZ\\pC\\pS]*(.*?)[\\pP\\pZ\\pC\\pS]*$`,
  'u'
);
const trimTextRightRe = new XRegExp(`^(.*?)[\\pP\\pZ\\pC\\pS]*$`, 'u');

export function trimText(text) {
  if (/^[#@]/.test(text)) {
    return text.replace(trimTextRightRe, '$1');
  }

  return text.replace(trimTextRe, '$1');
}
