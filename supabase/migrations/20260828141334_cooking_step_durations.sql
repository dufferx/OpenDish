-- Optional, user-reviewable timer metadata for preparation steps.
alter table public.recipe_steps
  add column duration_seconds integer;

alter table public.recipe_steps
  add constraint recipe_steps_duration_seconds_positive
  check (duration_seconds is null or duration_seconds > 0);
