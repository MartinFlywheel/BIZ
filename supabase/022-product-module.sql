-- =====================================================
-- Product & Delivery Module (per-client "Producto" tab)
-- =====================================================
-- Alumnas enrolled in a client's delivered program (e.g. Mane's Yoga
-- Facial), their onboarding data, daily follow-up schedule, and the
-- AI-generated message queue awaiting human approval before send.

CREATE TABLE program_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  start_date DATE NOT NULL DEFAULT current_date,
  current_day INTEGER NOT NULL DEFAULT 1,
  risk_level TEXT NOT NULL DEFAULT 'green' CHECK (risk_level IN ('green', 'yellow', 'red')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX program_students_client_id_idx ON program_students(client_id);

CREATE TABLE onboarding_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES program_students(id) ON DELETE CASCADE,
  form_responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  photos TEXT[] NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX onboarding_data_student_id_idx ON onboarding_data(student_id);

CREATE TABLE follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES program_students(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  notes TEXT,
  UNIQUE (student_id, day_number)
);

CREATE INDEX follow_ups_student_id_idx ON follow_ups(student_id);

CREATE TABLE ai_messages_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES program_students(id) ON DELETE CASCADE,
  follow_up_id UUID REFERENCES follow_ups(id) ON DELETE SET NULL,
  message_text TEXT,
  audio_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX ai_messages_queue_student_id_idx ON ai_messages_queue(student_id);
CREATE INDEX ai_messages_queue_status_idx ON ai_messages_queue(status);

-- Two-way WhatsApp conversation log backing the chat panel in the Producto
-- tab: inbound replies from the student plus outbound texts, whether sent
-- manually by the agency or approved out of ai_messages_queue.
CREATE TABLE student_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES program_students(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('client', 'agency', 'ai')),
  message_text TEXT,
  audio_url TEXT,
  wa_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX student_messages_student_id_idx ON student_messages(student_id);

-- RLS — mirrors call_folders/competitors: agency full access, clients
-- read-only their own (in case a student's agency client ever gets portal
-- access to see their own program's status).
ALTER TABLE program_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON program_students FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON program_students FOR SELECT USING (
  get_user_type() = 'client' AND client_id = get_user_client_id()
);

CREATE POLICY "agency_full_access" ON onboarding_data FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON onboarding_data FOR SELECT USING (
  get_user_type() = 'client' AND student_id IN (
    SELECT id FROM program_students WHERE client_id = get_user_client_id()
  )
);

CREATE POLICY "agency_full_access" ON follow_ups FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON follow_ups FOR SELECT USING (
  get_user_type() = 'client' AND student_id IN (
    SELECT id FROM program_students WHERE client_id = get_user_client_id()
  )
);

CREATE POLICY "agency_full_access" ON ai_messages_queue FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON ai_messages_queue FOR SELECT USING (
  get_user_type() = 'client' AND student_id IN (
    SELECT id FROM program_students WHERE client_id = get_user_client_id()
  )
);

ALTER TABLE student_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_full_access" ON student_messages FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON student_messages FOR SELECT USING (
  get_user_type() = 'client' AND student_id IN (
    SELECT id FROM program_students WHERE client_id = get_user_client_id()
  )
);

-- Storage bucket for ElevenLabs-generated voice notes. Public read so the
-- Dashboard <audio> player and the WhatsApp Graph API (which fetches the
-- link server-side) can both reach the file; only agency uploads.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-audio', 'product-audio', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-audio');

CREATE POLICY "auth_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-audio');
