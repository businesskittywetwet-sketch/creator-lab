/* Default discovery sources for the Story Scout. Seeded into          */
/* story_sources on first run; operators can edit/add rows without     */
/* touching code (new adapter types still need a registry entry).      */

export const DEFAULT_SOURCES: {
  type: string;
  name: string;
  channelSlug: string;
  reliability: number;
  config: Record<string, unknown>;
}[] = [
  {
    type: "googlenews",
    name: "Google News · Weird history",
    channelSlug: "weird-history",
    reliability: 74,
    config: {
      query: 'bizarre history OR "strange true story" OR "forgotten history"',
      limit: 12,
    },
  },
  {
    type: "googlenews",
    name: "Google News · Unsolved mysteries",
    channelSlug: "dark-mysteries",
    reliability: 72,
    config: {
      query: "unsolved mystery OR cold case OR unexplained disappearance",
      limit: 12,
    },
  },
  {
    type: "googlenews",
    name: "Google News · Movie secrets",
    channelSlug: "movie-secrets",
    reliability: 70,
    config: {
      query: 'movie easter egg OR film trivia OR "behind the scenes" film',
      limit: 12,
    },
  },
  {
    type: "rss",
    name: "The Guardian · Film",
    channelSlug: "movie-secrets",
    reliability: 88,
    config: { feedUrl: "https://www.theguardian.com/film/rss", limit: 10 },
  },
  {
    type: "hackernews",
    name: "Hacker News · Film & documentaries",
    channelSlug: "movie-secrets",
    reliability: 64,
    config: { query: "film", limit: 10, minPoints: 40 },
  },
  {
    type: "reddit",
    name: "r/todayilearned",
    channelSlug: "weird-history",
    reliability: 76,
    config: { subreddit: "todayilearned", limit: 25, minScore: 100 },
  },
];
