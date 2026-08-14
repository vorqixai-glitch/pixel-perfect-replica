CREATE POLICY "thread files read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'thread-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "thread files insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'thread-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "thread files update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'thread-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "thread files delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'thread-files' AND auth.uid()::text = (storage.foldername(name))[1]);