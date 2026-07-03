
-- 1. artifacts table
CREATE TABLE public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('markdown','code','html')),
  language text,
  title text NOT NULL DEFAULT 'Untitled',
  content text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX artifacts_thread_id_idx ON public.artifacts(thread_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.artifacts TO authenticated;
GRANT ALL ON public.artifacts TO service_role;

ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "artifacts owner all" ON public.artifacts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER artifacts_updated_at
  BEFORE UPDATE ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_thread_updated_at();
-- Note: reuse simple touch not desired; write dedicated trigger instead.
DROP TRIGGER artifacts_updated_at ON public.artifacts;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifacts_set_updated_at
  BEFORE UPDATE ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. model columns
ALTER TABLE public.threads ADD COLUMN model text NOT NULL DEFAULT 'google/gemini-3-flash-preview';
ALTER TABLE public.messages ADD COLUMN model text;
