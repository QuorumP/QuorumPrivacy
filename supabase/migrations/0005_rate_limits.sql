-- Fixed-window rate limiting for sensitive endpoints. One row per (bucket, window_start);
-- count increments per request. Old windows are harmless and can be swept periodically.
create table if not exists rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits (window_start);
