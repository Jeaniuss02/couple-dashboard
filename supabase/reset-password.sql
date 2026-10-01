-- ===========================================================================
-- Reset your password (Couple Board)
--
-- Passwords are stored as a ONE-WAY hash, so nobody can read the old one back
-- — not you, not Supabase support. The only fix is to set a new one, which is
-- what this does.
--
-- HOW TO USE
--   1. Replace NEW_PASSWORD_HERE below with a password you choose.
--      Keep the single quotes, e.g. 'Mydish2026!'.
--      Use a password you do NOT use anywhere else — this query stays in your
--      SQL Editor history.
--   2. Press Run. You should see the account's email in the result.
--   3. Sign in on the site with that email + the new password.
-- ===========================================================================

update auth.users
set encrypted_password = crypt('NEW_PASSWORD_HERE', gen_salt('bf')),
    updated_at         = now()
where email = 'wengthongkwan@gmail.com';        -- <- your account

-- If you get "function crypt(...) does not exist", run the same line with the
-- extension schema spelled out:
--   set encrypted_password = extensions.crypt('NEW_PASSWORD_HERE', extensions.gen_salt('bf'))

-- ---------------------------------------------------------------------------
-- Zhen's account (only if he forgot his too). Replace the password, then Run.
-- ---------------------------------------------------------------------------
-- update auth.users
-- set encrypted_password = crypt('ZHEN_NEW_PASSWORD_HERE', gen_salt('bf')),
--     updated_at         = now()
-- where email = 'zhencomando@gmail.com';

-- ---------------------------------------------------------------------------
-- Proof: shows both accounts and whether the password column is filled.
-- It never shows the password itself (it cannot be un-hashed).
-- ---------------------------------------------------------------------------
select email,
       confirmed_at is not null as email_confirmed,
       (encrypted_password is not null) as has_password,
       updated_at
from auth.users
order by created_at;
