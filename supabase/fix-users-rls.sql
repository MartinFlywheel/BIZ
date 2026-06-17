-- Run this in Supabase SQL Editor if login shows "Error creando perfil"
-- This enables RLS on users table with a self-insert policy

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own" ON users
  FOR SELECT USING (id = auth.uid());

-- Agency users can read all profiles (for team assignments, etc)
CREATE POLICY "agency_read_all" ON users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.user_type = 'agency')
  );

-- Authenticated users can insert their own profile (auto-provisioning on first login)
CREATE POLICY "users_insert_own" ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- Users can update their own profile
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.uid());
