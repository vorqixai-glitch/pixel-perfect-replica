DROP POLICY "user_roles read own" ON public.user_roles;
CREATE POLICY "user_roles read own" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);