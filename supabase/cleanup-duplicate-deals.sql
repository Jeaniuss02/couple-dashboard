-- ===========================================================================
-- Cleanup — remove the duplicated sample deals
--
-- Running seed-starter.sql more than once re-inserted the two sample deals
-- (Dish Duty, Laundry), so the board now shows each of them several times.
-- This keeps the oldest copy of each and deletes the rest. Their steps and
-- logs go with them (the foreign keys cascade).
-- ===========================================================================

delete from public.deals
where title in ('洗碗 Dish Duty', '洗衣 Laundry', 'Dish Duty', 'Laundry Routine')
  and id not in (
    select distinct on (title) id
    from public.deals
    where title in ('洗碗 Dish Duty', '洗衣 Laundry', 'Dish Duty', 'Laundry Routine')
    order by title, created_at
  );

-- Should now show exactly one row per title.
select title, emoji, created_at
from public.deals
order by title, created_at;
