export const CACHE_KEYS = {
  courses: "public:courses",
  categories: "public:categories",
  notices: "public:notices",
  staff: "public:staff",
  gallery: "public:gallery",
  banners: "public:banners",
  popups: "public:popups",
  marquee: "public:marquee",
  links: "public:links",
  config: "public:config",
  alumni: "public:alumni",
  jobs: "public:jobs",
  videos: "public:videos",
  live: "public:live",
} as const;

export const QUEUE_NAMES = {
  notifications: "notifications",
  pdf: "pdf",
  messaging: "messaging",
  reminders: "reminders",
} as const;
