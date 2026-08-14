-- Prompt library
CREATE TABLE public.prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled prompt',
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompts TO authenticated;
GRANT ALL ON public.prompts TO service_role;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prompts owner all" ON public.prompts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER prompts_set_updated_at BEFORE UPDATE ON public.prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-thread file attachments
CREATE TABLE public.thread_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  path text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL DEFAULT 0,
  extracted_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thread_files TO authenticated;
GRANT ALL ON public.thread_files TO service_role;
ALTER TABLE public.thread_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "thread_files owner all" ON public.thread_files FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER thread_files_set_updated_at BEFORE UPDATE ON public.thread_files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX thread_files_thread_idx ON public.thread_files(thread_id);